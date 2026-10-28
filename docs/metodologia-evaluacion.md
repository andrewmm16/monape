# Metodología de evaluación de compatibilidad (v1)

La evaluación compara el CV vigente de un candidato con los **criterios aprobados** de una vacante. Es **orientativa**: no es una probabilidad de contratación ni una medida del valor de una persona, y nunca cambia el estado del proceso: como mucho lo sugiere, y una persona lo confirma (ver sección 5).

## 1. Criterios

Cada vacante define requisitos con:

| Atributo | Uso |
|---|---|
| Tipo | formación, experiencia, habilidad técnica, herramienta, certificación, competencia, idioma, otro |
| Prioridad | obligatorio / deseable |
| Peso | entero de 1 a 10; su porcentaje efectivo es `peso / suma de pesos` |
| Términos de búsqueda | sinónimos y siglas que usa el motor de reglas. Al escribir el requisito, la pantalla sugiere términos relacionados de un diccionario fijo de 27 áreas (`src/modules/vacancies/term-suggestions.ts`), que RRHH acepta uno por uno o todos juntos. Ninguna sugerencia se guarda sin pulsarla. |
| Años mínimos | opcional, para experiencia |
| Legal o esencial | exige verificación documental humana |

**Aprobación y versión:** RRHH aprueba los criterios antes de evaluar; cada aprobación incrementa la versión. Cualquier cambio posterior anula la aprobación. Cada evaluación guarda la versión de criterios y una copia de cada requisito evaluado, y la base de datos rechaza evaluaciones que no cubran exactamente los requisitos vigentes (mismos criterios para todos los candidatos).

## 2. Valoración por requisito

| Valoración | Significado |
|---|---|
| **Acreditado** | El CV contiene evidencia explícita (se muestra la cita). |
| **Aparentemente no cumplido** | La información disponible indica que no se cumple. Debe confirmarse. |
| **Sin evidencia suficiente** | El CV no lo menciona. **No implica que la persona no lo cumpla.** |
| **Pendiente de verificación** | Hay indicios que requieren verificación humana (entrevista, documentos). |

### Motor de reglas (`reglas-v2`, `src/modules/evaluation/rule-engine.ts`)

Determinista: con el mismo texto, los mismos criterios y la misma fecha de evaluación, da el mismo resultado. La fecha importa solo para los empleos «a la actualidad» (regla 5). Las evaluaciones anteriores al 28/10/2026 indican `reglas-v1`, que no calculaba años por fechas.

1. Sin términos configurados → *pendiente de verificación* (no evaluable automáticamente).
2. Ningún término encontrado → *sin evidencia*. **El motor nunca asigna «no cumplido»**: la ausencia de una mención no lo prueba.
3. Competencias → *pendiente de verificación* aunque se mencionen (una mención no acredita una competencia).
4. Requisitos legales/esenciales → *pendiente de verificación*, con la evidencia encontrada.
5. Años mínimos → *acreditado* si se cumple **una** de estas dos vías (y el requisito no es esencial):
   - **Mención explícita:** cerca de los términos (±160 caracteres) hay una mención de **años de experiencia** suficiente («5 años de experiencia», «experiencia de más de 3 años»), tomando la más cercana al término. Cifras como la edad («26 años») o la antigüedad de una empresa no se consideran.
   - **Fechas del CV** (`src/modules/evaluation/experience-dates.ts`):
     - Solo dentro de la sección de experiencia, que se reconoce por encabezados como «Experiencia laboral», «Trayectoria profesional» o «Work experience». Las fechas de formación, cursos y similares no cuentan, y un CV sin encabezado de experiencia no se calcula.
     - La sección se cierra con encabezados como «Formación», «Estudios realizados», «Cursos», «Idiomas», «Habilidades» o «Referencias», con o sin «:». También la cierran «Proyectos», «Logros» o «Herramientas» cuando van solos como título.
     - En cambio, subtítulos de un empleo como «Funciones:», «Logros:», «Herramientas: SAP» o «Tecnologías: React» se consideran parte del empleo.
     - Cada empleo abarca como máximo 12 líneas después de su fecha.
     - No se toman como fechas los números pegados a otros dígitos ni los que siguen a «Tel.», «Cel.», «DNI», «RUC» y similares.
     - Se leen periodos como «03/2019 – 12/2022», «marzo 2019 – actualidad» o «2019 – 2022», en español o inglés.
     - Se suman solo los empleos cuyo bloque (cargo, empresa y descripción) contiene alguno de los términos del requisito. Los periodos que se cruzan no se cuentan dos veces.
     - Si una fecha solo indica el año, se calcula una cota mínima y una máxima, y solo se acredita si la **mínima** alcanza.
     - La evidencia son las líneas del CV con las fechas usadas, y el motivo indica la fecha del cálculo.

   Si ninguna vía alcanza el mínimo, la valoración es *pendiente*: el motivo indica la suma o el rango encontrado y pide verificar. Nunca se asigna «no cumplido».
6. En otro caso, términos encontrados → *acreditado*, con hasta 3 extractos literales.

La búsqueda ignora mayúsculas, tildes y espacios, y respeta límites de palabra («SQL» no coincide en «MySQL»). No interpreta sinónimos no configurados, nivel de dominio ni contexto.

### Asistente de IA (`ia-prompt-v1`, opcional y bloqueado)

El modelo propone una valoración y citas por requisito; el sistema descarta citas que no estén literalmente en el CV, rebaja a *pendiente* las afirmaciones sin cita verificable y nunca acredita requisitos esenciales. Detalle en [configuracion-ia.md](configuracion-ia.md).

## 3. Puntuación (`scoring v1`)

Sea `w` el peso de cada requisito y `W` la suma de pesos:

| Indicador | Fórmula | Lectura |
|---|---|---|
| **Puntuación** | 100 · Σw(acreditado) / W | % del peso acreditado con evidencia |
| **Máximo alcanzable** | 100 · Σw(todo excepto no cumplido) / W | Valor si se confirmaran los requisitos sin evidencia o pendientes |
| **Cobertura de evidencia** | 100 · Σw(acreditado + no cumplido) / W | % del peso con evidencia determinante |

La interfaz muestra el rango *puntuación — máximo alcanzable* para no confundir falta de información con falta de capacidad. Los valores se redondean a 2 decimales; la función `record_evaluation` de la base de datos **recalcula los porcentajes y el nivel con los pesos almacenados** y rechaza cualquier discrepancia (verificado con 60 combinaciones aleatorias en `tests/db/scoring-consistency.test.ts`).

## 4. Nivel orientativo

En este orden:

1. Más del **50 %** del peso sin evidencia o pendiente → **Evaluación pendiente** (falta información).
2. Puntuación ≥ **70 %** y ningún requisito obligatorio aparentemente no cumplido → **Compatibilidad alta**.
3. Puntuación ≥ **40 %** → **Compatibilidad parcial**.
4. En otro caso → **Compatibilidad baja** (implica requisitos aparentemente no cumplidos).

Con el motor de reglas, que no asigna «no cumplido», el nivel «baja» no se produce: un CV sin coincidencias queda como «evaluación pendiente».

Los umbrales están en `src/modules/evaluation/scoring.ts` (`LEVEL_RULES`). Cambiarlos exige incrementar `SCORING_VERSION` y actualizar este documento y la función `record_evaluation`.

## 5. Supervisión humana

- Toda evaluación nace *pendiente de revisión*. RRHH registra una única revisión: conforme / conforme con observaciones / requiere nueva evaluación (con observaciones obligatorias en los dos últimos casos). Para cambiar de criterio se genera una nueva evaluación; el historial conserva ambas.
- Se evalúa el CV asociado a la postulación. Si el candidato carga una versión nueva, RRHH decide explícitamente usarla («Usar versión N»).
- RRHH puede corregir el texto extraído del CV, verificar datos y volver a evaluar; el historial conserva todas las evaluaciones.
- El estado del proceso (nuevo, preseleccionado, no seleccionado…) es una decisión humana separada, con motivo obligatorio para «no seleccionado» y «retirado».
- **Estado sugerido** (a pedido de RRHH, 23/10/2026). Solo para postulaciones en «Nuevo» o «En revisión», el formulario preselecciona el estado que corresponde al nivel. No guarda nada: la persona revisa el estado, el motivo y la observación, y pulsa «Actualizar estado».

  | Nivel de la evaluación más reciente | Estado sugerido |
  |---|---|
  | Compatibilidad alta | Preseleccionado |
  | Compatibilidad parcial | En revisión |
  | Evaluación pendiente (falta información) | En revisión |
  | Compatibilidad baja (requisitos aparentemente no cumplidos; solo con IA) | No seleccionado |

  No se sugiere nada si la evaluación usó criterios anteriores a los vigentes, si su revisión pidió una nueva evaluación o si la postulación ya está en el estado que correspondería. El motor de reglas nunca produce «baja», así que con él la plataforma no sugiere «No seleccionado».
- **Avisos de coherencia:** al elegir «No seleccionado» sin brechas en requisitos obligatorios, al avanzar con requisitos obligatorios aparentemente no cumplidos, o al seleccionar a alguien cuyo CV no acredita un requisito obligatorio.
- **Borradores** (`src/modules/evaluation/drafts.ts`): el motivo se redacta en un párrafo y la observación en una lista, ambos para el estado elegido y con plantillas deterministas. «Sin evidencia» se redacta siempre como «el CV no lo menciona», nunca como incumplimiento.
- La interfaz no oculta candidatos por su puntuación y usa etiquetas neutrales.

## 6. Limitaciones conocidas

- La calidad depende del texto extraído. Los PDF escaneados se leen con OCR local, que puede cometer errores; RRHH puede corregir el texto o transcribirlo.
- El motor de reglas depende de los términos configurados por RRHH; las sugerencias solo cubren las áreas del diccionario.
- El cálculo de años por fechas es heurístico:
  - Necesita un encabezado de experiencia y saltos de línea, que pueden faltar en CV de diseño a columnas o en textos extraídos sin líneas.
  - Asigna a cada fecha las dos líneas superiores (cargo y empresa) y las de debajo. Si el cargo y la fecha van en la misma línea, las dos últimas líneas de descripción de un empleo pueden atribuirse al siguiente.
  - No distingue el tiempo parcial ni las prácticas.
  - Un subtítulo dentro de un empleo que empiece por una palabra de cierre (por ejemplo «Otros logros», «Datos del proyecto», «Resumen:») puede cortar la experiencia antes de tiempo.
  - Todos los errores conocidos de la heurística van en el sentido conservador: dejan el requisito pendiente en lugar de acreditarlo.
  - Solo se probó con textos ficticios, no con CV reales extraídos de PDF.
- Las evaluaciones con IA pueden contener errores de interpretación; por eso se verifican citas y se exige revisión humana.
- No se evalúan ni infieren características protegidas, y la interfaz no las solicita.

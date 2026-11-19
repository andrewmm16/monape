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

### Motor de reglas (`reglas-v14`; antes `reglas-v13` … `reglas-v2`, `src/modules/evaluation/rule-engine.ts`)

Las novedades de reglas-v6 a reglas-v14 se resumen en «Cambios de reglas-v6 a reglas-v14», más abajo; el detalle de cada versión está en el comentario de cabecera de `rule-engine.ts`.

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

La búsqueda ignora mayúsculas, tildes y espacios, y respeta límites de palabra («SQL» no coincide en «MySQL»). Solo reconoce los términos configurados y las equivalencias curadas de `src/modules/evaluation/synonyms.ts` (ver «Equivalencias de evidencia (reglas-v5)»); no interpreta otros sinónimos, nivel de dominio ni contexto.

### Asistente de IA (`ia-prompt-v5`, opcional): segunda opinión del motor

El motor es la evaluación principal (la vigente: ranking, listados, verificaciones); la IA es una segunda opinión que se pide sola en los casos dudosos (incluidas las dudas concretas del motor y una muestra de control) y se muestra dentro de la tarjeta del motor, requisito por requisito. Nunca cambia el puntaje: RRHH decide verificando.

El modelo propone una valoración y citas por requisito; el sistema descarta citas que no estén literalmente en el CV, rebaja a *pendiente* las afirmaciones sin cita verificable y nunca acredita requisitos esenciales. Desde v2 recibe, en cada requisito donde el motor dudó, la pregunta concreta a resolver; desde v3 usa las mismas valoraciones que el motor («no cumplido» solo si el CV lo dice expresamente; lo que está por debajo de lo pedido, *pendiente*; lo de otra área, *sin evidencia*). Detalle en [configuracion-ia.md](configuracion-ia.md).

**Medición del 18/11/2026** (`npm run medir:ia`, claude-opus-5-5, 32 CV ficticios, 248 casillas de la vara, ~16 s por CV):

| Prompt | IA sola | Motor + IA (la IA releva en lo dudoso) | Motor solo |
|---|---:|---:|---:|
| v2 (dudas del motor, valoraciones de v1) | 83 % | 86 % | 98 % |
| **v3** (valoraciones alineadas con la metodología) | **94 %** | **96 %** | 98 % |
| v3, contando *pendiente* = *sin evidencia* (mismo efecto en el puntaje) | 98 % | **99 %** | 98 % |
| v3 con **claude-haiku-5-5** (~13 s por CV) | 92 % | 96 % | 98 % |
| v3 con Haiku, contando *pendiente* = *sin evidencia* | 96 % | **100 %** | 98 % |

Con Haiku, la política «motor + IA en lo dudoso» rinde igual que con Opus. Haiku es más estricto al acreditar (10 casillas que la vara acredita las deja *pendientes*, frente a 4 con Opus) y comete un error caro que Opus no comete: da por cumplidos «5 años en ejecución de obra» con 15 años como maestro de obra (la vara: *pendiente*, no es residente ni supervisor).

- En v2, 25 de los 42 desacuerdos eran de definición, no de lectura: la IA ponía «no cumple» en lo que estaba por debajo de lo pedido (p. ej., inglés A2 cuando se pedía B1) o en una formación de otra área, como mandaba el prompt v1. v3 los alinea: «nivel inferior» pasó de 8 % a 100 %.
- La IA acierta donde el motor no puede: los 5 «no cumplido» explícitos («sin experiencia en planillas») y las menciones dudosas (2/2).
- Lo que queda (14 casillas): la IA ve **indicios** donde la vara dice *sin evidencia* (8: «90 % en encuestas de satisfacción» para NPS/CSAT; mismo efecto en el puntaje, se muestra como «La IA ve un indicio»); es **más estricta** en 4 acreditaciones (registrar ≠ emitir comprobantes, «nociones» de tributación…), y acredita «estudios en curso» cuando el requisito pide «estudios» sin exigir título (2: Espinoza, Ramos). Estos últimos son discutibles: conviene decidir si la vara debe aceptarlos.
- Conclusión: con v3, la IA sirve como segunda opinión en lo dudoso y como control; no se le deja decidir sola (sigue por debajo del motor en acierto exacto).

**Desde el 18/11/2026: la IA cuenta en lo dudoso y el motor aprende de ella** (Omar: que RRHH no tenga que revisar CV uno por uno y que, con el tiempo, el sistema dependa casi solo del motor). Detalle en [configuracion-ia.md](configuracion-ia.md):

- *Relevo:* la evaluación vigente es la del motor con la IA en los requisitos que dudó (la columna «Motor+IA» de la tabla). Cada requisito indica si lo resolvió la IA y qué había dicho el motor.
- *Aprendizaje:* el motor aprende **vocabulario** (cargos o habilidades que equivalen o no, erratas, paráfrasis), no el juicio caso a caso (nivel por las tareas, menciones dudosas, alcance real). Una regla se activa con 2 CV distintos en el mismo sentido (5 hasta el 18/11: los votos de Haiku se equivocan juntos, así que más votos no daban más seguridad; el control independiente es el juez), ninguno en contra y el acuerdo de un segundo juez más capaz; se suspende sola si la IA o RRHH la contradicen. «Equivale» se aplica como una palabra clave más del requisito (el motor sigue calculando años y niveles); «no equivale» quita la duda y deja el requisito por confirmar sin consultar a la IA.
- *Medición v5 (Haiku, 32 CV, 18/11; guía de entrevista):* Motor+IA 97–98 % e IA sola 89–90 % según la corrida (Haiku varía en ~8 casillas entre corridas, casi todas entre *pendiente* y *sin evidencia*); pregunta de entrevista en 157 de 158 requisitos no acreditados y en ninguno acreditado; ~17 s por CV (antes ~13 s: la salida es más larga). La justificación ya no menciona «la nota del motor» (en v4, 59 de 248 lo hacían).
- *Medición v4 (Haiku, 32 CV):* IA sola 91 %; Motor+IA 94 % (99 % contando *pendiente* = *sin evidencia*), igual que v3. El banco tiene ~4 CV por puesto, así que con el mínimo de entonces (5) ninguna regla llegaba: la simulación de `medir:ia` muestra las candidatas. Haiku votó al revés que el juez en los dos cargos de obra («Asistente de Residencia» no cuenta, «Maestro de Obra» sí); Opus, como juez, decidió lo correcto en ambos: con Haiku, el segundo juez es imprescindible.

**Prueba de punta a punta en la app y calibración (18/11/2026).** Con Playwright, como lo haría RRHH: 8 vacantes y sus requisitos creados por la interfaz, criterios aprobados, publicadas, los 32 CV por carga masiva (evaluación automática), la IA por la cola (Haiku, 30 evaluaciones, 0 errores), verificación de RRHH por la interfaz y página de aprendizaje. Primera medición: el motor solo y el vigente (motor + IA) empataban en 98 % contando *pendiente* = *sin evidencia*; la IA mandaba el 73 % de los CV y cambió el puntaje de 1 candidato de 25. Calibración aplicada (con el OK de Omar):

- *La IA cuenta solo si cambia el puntaje* («cumple» o «no cumple»); sus «indicios» se muestran como nota.
- *A la IA solo lo que puede resolver:* dudas concretas del motor y relleno, más la muestra de control (del 75 % al 44 % de los CV).
- *reglas-v12:* el motor marca la **negación explícita** dicha con otras palabras («sin experiencia en reclamos», «no cuento↵con experiencia en planillas, ni en PLAME»; une las líneas que el PDF partió y usa la familia de cargos de `related.ts`: «programación» niega «desarrollador»). 5 de 5 en el banco, sin falsos positivos. Nunca descarta: marca la duda para que la IA lo confirme.
- *Aprendizaje:* manda el segundo juez desde el primer CV (ver configuracion-ia.md). Sus 5 primeras reglas: «Asistente de Residencia» y «Recepcionista» cuentan; «Maestro de Obra» y «Negociación básica» no; vender «a bodegas y supermercados» es B2B.
- *Vara:* decisiones de Omar del 18/11: vender a bodegas y supermercados es B2B (Chávez · Ventas B2B → acreditado) y «sin experiencia en programación» niega React, JS/TS, Node.js y pruebas/CI-CD (Fuentes → no cumplido).

| Medido en la app (32 CV, 248 casillas) | Exacto | Contando *pendiente* = *sin evidencia* |
|---|---:|---:|
| Motor solo (reglas-v12 + reglas aprendidas) | 96,4 % | 96,4 % |
| **Vigente (motor + IA)** | **100 %** | **100 %** |

La IA cambió 9 casillas del motor, las 9 a mejor (todos los «no cumple» explícitos); 0 acreditaciones de más ni mérito perdido; el orden de los candidatos es correcto en los 8 puestos. Advertencias: (1) el banco es la «cancha de local» del motor (afinado 12 versiones sobre estos CV) y 5 casillas de la vara se decidieron el mismo día revisando desacuerdos con la IA; falta medir con CV que el motor nunca vio. (2) Reevaluar muchas postulaciones seguidas choca con el límite de 30 evaluaciones cada 10 minutos por usuario (protección esperada; para lotes, «Evaluar pendientes»).

**Prueba con CV que el motor nunca vio (18/11/2026).** Set de demostración de Omar (`cv-prueba/demo`, ficticio): «Desarrollador Full Stack» (20 CV, 6 requisitos) y «Asistente de Recursos Humanos» (20 CV, 5 requisitos, creada por la interfaz con su ficha). Todo por la interfaz; la vara la propuso Opus **a ciegas** (sin ver al motor ni a Haiku, ~10 s por CV) y Omar decidió las 24 casillas dudosas por patrón: años justos cuando el CV solo da el año de inicio → cuenta si el perfil declara los años; legislación laboral deducida de tareas de planilla (CTS, gratificaciones, PLAME) → *pendiente*; «administración de personal» o «control de asistencia» no es gestión de planillas → *sin evidencia*; inducción u onboarding no es reclutamiento → *sin evidencia*; APIs REST sin Node ni PHP → *sin evidencia*.

| CV nuevos (40 CV, 220 casillas) | Exacto | Contando *pendiente* = *sin evidencia* |
|---|---:|---:|
| Motor solo | 95,0 % | 99,5 % |
| **Vigente (motor + IA)** | **95,5 %** | **100 %** |
| IA sola (Haiku, 71 casillas) | 90,1 % | 100 % |

A la IA fue el 33 % de los CV; cambió 1 casilla, a mejor. 0 acreditaciones de más, 0 mérito perdido y 0 inversiones de orden (contra el ajuste alto/medio/bajo que fijó Opus). El juez aprendió una regla nueva: «Administración de personal» **no** equivale a gestión de planillas. Advertencia: los CV de demo son de plantilla (las mismas frases se repiten entre CV), así que siguen siendo un caso fácil; los CV reales son más desordenados.

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

Con el motor de reglas, que no asigna «no cumplido», el nivel «baja» no se produce: un CV sin coincidencias queda como «evaluación pendiente». No es una observación de pasada, es una propiedad demostrada: sin «no cumplido», puntuación + sin evidencia suman 100, así que una puntuación por debajo de 40 implica más del 50 % sin evidencia. La prueba `el motor de reglas no puede producir «baja» en ninguna combinación` (`tests/unit/scoring.test.ts`) la recorre de forma exhaustiva. Consecuencia práctica: el filtro de nivel de la lista de candidatos ofrece «Cumple pocos requisitos», que solo aparece tras una verificación humana o con el asistente de IA; con evaluaciones de reglas ese filtro no devuelve nada.

Los umbrales están en `src/modules/evaluation/scoring.ts` (`LEVEL_RULES`). Cambiarlos exige incrementar `SCORING_VERSION` y actualizar este documento y la función `record_evaluation`.

## 5. Supervisión humana

- Toda evaluación nace *pendiente de revisión*. RRHH registra una única revisión: conforme / conforme con observaciones / requiere nueva evaluación (con observaciones obligatorias en los dos últimos casos). Para cambiar de criterio se genera una nueva evaluación; el historial conserva ambas.
- Se evalúa el CV asociado a la postulación. Si el candidato carga una versión nueva, RRHH decide explícitamente usarla («Usar versión N»).
- RRHH puede corregir el texto extraído del CV, verificar datos y volver a evaluar; el historial conserva todas las evaluaciones.
- **Verificación por requisito** (migración `20261028001000`): RRHH registra por requisito lo comprobado fuera del CV.
  - Contenido: resultado («cumple» o «no cumple»), fuente (entrevista, documento, referencia, prueba técnica u otra) y una nota obligatoria.
  - Vigencia: una verificación vigente por requisito y postulación.
  - Efecto en la evaluación: toda evaluación, por reglas o con IA, la aplica sobre la valoración automática. Cada ítem guarda una copia de la verificación y la valoración original del CV (`cv_assessment`). La base de datos rechaza una evaluación que contradiga una verificación vigente y recalcula los porcentajes como siempre.
  - Nivel: un «no cumple» verificado en un requisito obligatorio impide el nivel «alta» y puede producir «baja». Es una decisión humana, no del motor.
  - Textos: el resumen y los borradores redactan lo verificado como comprobado, con su fuente, y nunca como «aparentemente».
  - Recalcular al verificar (migración `20261028001200`, `src/modules/evaluation/reevaluate.ts`): no se relee el CV ni se llama a la IA. Se parte de los ítems de la evaluación vigente, con la valoración y el motivo originales del CV (`cv_assessment`, `cv_rationale`). Se aplican las verificaciones actuales y se registra una evaluación nueva con el mismo método, versión, modelo, CV y huella del texto. Si no hay evaluación vigente, sus criterios son anteriores o sus ítems no coinciden con los requisitos, se evalúa con reglas.
- **Guía de entrevista** (18/11/2026, `src/modules/evaluation/interview-guide.ts`): en la postulación y en «Registrar resultado», solo lo que el CV no acredita (más lo que el motor acreditó y la IA dejó en duda), obligatorios primero y lo parcial antes que lo que no aparece. Cada punto trae por qué se pregunta, la pregunta (de la IA si revisó el CV; si no, una plantilla según la duda del motor o la categoría) y qué cuenta como «cumple». Lo marcado en la entrevista se guarda como verificación con fuente «entrevista», recalcula la puntuación y suma votos al aprendizaje del motor. No descarta a nadie ni pregunta por características protegidas.
- **Bandeja «Por resolver»** (pestaña de la vacante, `src/modules/evaluation/inbox.ts`): los candidatos en proceso agrupados por lo que hace falta hacer, con la pregunta de la guía y «Cumple / No cumple» en cada obligatorio por confirmar. *Listos para entrevistar*: el CV acredita todos los obligatorios. *Por confirmar*: falta algún obligatorio, pero cumplen al menos el 40 % (compatibilidad parcial) o el CV da un indicio de lo que falta. *Sin evidencia de los obligatorios*: el resto; solo se agrupan, nunca se descartan. En el set de demo separó a los 4 CV que la vara califica como ajuste bajo de Asistente de RRHH.
- **Orden de «mejor opción»** en la comparación de candidatos (`src/modules/applications/ranking.ts`), aplicado en este orden:
  1. al final, quien tenga un obligatorio verificado como «no cumple»;
  2. después, las evaluaciones desactualizadas;
  3. puntuación;
  4. suma de pesos de los obligatorios acreditados;
  5. cantidad de requisitos verificados como «cumple»;
  6. resultado de la última entrevista;
  7. fecha de postulación.

  Es un orden para revisar primero a los más compatibles.
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
  - Medido con los 20 CV ficticios de `cv-prueba/` extraídos de sus PDF (`npm run medir:motor`): 4 de los 5 puestos ordenan a los candidatos según su ajuste real y ningún candidato que no cumple acredita obligatorios. No se ha medido con CV reales de portales, donde la extracción de PDF puede perder saltos de línea o mezclar columnas.
- Las evaluaciones con IA pueden contener errores de interpretación; por eso se verifican citas y se exige revisión humana.
- No se evalúan ni infieren características protegidas, y la interfaz no las solicita.

## Equivalencias de evidencia (reglas-v5)

**Qué hace.** Un diccionario curado y cerrado (`src/modules/evaluation/synonyms.ts`) agrupa expresiones equivalentes. Al evaluar, cada término configurado se expande también a las equivalencias de su grupo. Grupos actuales: contabilidad / contable / libros contables / registros contables; atención al cliente / atención al público / servicio al cliente; «tecnologías de la información» / «TI».

**Alcance por categoría.** Solo en `habilidad_tecnica`, `competencia`, `experiencia` y `otro`. No se aplica en `formacion`, `herramienta`, `certificacion` ni `idioma`.

**Cómo acredita.** Un requisito cubierto **solo** por equivalencia se marca *acreditado*, con la cita literal del CV y una nota en el motivo del tipo «(por equivalencia: «libros contables»)», para que RRHH vea que no fue una coincidencia directa. Los filtros de negación, tercero, enlace y aspiracional se aplican igual que con los términos configurados.

**Lo que no cambia.** Los requisitos legales/esenciales siguen *pendientes de verificación*: una equivalencia nunca los acredita sola.

**Curación.** Cada grupo se valida contra los bancos de medición (legítimo y adversario). Un grupo ventas ↔ comercial se probó y se retiró: «empresa/área comercial» acreditaba un requisito de «Ventas».

**Experiencia por fechas.** Desde reglas-v11, el cálculo de años por fechas (`experience-dates.ts`) también considera las equivalencias que coincidieron («Contador General 2018 – actualidad» suma años de contabilidad). Hasta reglas-v10 no lo hacía y esos requisitos quedaban *pendientes de verificación*.

**Equivalencias en un solo sentido (reglas-v11).** Un grupo puede tener `implicados`: expresiones que demuestran el concepto pero no al revés. «Contador» demuestra contabilidad, pero quien hace tareas contables no es contador; pedir «contador» no se expande al grupo.

## Cambios de reglas-v6 a reglas-v14

Ninguno de estos cambios rechaza: a lo sumo dejan un requisito *por confirmar* en lugar de *acreditado*, o *por confirmar* en lugar de *sin evidencia*. Se miden contra la vara de 248 casillas revisadas a mano (`npm run gold:motor`) y los bancos (`npm run verificar:motor`).

- **v6. Escalera de niveles** (básico < intermedio < avanzado): un nivel por debajo del pedido queda por confirmar. «Nociones» queda por confirmar.
- **v7. Requisitos conjuntivos** («S10 y MS Project» exige ambos; «o» es alternativa), idioma buscado a secas y **discrepancia de años**: si declara años que sus fechas no respaldan (≥ 2 menos), queda por confirmar con aviso.
- **v8. Nivel no declarado** frente a un nivel pedido por encima de básico → por confirmar; categoría genérica («ERP») frente a la herramienta concreta («SAP») → por confirmar.
- **v9. Rangos que parten de básico** («básico-intermedio» frente a intermedio) → por confirmar.
- **v10. Evidencia relacionada** (`related.ts`): sin el término pero con un cargo parecido («asistente de residencia» frente a «residente de obra») o una habilidad más general («negociación» frente a «negociación de contratos») → por confirmar con la pista, nunca acreditado. Cada duda lleva una marca legible por código (`signal`) para la segunda opinión.
- **v11. Puntos ciegos** hallados con casos realistas: no cuentan «me interesa…», la intención futura («próximamente», «planeo») ni el término dentro del **nombre de una empresa** («SAP Perú S.A.C.»); una herramienta que **solo aparece en cursos** queda por confirmar; los años de una mención con **área propia distinta** («10 años de experiencia en ventas y conocimientos de contabilidad») no se atribuyen a un término lejano; se reconocen idiomas y niveles en inglés, abreviaturas de títulos («Ing. Civil») y posibles **faltas de ortografía** («Exel» → por confirmar, nunca acreditado).
- **v12. Negación explícita** con otras palabras («sin experiencia en reclamos»): marca la duda para la IA (ver «Prueba de punta a punta en la app y calibración»).
- **v13. Años de dos dígitos** junto a un mes («01/19 – 12/23», «15/03/19», «Ene-19», «Jan '19»), con el siglo deducido del año de la evaluación («98» → 1998). Antes esos periodos no se leían y el requisito de años quedaba pendiente; ahora cuentan igual que con el año completo, así que pueden acreditar. Sin cambios en la vara ni en los bancos, y sin falsos positivos en los 73 CV de la base local.
- **v14. Puntos ciegos del banco ciego** (ver «Banco ciego», abajo): la lista «Cursos: A, B», «Curso: X» y los encabezados en inglés («Courses», «Training») cuentan como formación; un curso o certificación «(in progress)» o «(en curso)», aunque el PDF parta el paréntesis en dos líneas, queda como *solo capacitación*; «poco», «escaso» y «limitado» declaran un conocimiento mínimo, como «nociones»; se leen los niveles de idioma de LinkedIn («competencia profesional completa» y «bilingüe» → avanzado; «básica profesional» y «básica limitada» → intermedio) y las siglas de los colegios profesionales (CEP, CIP, CMP, CCPL, CPsP, CQFP, CTMP) en formación y certificación. Vara y bancos sin cambios.

**Límite conocido.** El motor no entiende paráfrasis sin palabras clave («atendí llamadas y resolví quejas» para atención al cliente): queda *sin evidencia*. Es uno de los casos previstos para la segunda opinión con IA.

### Banco ciego (19/11/2026)

Todas las mediciones anteriores eran exámenes que el motor ya conocía: se afinó mirándolos o eran CV de plantilla. Para medirlo con lo que nunca vio:

- 30 CV ficticios (3 por cada una de las 10 vacantes de la base local: fuerte, medio y débil) escritos por un agente que no conocía el motor, con los diseños y la redacción de los CV reales: 10 a dos columnas tipo Canva, 6 exportaciones de LinkedIn, 4 como los genera Computrabajo o Bumeran, Word clásico, tablas, Europass, funcional, 2 en inglés y 1 mixto, fechas escritas de mil formas, faltas de ortografía, frases negativas honestas y 3 que copian el aviso.
- Pasados a PDF con Chromium y leídos con el lector de la app (`extraction-core.ts`), como un CV real.
- Vara de Opus **a ciegas**, sobre el texto limpio del HTML (lo que lee una persona), sin ver al motor ni a Haiku. Las casillas que Opus marcó como dudosas (49 de 219) quedan fuera de las métricas.
- La IA como en producción: Haiku solo en los dudosos y en la muestra de control.

| 170 casillas firmes | Contando *pendiente* = *sin evidencia* | Acreditó de más | Mérito perdido |
|---|---:|---:|---:|
| Motor solo, reglas-v13 | 91,2 % | 5 | 4 |
| Vigente (motor + IA), reglas-v13 | 94,1 % | 5 | 3 |
| Motor solo, **reglas-v14** | 93,5 % | 2 | 3 |
| **Vigente (motor + IA), reglas-v14** | **96,5 %** | **2** | **1** |
| Haiku solo (en los 26 CV que recibió) | 97,9 % | 0 | 0 |

Qué se aprendió:

- **La IA no corrige un «acreditado» del motor** (el relevo solo actúa en sus dudas). Los errores de más hay que cerrarlos en el motor: reglas-v14.
- **Un obligatorio «sin evidencia» no llegaba a la IA.** Desde el 19/11/2026 va si el candidato es competitivo (puntaje ≥ 40, el mismo umbral de «por confirmar» en la bandeja): en la base local, del 41 % al 45 % de los CV.
- **Las dos columnas no rompen la lectura:** el lector deja la columna principal y luego la lateral. En esos 10 CV el motor acertó algo menos (90,9 % frente a 93,5 % del total), pero sus errores son de palabras clave («Hospital» frente a «hospitalización», «Capacitación de 14 asesores» frente a «Capacité»), no de lectura. El único problema de diseño, un paréntesis partido en dos líneas en la columna angosta, quedó resuelto en reglas-v14.
- Lo que queda son decisiones discutibles de la vara (un conocimiento declarado «básico» y un curso de IGV para «tributación (IGV, renta, PDT 621)»; reclutamiento con un taller y «entrevistas» en habilidades), la colegiatura (el motor la deja siempre para verificar con documentos, la vara la acredita) y una palabra clave en primera persona («Capacité») frente a «Capacitación de 14 asesores».

Ojo: después de afinar el motor con estos 30 CV, también se convirtieron en un examen conocido. La medición que falta es con CV reales.

### Notas del CV para la entrevista

Además de valorar los requisitos, cada evaluación guarda al final de sus limitaciones unas notas neutras sobre el CV en su conjunto (`signal-notes.ts`). Ninguna cambia el puntaje ni descarta a nadie; sirven para preguntar en la entrevista y, cuando corresponde, para pedir la segunda opinión de la IA.

- **Fechas** (`date-consistency.ts`): periodos superpuestos, fechas imposibles (fin antes del inicio, inicio futuro) y varios empleos cortos seguidos.
- **Copia del aviso de la vacante** (`vacancy-copy.ts`, desde el 19/11/2026): tramos de 10 palabras seguidas o más idénticos a la descripción o las funciones del aviso (sin importar mayúsculas, tildes ni signos). Avisa con 2 tramos o con uno de 15 palabras o más; la nota cita el más largo. Adaptar el CV a la vacante es legítimo y no se marca: se compara con la descripción y las funciones, no con los requisitos, y las frases cortas del rubro («planilla de remuneraciones, CTS y gratificaciones») no llegan al umbral. En los 73 CV legítimos de la base local el tramo común más largo con su aviso fue de 5 palabras y no saltó ningún aviso. La IA recibe la misma pista: lo copiado no acredita sin respaldo propio.

Al reconstruir una evaluación tras una verificación de RRHH, que no vuelve a leer el CV, estas notas se conservan (antes del 19/11/2026 se perdían).

## Cambios de reglas-v4

- **La colegiatura acredita la formación.** «Contadora Pública Colegiada» o «colegiatura vigente» ahora acreditan un requisito de título: en el Perú no se puede estar colegiado sin haber concluido la carrera, de modo que reglas-v3 rechazaba una evidencia más fuerte que las que aceptaba. «Colegio» a secas sigue sin acreditar nada, porque en el Perú designa la educación secundaria.

- **Formación «en trámite».** Una colegiatura o un título en trámite, en proceso o por obtener quedan pendientes de verificación, no acreditados.
- **Negación con «nulos».** «Conocimientos nulos de Excel» ya no acredita Excel.
- **Texto de PDF.** Se descartan los caracteres invisibles (guion suave, ancho cero) y se unen las palabras partidas por un guion al final de la línea («contabi-/lidad»). Un guion entre dos datos o un rango de años («2019-/2020») no se unen.
- **«- a la actualidad».** Se reconoce como periodo en curso; antes solo se entendía «a la actualidad» sin guion delante y «actualidad» a secas.
- **La pista de estudios debe estar cerca del término** (40 caracteres), no en cualquier parte de la oración. Cuando la extracción de un PDF pierde los saltos de línea, la «oración» puede ser la hoja entera: antes, un «Bachiller en Administración» del encabezado acreditaba una «Contabilidad» que aparecía mucho después, en el cargo. La señal de estudios «en curso» se sigue buscando en toda la oración, a propósito: cualquier indicio de que no están concluidos impide acreditar.
- **El nivel se lee en el ítem de la enumeración** donde está el término, cortando en comas, puntos y comas, paréntesis de cierre, viñetas y conjunciones. «Excel (nivel básico) y Power BI avanzado» ya no acredita un Excel intermedio-avanzado, porque el «avanzado» es de Power BI. Un rango dentro del mismo ítem («Excel básico-intermedio») sí acredita.
- **La sección de referencias no acredita nada.** Lo que viene tras «Referencias», «Referencias personales» o un rótulo «Referencias: …» describe a otra persona: antes, un «Juan Pérez, Contador Público Colegiado» del final del CV acreditaba el título del candidato. Se reconoce el encabezado en su propia línea y el rótulo dentro de la línea, y la sección se cierra si después vuelve una sección del candidato («Formación académica», «Experiencia»…).
- **Un término de uno o dos caracteres solo cuenta escrito como sigla** (todas sus letras en mayúscula) o exactamente igual que en el requisito. El término «SI» de «Sistemas de Información» acreditaba con el «Si» de «Si bien no manejo Excel»; «B2», «TI», «C» o «Go» siguen funcionando. Conviene además configurar junto al término corto uno largo, como ya se hace en «Inglés intermedio (B2)».
- **La pista de estudios se busca por línea, no por oración.** En «Universidad Ficticia | Contabilidad | 2016-2021» la barra corta la oración y dejaba la carrera sin su pista, aunque es un formato de plantilla muy frecuente. La señal de estudios sin terminar se busca en la misma línea, con un tope de 200 caracteres alrededor del término para que en una hoja sin saltos de línea no la bloquee un «en curso» de otra sección.
- **Lo que hace otra persona no acredita al candidato.** «Mi equipo utilizaba Concar» o «La empresa utiliza SAP» quedan pendientes de verificación. La regla es deliberadamente estrecha —exige determinante y que el tercero abra la frase— porque el lenguaje de un CV nombra a terceros sin dejar de hablar del candidato: «Implementé SAP en la empresa», «Capacité al equipo en Concar» o «Mi equipo y yo implementamos Concar» siguen acreditando.

- **Palabras que el PDF abre letra por letra.** «C O N T A B I L I D A D   G E N E R A L» se reconstruye antes de colapsar los espacios, que es el único momento en que la información existe: dentro de una palabra las letras van separadas por un espacio y entre palabras por dos o más. Se decide por línea y solo si la línea es mayoritariamente de letras sueltas (al menos cuatro y el 60 %), para no tocar la prosa normal, donde «y», «o», «e», «u» y «a» son palabras de una letra legítimas.

  Hay un límite que conviene conocer, comprobado con PDF generados por Chromium y leídos con pdf.js: **esa extracción deja un solo espacio también entre palabras**, así que «E X P E R I E N C I A   L A B O R A L» llega con huecos iguales y se reconstruye como «experiencialaboral». La frontera de palabra no está en el fichero y no hay nada que recuperar. Donde más dolía era en los encabezados de sección —sin encabezado no hay sección de experiencia y sin ella no se calculan los años de nadie—, y ahí sí se puede resolver, porque los encabezados son un conjunto cerrado y pequeño: se comparan también sin espacios, y solo en las líneas que vienen espaciadas. Para el texto corrido de una línea espaciada con varias palabras no hay solución, y queda declarado como límite.

- **Un salto de línea no termina la frase.** En un PDF la prosa se parte por el ancho de la hoja. «… atención al personal. No cuento» / «con experiencia en planillas…» es UNA frase, y tratar el salto como fin de oración dejaba la negación en la línea anterior: el motor acreditaba justo lo que la persona decía no tener. Ahora el salto se considera continuación cuando lo que lo precede no cierra la frase (ni «.», «:», «;», «!», «?», ni viñeta) y lo que sigue abre en minúscula. Una entrada nueva empieza en mayúscula, con viñeta o tras un punto, así que sigue cortando. Solo se ve con PDF reales: un texto escrito a mano en una prueba nunca se parte así.
- **Escalera de grados académicos.** En el Perú egresar no da el bachillerato y el bachillerato no da el título. Un puesto que pide «título profesional» ya no queda acreditado con «Egresado de Contabilidad» ni con «Bachiller en Contabilidad»: queda pendiente de verificación, con la cita delante. El grado que exige el requisito es el **menor** de los que nombra, porque las vacantes se redactan como alternativas («Título o bachiller en Contabilidad»); el que muestra el CV es el **mayor** de los que nombra, leído en la línea completa, de modo que un grado mayor en otra parte de la línea protege al candidato. Solo entran los marcadores inequívocos: «universidad», «instituto», «carrera», «estudios», «grado», «posgrado» y «diplomado» dicen dónde o qué se estudió, no qué grado se obtuvo, así que nunca bloquean. «Colegio» es secundaria salvo en «Colegio de Contadores Públicos», que significa lo contrario.
- **La negación se acota a su proposición.** Antes solo alcanzaba tres palabras, así que «No cuento con experiencia en Concar» acreditaba Concar. Ahora se corta en el último cambio de proposición —coma, punto y coma, dos puntos, paréntesis, «pero», «aunque»— y dentro de ella la ventana es de cinco palabras. Las dos cosas van juntas: la ventana ancha sin el corte empezaría a negar lo que no debe («No es un problema el cierre a presión, manejo Concar a diario» sigue acreditando). «y» y «o» no cortan a propósito: «no manejo Concar y Excel» niega los dos.
- **Un correo o un enlace no acreditan.** «sap@miempresa.com» o «concar.com.pe/mi-perfil» mencionan el término sin decir nada de que la persona lo maneje. Se mira el token completo que contiene la coincidencia, no la oración, de modo que el correo de la línea de contacto no afecta al resto del CV.
- **Deseo expresado después del término.** «Cursos de Concar que planeo tomar» ya no acredita. Solo cuentan los verbos de adquirir (tomar, llevar, cursar, aprender, certificarse): «Excel avanzado, que quiero perfeccionar» supone que ya lo usa y sigue acreditando.
- **Nivel de idioma por el código del marco europeo.** Un CV peruano escribe «Inglés A2» mucho más a menudo que «Inglés básico», y antes «Inglés A2» acreditaba un requisito de «Inglés intermedio (B2)»: A2 es elemental, justo lo contrario. Ahora los códigos A1 a C2 se comparan como niveles, con la misma asimetría que la escalera de grados: del requisito se toma el **menor** código que nombra (las vacantes se escriben como rango, «intermedio B1-B2», y lo que importa es el mínimo aceptable) y del CV el **mayor** que declara. Así un B1 no acredita un B2, y un C1 sí. Si el CV no trae código se vuelve a la comparación por palabras: no declarar el nivel no es declararlo bajo. La regla se aplica **solo a requisitos de idioma** (por categoría o porque la descripción nombra un idioma), y por eso «Ventas B2B» no se ve afectado.

### Decisiones de negocio registradas

- **05/11/2026 · Un diplomado acredita un requisito de título o bachiller.** La empresa acepta esa equivalencia. El reclutador ve la cita literal («Diplomado en Contabilidad Gerencial, 40 horas») y decide. Técnicamente se sostiene dejando «diplomado» fuera de `DEGREE_LADDER` (`rule-engine.ts`): está en `STUDY_CUES`, así que acredita, pero no tiene rango, así que nunca se compara con el grado que pide la vacante. Si la política cambia, hay que darle rango en la escalera y actualizar el caso correspondiente de `scripts/medir-motor/legitimo.ts`.

### Límites conocidos, declarados a propósito

- **El término coincide con el nombre del empleador.** «Recepcionista en Concar Consultores SAC» acredita un requisito de «Concar (software contable)». Es genuinamente ambiguo —el software y la empresa se llaman igual— y una regla que mirase el sufijo societario castigaría a quien escribe «Implementé Concar en Comercial SAC». Se deja acreditado con la cita literal delante, que es lo que el reclutador necesita para descartarlo de un vistazo.
- **Negación que encabeza una lista.** «No manejo los siguientes sistemas:» seguido de viñetas acredita cada viñeta: la negación está en otra línea, fuera del alcance de la regla. No se corrige porque un CV real no enumera lo que la persona no sabe hacer, y una regla que arrastre la negación entre líneas tiene mucho más que perder que ganar.
- **Años de dos dígitos con punto.** Desde reglas-v13 se leen «01/19 – 12/23», «15/03/19», «Ene-19» y «Jan '19» (un «19» es 2019 si no pasa del año de la evaluación y del siglo anterior si pasa: «98» es 1998). Con punto («01.19 - 12.23») no, porque puede ser un decimal, y un año suelto de dos dígitos tampoco: el requisito de años queda pendiente de verificación, nunca negado.

### Cómo se mide el motor

Cinco bancos, los cinco deterministas y sin red ni base de datos:

| Comando | Qué mide | Estado |
|---|---|---|
| `npm run medir:motor` | 32 CV ficticios completos en PDF, 8 puestos: ¿ordena a los candidatos según su ajuste real? | 8 de 8 puestos |
| `npm run medir:motor:adversario` | 43 textos escritos para que acredite de más | 43 de 43 |
| `npm run medir:motor:legitimo` | 47 textos que SÍ demuestran el requisito y debe acreditar | 47 de 47 |
| `npm run medir:motor:escaneado` | Los mismos 32 CV llegados **escaneados**, por la ruta real de OCR | 8 de 8 puestos, 0 INFLA |
| `npm run medir:motor:docx` | Los mismos 32 CV en **.docx**, la otra ruta de extracción | 8 de 8 puestos, 0 cambios |

Los dos últimos comparten el criterio y el informe (`comparacion.ts`): la referencia de cada requisito es el PDF con capa de texto, y lo inaceptable es que la fuente **INFLE** —que acredite algo que el PDF no acreditaba, porque cambiar el formato de un archivo no puede inventar evidencia— o que se rompa el orden dentro de la vacante.

**`npm run verificar:motor`** corre los cuatro bancos rápidos de un tirón y **devuelve error si alguno falla**, que es lo que permite usarlos como puerta antes de confirmar cambios. `npm run verificar:motor:completo` añade los dos perfiles de escaneado (varios minutos: el OCR va de uno en uno).

Los cinco devuelven código de salida distinto de cero cuando fallan, y eso está comprobado invirtiendo a propósito la verdad de referencia. Importa decirlo porque no fue así desde el principio: `medir:motor` imprimía «orden INCORRECTO» y terminaba con éxito, de modo que el banco que comprueba el orden de 32 candidatos no podía frenar nada. Una medición que no puede fallar es decoración, no una prueba.

Los CV se regeneran con `npx tsx scripts/generar-cv-prueba.ts`. Los tres puestos añadidos después de los cinco originales (enfermería, planillas y residente de obra) no llevan expectativa de puntaje: su referencia es el orden entre candidatos. Cargan contra lo que los primeros no tocaban —requisitos legales, grados académicos del Perú, siglas cortas— y dos de sus CV llevan defectos de maquetación reales (títulos espaciados letra por letra y formación en una línea con barras) que pasan por pdf.js de verdad. Esos dos son los que descubrieron el límite del espaciado y el corte de línea de la negación: ninguna prueba con texto escrito a mano los habría encontrado.

Los dos últimos miden en direcciones opuestas y hacen falta los dos: con solo el adversario, cualquier regla más desconfiada parece una mejora. El error caro en esta plataforma es el del banco legítimo, porque un candidato inflado se descarta de un vistazo —la evidencia está a la vista— y uno enterrado no se ve.

#### El banco de escaneados

Usa la ruta real de la aplicación para un PDF sin capa de texto: pdf.js rasteriza la página y tesseract.js la reconoce en español con datos locales, sin salir de la máquina. Los PDF escaneados se generan con `npx tsx scripts/generar-cv-escaneado.ts` a partir de los mismos CV, con dos perfiles y degradación **determinista** (el ruido se siembra con el nombre del archivo, así que se regeneran idénticos):

| Perfil | Qué imita | Resultado |
|---|---|---|
| `oficina` | 150 dpi, ±0,4° de inclinación, ruido bajo, JPEG 70: una multifunción corriente | 8 de 8 en orden · 1 pérdida |
| `foto` | 100 dpi, ±1,3°, desenfoque, ruido alto, JPEG 45: una foto del CV impreso con el móvil | 8 de 8 en orden · 4 pérdidas |

El criterio de aprobado no es «el mismo resultado que con la capa de texto», que sería absurdo: el OCR pierde caracteres. Lo inaceptable es otra cosa, y de eso no hubo nada en ninguno de los dos perfiles:

1. **INFLA**: que el OCR haga acreditar algo que el texto limpio no acreditaba. Un carácter mal leído no puede inventar evidencia. **0 casos.**
2. **Orden roto** dentro de la vacante, que es lo que usa el reclutador. **0 casos.**

Perder un requisito hacia «sin evidencia» o «pendiente» es la degradación aceptable: el reclutador lo ve marcado para revisar. Las cinco pérdidas son todas **errores de un solo carácter** sobre términos que exigen coincidencia exacta: `(B2)` leído `(82)`, `Git` leído `Gil`, `conciliaciones` leído `concillaciones`, `inventarios` perdido en una línea borrosa.

**No se añade tolerancia a confusiones de OCR** (8↔B, 1↔l, 0↔O) ni coincidencia aproximada. En texto limpio inventaría coincidencias sin control, y el motor no sabe de dónde vino el texto, así que no puede aplicar la tolerancia solo donde sería segura. Recuperaría dos valoraciones de unas 250 a cambio de poder inventar evidencia justo en el texto menos fiable del sistema: no vale la pena.

**Regla de configuración que salió de aquí:** cuando un requisito lleva un término corto y frágil, el término largo de respaldo **no puede contenerlo**. La vacante de logística configura `"B2"` y `"Inglés intermedio (B2)"`, y el OCR tumbó los dos a la vez porque el largo lleva el corto dentro del paréntesis. Con `"inglés intermedio"` como respaldo habría acreditado. El caso se deja fallando a propósito en el banco: es el que documenta la lección.

#### El banco de .docx

`ResumeFileKind` acepta `pdf` y `docx`, y hasta aquí todos los bancos entraban por PDF. Un .docx no se parece por dentro: un párrafo es UN texto, se parta donde se parta al imprimirlo, así que no existe el corte de línea por el ancho de la hoja —justo lo que rompía la negación en los PDF— ni las letras espaciadas por el renderizador. En cambio aparecen dos cosas que el PDF no tiene: la **cabecera**, que vive en otra parte del archivo (dos de los CV llevan ahí los datos de contacto, y la extracción los antepone, de modo que el texto empieza por el correo y no por el nombre) y las **tablas**, donde van las habilidades, como en tantas plantillas de Word.

Los .docx se generan con `npx tsx scripts/generar-cv-docx.ts` —se construyen con `fflate`, porque un .docx es un zip con XML— y el texto extraído difiere del PDF entre un 3 % y un 4 %. Ninguna valoración cambia: el motor es robusto al formato.

### Auditoría de los criterios de una vacante

`src/modules/evaluation/requirement-audit.ts`, visible en la pestaña **Criterios** de la vacante para quien puede gestionarla, y ejecutable sobre el banco con `npm run auditar:vacantes`.

El motor solo encuentra los términos que alguien escribió en la vacante, así que buena parte de sus errores no están en el motor: están en la configuración. La auditoría responde «qué hará el motor con estos requisitos» antes de evaluar a nadie, y **no bloquea nada**: los criterios los decide RRHH.

Cada comprobación corresponde a un comportamiento medido o a una regla documentada, y lo dice en el propio aviso. Son: requisito sin términos (el motor no puede evaluarlo); término de uso corriente que acreditaría a cualquiera; término de uno o dos caracteres sin respaldo largo; **respaldo largo que contiene al término corto**, que es el caso medido en el banco de escaneados («Inglés intermedio (B2)» leído «(82)»: cayeron los dos términos a la vez); término redundante; requisito de formación cuya descripción no nombra el grado (la escalera de grados lee la descripción, no los términos); nivel exigido en los términos pero no en la descripción; y requisitos esenciales que copan más de la mitad del peso, que dejarían toda evaluación en «faltan datos».

Dos cosas importantes de su diseño:

- **Usa los predicados del propio motor** (`requiredDegree`, `asksForHigherLevel`, `isFormationRequirement`, `SHORT_TERM_MAX`, `findTermOccurrences`, `termVariants`) en lugar de una copia. Una auditoría que derive del motor es peor que no tenerla: avisaría de lo que ya no pasa y callaría lo que sí.
- **La redundancia se decide con la búsqueda del motor, no comparando cadenas.** El motor exige límite de palabra en los extremos alfanuméricos, así que «AFP» NO coincide dentro de «AFPnet» y aconsejar quitarlo perdería cobertura, mientras «SAP» sí coincide dentro de «SAP MM». La primera versión comparaba cadenas y daba cuatro consejos equivocados sobre los 62 requisitos del banco; hay una prueba que lo vigila.

Sobre esos 62 requisitos reales la auditoría deja 1 riesgo (el del «B2») y 5 avisos: suficiente para ser útil sin convertirse en ruido que nadie lee.

**Lo que ningún banco cubre todavía:** CVs reales de portales. Los 32 PDF de `cv-prueba/` se generan en el propio repositorio, así que su maquetación es la que decidimos nosotros, no la que trae un candidato.

Todos salieron del banco adversario (`npm run medir:motor:adversario`), menos el primero, que salió de medir el motor contra los 20 CV ficticios (`npm run medir:motor`): era el único caso en que un candidato de ajuste fuerte quedaba por debajo de uno más débil.

## Cambios de reglas-v3

El motor sigue siendo determinista y local, pero ahora razona por **oraciones** y no solo por palabras sueltas:

- **Variantes de palabra:** busca singular/plural y masculino/femenino («comprobante» ≈ «comprobantes», «contador» ≈ «contadora»). No mezcla palabras distintas aunque se parezcan («contador» ≠ «contacto»).
- **Evidencia = la oración completa** del CV donde aparece el término, eligiendo primero las oraciones que reúnen más términos distintos del requisito. Las palabras encontradas se resaltan en pantalla.
- **Años de experiencia:** además de «3 años de experiencia», reconoce «tres años como…», «5+ años en…», «experiencia de más de 4 años». Cuenta primero la mención que está en la misma oración que el término. No toma la edad («26 años») ni la antigüedad de una empresa («30 años en el mercado»).
- **Negaciones e intereses:** «sin experiencia en SAP» o «interés en Contabilidad» no acreditan el requisito; quedan «Por confirmar».
- **Formación:** un requisito de título o estudios solo se acredita si el término aparece en una frase de estudios concluidos (bachiller, titulado, universidad, colegiatura…). Estudios «en curso» o el término en un cargo («Asistente Contable») no bastan.
- **Nivel:** si el puesto pide nivel intermedio o avanzado y el CV declara solo nivel básico, queda «Por confirmar».

**Límite que se mantiene:** el motor no entiende el significado. Una oración puede contener las palabras y no demostrar el requisito. Por eso el resultado es una referencia y lo decide una persona.

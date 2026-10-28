# Cómo funciona la plataforma de reclutamiento

**Versión 1 · 27/10/2026.** Describe lo que la plataforma hace **hoy**. Todo lo descrito está implementado y probado en un equipo local con datos ficticios. Aún no se ha probado en internet ni con postulantes reales. Lo que todavía no existe se indica en la sección [Lo que todavía no hace](#lo-que-todavía-no-hace).

## Resumen

La plataforma es una aplicación web interna para el área de Recursos Humanos (RRHH). Reúne en un solo lugar las vacantes, los CV de los postulantes y la evaluación de cada uno. Compara cada CV con los requisitos del puesto y muestra la evidencia encontrada. Nunca descarta a nadie por sí sola: siempre decide una persona de RRHH. Cada decisión queda registrada.

## Para qué sirve

Sin la plataforma, los CV llegan por varios portales y correos, cada persona los revisa a su manera y las decisiones quedan dispersas. Con la plataforma:

- todos los CV de una vacante quedan juntos, con el portal del que vinieron;
- todos los candidatos se comparan con los **mismos requisitos**, aprobados antes de evaluar;
- cada evaluación muestra **por qué**: qué requisito encontró en el CV, con la frase exacta, y cuál no pudo comprobar;
- cada cambio de estado guarda quién lo hizo, cuándo y por qué.

## Quién la usa

| Quién | Qué hace |
|---|---|
| **Administración** | Todo lo que hace RRHH. Además, decide quién entra a la plataforma y con qué rol. |
| **RRHH** | Lleva el proceso completo: crea vacantes, define requisitos, recibe los CV, revisa las evaluaciones y decide el estado de cada candidato. |
| **Postulantes** | No tienen cuenta ni entran a la plataforma. Solo verán la página pública de empleos (ver el paso 4). |

Nadie se registra solo: solo Administración puede dar acceso a otra persona. Los dos roles ven todas las vacantes y todos los candidatos.

## Conceptos básicos

| Término | Significado |
|---|---|
| **Vacante** | El puesto que se quiere cubrir, por ejemplo «Analista de datos». Pasa por cuatro estados: Borrador, Publicada, Cerrada y Archivada. |
| **Requisito** | Algo que se pide para el puesto, por ejemplo «Manejo de SQL». Tiene tipo, prioridad (obligatorio o deseable), un peso del 1 al 10 y las palabras con que puede aparecer en un CV. |
| **Criterios aprobados** | El conjunto de requisitos que RRHH aprueba antes de evaluar. Así se compara a todos con lo mismo. Si se cambian, hay que volver a aprobarlos y se crea una versión nueva. |
| **Candidato** | La persona, con sus datos de contacto y sus CV. |
| **Postulación** | Un candidato en una vacante concreta. Un candidato solo puede tener una postulación en proceso a la vez. |
| **Evaluación de compatibilidad** | La comparación del CV con los requisitos aprobados. Es orientativa. |
| **Estado del proceso** | En qué punto está cada postulación: Nuevo, En revisión, Preseleccionado, Entrevista programada, En evaluación, Seleccionado, No seleccionado, En reserva o Retirado. Solo lo cambia una persona. |
| **Portal de origen** | El sitio donde la persona encontró la vacante: Computrabajo, Bumeran, LinkedIn, Indeed, etc. |
| **Lote** | Un grupo de CV que se suben juntos, todos del mismo portal y para la misma vacante. |
| **Bandeja de entrada** | La pantalla «Postulaciones nuevas», que reúne lo que va llegando a todas las vacantes. |
| **Página pública** | La página de empleos que puede ver cualquier persona, sin cuenta. |
| **Feed** | Un archivo con la lista de vacantes abiertas, que leen de forma automática los buscadores de empleo como Jooble, Trovit o Talent.com. |

## Lo que se ve al entrar

Después de iniciar sesión, el menú lateral muestra:

- **Panel:** resumen del día. Muestra las solicitudes de opinión pendientes, los candidatos por etapa, los candidatos por vacante publicada (con cuántos faltan evaluar) y la actividad reciente.
- **Postulaciones:** la bandeja de entrada.
- **Vacantes:** la lista de puestos y el botón para crear uno nuevo.
- **Candidatos:** todos los candidatos, con búsqueda y filtros.
- **Usuarios:** solo para Administración. Sirve para invitar personas, cambiar su rol y desactivar cuentas.

En el encabezado hay una **campana** que se pone amarilla cuando alguien pide una opinión.

La sesión se cierra sola tras **30 minutos sin actividad**. Un minuto antes aparece el aviso «¿Sigue ahí?».

## Un caso real, paso a paso

**Situación (ficticia).** La empresa necesita un **Analista de datos** en Lima. En RRHH trabajan **Ana**, jefa del área, con rol Administración, y **Luis**, analista, con rol RRHH. Los postulantes **Lucía Ramos**, **Mario Torres** y **Rosa Quispe** también son ficticios.

### Vista general

```
 1. Ana da acceso a Luis
 2. Luis crea la vacante                      (estado: Borrador)
 3. Luis define los requisitos
 4. Luis aprueba los criterios y pulsa «Publicar»   (estado: Publicada)
        ├─ la vacante aparece en la página pública, en Google y en el feed (*)
        └─ Luis publica el aviso en Computrabajo, Bumeran, LinkedIn…
 5. Los postulantes postulan dentro de cada portal
 6. Luis descarga los CV de cada portal y los sube en un lote
 7. La plataforma lee cada CV, registra a cada persona y la evalúa sola
 8. Las postulaciones aparecen en la bandeja «Postulaciones nuevas»
 9. Luis revisa la evaluación de cada candidato
10. (Opcional) Luis pide la opinión de Ana
11. Luis decide el estado de cada candidato
12. Luis cierra la vacante                    (estado: Cerrada)

(*) Cuando la plataforma esté en internet. Hoy solo funciona en el equipo local.
```

### Paso 1 · Dar acceso (una sola vez)

Ana entra en **Usuarios**, invita a Luis con su correo de trabajo y le asigna el rol **RRHH**. Luis recibe un correo para crear su contraseña.

Si algún día Luis deja la empresa, Ana desactiva su cuenta. La cuenta pasa a la **papelera**, desde donde se puede reactivar o eliminar. Si se elimina, su nombre sigue en el historial con la marca «(eliminado)».

### Paso 2 · Crear la vacante

Luis entra en **Vacantes** y crea una vacante nueva. Completa:

- título, área, descripción, responsabilidades, modalidad (presencial, remoto o híbrido) y fechas;
- la sección **Publicación**, para la página pública:
  - ciudad y región (Lima, Lima);
  - tipo de empleo (Tiempo completo);
  - sueldo: es **opcional**; si se indica, se piden la moneda (soles o dólares) y el periodo (por mes, por año…);
  - la casilla **«Confidencial»**: si se marca, la vacante no aparece en la página pública, en Google ni en los buscadores de empleo.

La vacante queda en **Borrador**: nadie de fuera la ve.

### Paso 3 · Definir los requisitos

En la pestaña **«Requisitos y criterios»** de la vacante, Luis pulsa «Agregar requisito» por cada cosa que se pide:

| Requisito | Tipo | Prioridad | Peso | Palabras de búsqueda |
|---|---|---|---|---|
| Consultas SQL | Herramienta o programa | Obligatorio | 8 | SQL, SQL Server |
| Excel avanzado | Herramienta o programa | Obligatorio | 6 | Excel, tablas dinámicas |
| Título en ingeniería industrial o afín | Formación académica | Obligatorio | 5 | ingeniería industrial, ingeniero industrial |
| Power BI | Herramienta o programa | Deseable | 4 | Power BI |
| Inglés intermedio | Idioma | Deseable | 3 | inglés |

- El **peso** indica la importancia de cada requisito. Aquí suman 26: SQL vale 8 de 26, es decir, alrededor del 31 % del total.
- Las **palabras de búsqueda** son las formas en que el requisito puede aparecer escrito en un CV. La plataforma busca exactamente esas palabras, sin distinguir mayúsculas ni tildes, y no adivina sinónimos que no se hayan escrito.
  - Para ayudar, al escribir «Excel» la pantalla sugiere términos relacionados como «+ tablas dinámicas», «+ macros» o «+ VBA», y Luis pulsa los que correspondan o «Agregar todos».
  - Las sugerencias salen de un diccionario fijo de 27 áreas: Excel, contabilidad, tributación, planillas, SAP, inglés, logística, ventas, SST y otras.
- Se pueden pedir **años mínimos** de experiencia. La plataforma los da por cumplidos en dos casos:
  - si el CV lo dice de forma explícita, por ejemplo «5 años de experiencia»;
  - si, en la sección de experiencia, las fechas de los empleos relacionados con el requisito suman el mínimo. Por ejemplo, «Asistente contable (03/2019 – 12/2022)» y «Analista contable (01/2023 – actualidad)» suman más de 7 años.

  Las fechas de estudios no cuentan. Si alguna fecha solo trae el año y no alcanza con seguridad, el requisito queda pendiente de verificar.
- Algunos requisitos nunca se dan por cumplidos solo con el CV y siempre quedan para que una persona los compruebe. Es el caso de las competencias, como «trabajo en equipo», y de los requisitos legales o esenciales.

### Paso 4 · Aprobar los criterios y publicar

1. Luis pulsa **«Aprobar criterios»**. Queda registrada la «versión 1». Desde ese momento todos los candidatos se comparan con esa versión.
2. Luis pulsa **«Publicar»** y confirma. La vacante pasa a **Publicada**.

Para publicarla, la plataforma exige una descripción de al menos 50 caracteres, el tipo de empleo, y la ciudad y la región, salvo que el puesto sea remoto. Si falta algo, dice qué. Las vacantes confidenciales no tienen esta exigencia.

Al publicarla, si no es confidencial:

- aparece en la **página pública de empleos**, con su propia dirección. Se ven el título, la descripción, las responsabilidades, la ubicación, el tipo de empleo, el sueldo si se indicó, y los requisitos con su descripción y si son obligatorios o deseables. **Nunca** se muestran los pesos, las palabras de búsqueda, el responsable ni las postulaciones;
- la página incluye los datos que Google necesita para mostrarla en su buscador de empleos;
- entra en el **feed** que leen los buscadores de empleo;
- en la ficha interna de la vacante aparece el enlace a su página pública, con un botón «Copiar».

> **Hoy** esto funciona solo en el equipo local. Para que Google y los buscadores la encuentren hace falta ponerla en internet: un dominio, el registro en Google Search Console y el alta en cada buscador.

**Postular desde la página.** Cada página pública tiene un formulario de un solo paso. Pide el nombre, el correo, el teléfono, el CV (PDF o Word, hasta 4 MB), y opcionalmente la ciudad y el perfil de LinkedIn. Hay que aceptar el aviso de privacidad vigente. Hay además una casilla opcional, desmarcada, para que conserven el CV para futuras vacantes.
- Al enviar, la persona recibe un número de referencia.
- La postulación llega sola a la bandeja con el portal «Página de empleos», o «Google» si llegó desde Google, y la forma de ingreso «Formulario en línea». Se evalúa por reglas.
- Si la misma persona postula dos veces, recibe la misma respuesta, para no revelar quién ya postuló, y RRHH la ve marcada como «Posible duplicado».
- El formulario solo aparece si hay un aviso de privacidad **vigente**. Lo activa Administración en «Configuración → Privacidad», con la referencia de la aprobación legal.

### Paso 5 · Difundir en los portales de empleo

La plataforma **no puede** publicar sola en Computrabajo, Bumeran, LinkedIn o Indeed. Esos portales no ofrecen una vía pública y gratuita para hacerlo. Luis copia el aviso en cada portal, como se hace hoy.

Los postulantes postulan **dentro de cada portal**, sin pasos adicionales.

### Paso 6 · Subir los CV en lote

Después de unos días, Luis descarga desde Computrabajo los CV que llegaron. En la ficha de la vacante:

1. Pulsa **«Carga masiva de CV»**.
2. Elige el portal de origen, «Computrabajo», y pulsa **«Iniciar lote»**.
3. Selecciona los archivos de una sola vez: hasta 50 por lote, en PDF o Word, de hasta 4 MB cada uno.

La plataforma lee cada archivo y, por cada uno, muestra una fila con:

- el **nombre**, el **correo** y el **teléfono** que encontró en el CV, para que Luis los confirme o los corrija;
- un aviso de **error** si el archivo está dañado o no es un PDF o Word válido; ese archivo no detiene a los demás;
- un aviso de **posible duplicado** si ya existe alguien con el mismo correo, teléfono, nombre o el mismo archivo. En ese caso la fila queda desmarcada, para que Luis decida.

En el ejemplo, Luis sube tres CV:

| Archivo | Resultado de la lectura | Qué hace Luis |
|---|---|---|
| CV de Lucía Ramos | Nombre, correo y teléfono encontrados | Lo deja marcado |
| CV de Mario Torres | Nombre y correo encontrados; teléfono no | Escribe el teléfono y lo deja marcado |
| CV repetido de una persona que ya postuló | Aviso: posible duplicado (mismo correo) | Lo deja desmarcado |

Luis pulsa **«Registrar seleccionados (2)»**. La plataforma crea a cada candidato con su CV, lo asocia a la vacante con el portal «Computrabajo» y el método «Carga masiva», y **lo evalúa sola**. Al final muestra un resumen: «Registrados: 2 · Evaluados por reglas: 2».

Al terminar, Luis pulsa **«Cerrar lote»**. Lo que quedó sin registrar se borra.

Repite el proceso con los CV de Bumeran, eligiendo «Bumeran» como portal. Así llega el CV de Rosa Quispe, que es una **imagen escaneada**. La plataforma lo lee con **reconocimiento automático de texto (OCR)**, dentro del propio servidor, y propone su nombre y su teléfono. La fila avisa que esos datos salieron de un escaneo. El correo no se reconoció bien, porque el OCR suele leer mal la arroba, así que Luis lo escribe a mano antes de registrar.

> **Atención con Computrabajo.** Sus condiciones de uso, actualizadas el 14/10/2026, prohíben formar una base privada de CV fuera de sus herramientas sin autorización escrita. Antes de usar la carga masiva con CV de Computrabajo, legal debe revisarlo. Ver [opcion-correos-de-aviso.md](opcion-correos-de-aviso.md#advertencia-sobre-computrabajo).

> Un candidato que llega por otra vía, por ejemplo un **referido** que envía su CV por correo, se registra a mano desde **Candidatos** con «Registrar candidato». Si se parece a alguien ya registrado, aparece un aviso de posible duplicado.

### Paso 7 · La bandeja de entrada

En **Postulaciones**, la pantalla «Postulaciones nuevas» reúne lo que va llegando a todas las vacantes. Por cada postulación muestra el candidato, la vacante, el portal y la forma de ingreso. También se ven en la ficha de cada vacante.

En la ficha de la vacante, la pestaña **«Candidatos»** ordena a todas las personas de mayor a menor compatibilidad. Si hay postulaciones sin evaluar, aparece el botón **«Evaluar pendientes (N)»**. Pasa, por ejemplo, cuando se cargaron CV antes de aprobar los criterios o cuando los criterios cambiaron después. Luis lo pulsa una vez y:

- la plataforma evalúa todas esas postulaciones con el motor de reglas y muestra el avance;
- si encuentra un CV escaneado que aún no se leyó, intenta leerlo con OCR antes de evaluarlo;
- al final muestra un resumen: cuántas evaluó, cuáles quedaron sin texto legible (con un enlace a cada una) y cuáles no pudo evaluar;
- la lista queda ordenada por compatibilidad.

Las postulaciones de personas que se retiraron no se vuelven a evaluar. Si los criterios no están aprobados, en lugar del botón sale un aviso con un enlace a «Criterios».

### Paso 8 · Leer la evaluación

Luis abre la postulación de Lucía. La evaluación muestra, **por cada requisito**, una de estas valoraciones:

| Valoración | Qué significa |
|---|---|
| **Acreditado** | El CV lo menciona. Se muestra la frase exacta del CV como prueba. |
| **Sin evidencia suficiente** | El CV no lo menciona. **No significa que la persona no lo cumpla**: puede que no lo haya escrito. |
| **Pendiente de verificación** | Hace falta que una persona lo compruebe en una entrevista, con documentos o referencias. |
| **Aparentemente no cumplido** | La información indica que no se cumple. La evaluación automática por reglas **nunca** usa esta valoración, porque la ausencia de una mención no prueba nada. |

Con esas valoraciones calcula:

- la **puntuación**: qué parte del peso total está acreditada con evidencia;
- el **máximo alcanzable**: hasta dónde podría llegar si se confirmaran los requisitos sin evidencia o pendientes;
- un **nivel orientativo**: compatibilidad alta, compatibilidad parcial o evaluación pendiente, cuando falta información en más de la mitad del peso.

Resultado en el ejemplo:

| Requisito (peso) | Lucía Ramos | Mario Torres |
|---|---|---|
| SQL (8) | Acreditado: «Experiencia con SQL Server…» | Acreditado |
| Excel avanzado (6) | Acreditado | Sin evidencia |
| Título en ingeniería industrial (5) | Acreditado: «Formación en ingeniería industrial…» | Acreditado |
| Power BI (4) | Sin evidencia | Acreditado |
| Inglés (3) | Sin evidencia | Sin evidencia |
| **Puntuación** | 19 de 26 ≈ **73 %** (máximo alcanzable 100 %) | 17 de 26 ≈ **65 %** (máximo alcanzable 100 %) |
| **Nivel orientativo** | **Compatibilidad alta** (70 % o más, sin obligatorios incumplidos) | **Compatibilidad parcial** (entre 40 % y 70 %) |

El CV de Rosa es una **imagen escaneada** que la plataforma leyó con OCR. En su ficha, el texto aparece con el aviso «Texto obtenido por reconocimiento automático de imagen (OCR local). Puede contener errores: revíselo antes de decidir.» Luis compara el texto con el CV y corrige una palabra mal leída con **«Corregir texto»**. Después vuelve a evaluar.

Si el OCR no hubiera podido leerlo (una foto borrosa, por ejemplo), la ficha mostraría el botón **«Leer escaneo automáticamente»** para reintentarlo. También queda siempre la opción de transcribir el texto a mano. La plataforma nunca reemplaza un texto que RRHH ya corrigió o transcribió.

Cada evaluación nace **«Pendiente de revisión»**. Luis la revisa y pulsa **«Registrar revisión»** con una de estas opciones:

- **Conforme**;
- **Conforme con observaciones**, que exige escribirlas;
- **Requiere nueva evaluación**, que también exige observaciones.

Si corrige algo, por ejemplo el texto del CV, puede volver a evaluar. El historial conserva todas las evaluaciones.

### Paso 9 · Pedir una segunda opinión (opcional)

Luis duda con Mario y pulsa **«Pedir opinión»**, eligiendo a Ana. La campana de Ana se pone amarilla. Ana abre la postulación y responde con una observación. Entonces Luis recibe el aviso de que ya hay respuesta.

### Paso 10 · Decidir el estado

En la postulación, el formulario de estado **propone** un estado según la evaluación:

| Nivel de la evaluación | Estado propuesto |
|---|---|
| Compatibilidad alta | Preseleccionado |
| Compatibilidad parcial | En revisión |
| Evaluación pendiente | En revisión |

La propuesta **no se guarda sola**. La plataforma redacta un borrador del motivo y de la observación interna, que Luis puede editar. Luis revisa, cambia lo que quiera y pulsa **«Actualizar estado»**.

- Lucía pasa a **Preseleccionado**.
- Mario queda **En revisión** hasta tener la opinión de Ana.

Si Luis elige un estado que no concuerda con la evaluación, la plataforma muestra un aviso, pero le deja decidir.

Para «No seleccionado» y «Retirado» el **motivo es obligatorio**. Cada cambio guarda el estado anterior, el nuevo, quién lo hizo, cuándo y por qué.

A medida que avanza el proceso, Luis va moviendo a cada persona a **Entrevista programada**, **En evaluación** y, al final, a **Seleccionado**, **No seleccionado** o **En reserva**.

### Paso 11 · Cerrar la vacante

Cuando el puesto se cubre, Luis pulsa **«Cerrar»** en la vacante. Desde ese momento:

- no se pueden registrar nuevas postulaciones en ella;
- desaparece del listado público y del feed;
- su página pública muestra «Esta convocatoria ya no recibe postulaciones».

Si hace falta, se puede reabrir. Más adelante se **archiva** para sacarla de la vista diaria; nada se borra.

## Lo que la plataforma nunca hace

- **No rechaza ni selecciona a nadie por sí sola.** Puede proponer un estado, pero solo una persona lo guarda.
- **No oculta candidatos** por su puntuación: todos aparecen en el listado.
- **No inventa datos:** cada valoración «Acreditado» cita el texto del CV.
- **No permite borrar** candidatos, CV ni evaluaciones desde la aplicación. Si se cambia de criterio, se hace una evaluación nueva y la anterior queda en el historial.
- **No envía correos** a los postulantes.
- **No envía los CV fuera de la empresa.** La evaluación por reglas y la lectura de escaneados (OCR local) se hacen dentro de la plataforma. La evaluación con IA existe, pero está bloqueada (ver la sección siguiente).

Sobre seguridad y privacidad:

- los CV se guardan en un almacenamiento privado;
- cada descarga de un CV queda registrada;
- la revisión legal del tratamiento de datos personales sigue pendiente.

## Lo que todavía no hace

| Necesidad | Hoy (28/10/2026) | Qué se prevé |
|---|---|---|
| Estar en internet | Solo funciona en un equipo local | Proyecto en la nube, dominio y Search Console |
| Postular desde la página propia | Formulario construido y probado en local | Abrirlo al público cuando legal apruebe el texto del aviso y la plataforma esté en internet |
| Postulación dentro de Talent.com | No llega a la plataforma | Que llegue sola a la bandeja. Antes hay que confirmar con Talent.com el costo, si cubre Perú y el formato del CV |
| Computrabajo, Bumeran, LinkedIn, Indeed | Carga masiva de los CV descargados | No hay una vía pública y gratuita. Se evaluará leer los correos de aviso de los portales cuando exista el buzón de empleo |
| Correos a postulantes | No se envían | Etapa 3, siempre con aprobación de RRHH |
| Entrevistas | Solo existe el estado «Entrevista programada» | Módulo de entrevistas (Etapa 3) |
| Evaluación con IA | Implementada pero bloqueada | Se activa solo si la empresa aprueba por escrito el proveedor y el tratamiento de datos |
| CV escaneados | Se leen con OCR local y gratuito. Suele fallar con la arroba del correo, y solo se probó con escaneos generados de texto limpio | Lectura con IA como motor principal cuando se apruebe, con el OCR local de respaldo |
| Años de experiencia | Se calculan con las fechas de la sección de experiencia o con la mención explícita. Es una heurística: puede fallar en CV a columnas o sin encabezado «Experiencia» | Probarlo con CV reales; corrección manual por requisito tras la entrevista |
| Consultar la auditoría | Se guarda, pero no tiene pantalla | Pantalla de consulta para Administración |
| Varias empresas | Una sola empresa | Por definir |

## Más información

- [roles-y-permisos.txt](roles-y-permisos.txt): qué puede hacer cada rol, con detalle.
- [metodologia-evaluacion.md](metodologia-evaluacion.md): cómo se calcula la evaluación.
- [privacidad-y-legal.md](privacidad-y-legal.md): datos personales y temas legales pendientes.
- [pendientes.md](pendientes.md): limitaciones conocidas y lo que falta.
- [informe-pruebas.md](informe-pruebas.md): pruebas realizadas y sus resultados.

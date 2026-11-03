# CVs de prueba: guía para copiar y pegar

Todos los datos son **ficticios**: nombres, empresas, instituciones, correos (`@example.com`) y teléfonos (`999 000 0NN`) son inventados. No hay DNI ni direcciones reales. Los puestos, descripciones y sueldos de esta guía también son inventados para la prueba.

Hay 5 puestos con 4 CVs cada uno (20 PDFs, texto seleccionable). Cada puesto incluye un candidato muy fuerte, uno bueno, uno medio con carencias y uno que no cumple lo básico. Los PDFs se regeneran con:

```
npx tsx scripts/generar-cv-prueba.ts
```

Todo lo que sigue está pensado para pegarse tal cual. Los textos de los bloques de código se copian completos. Los valores entre comillas angulares «…» son etiquetas o botones de la pantalla (no se pegan).

---

## Orden para probar

Se necesita un usuario con rol `admin` o `rrhh` (los demás roles no pueden crear vacantes ni evaluar). Repetir los pasos 1 a 8 para cada uno de los 5 puestos.

1. **Crear la vacante.** Menú Vacantes, botón «Nueva vacante». Rellenar el formulario con el bloque «Datos de la vacante» del puesto y pulsar «Crear vacante». Queda en estado **Borrador** y la app abre su ficha.
2. **Cargar los requisitos.** En la ficha, pestaña «Requisitos y criterios». Por cada fila de la tabla «Requisitos», botón «Agregar requisito» (ventana «Nuevo requisito») y pulsar «Guardar». Campos de la ventana: «Tipo», «Prioridad», «Requisito», «Términos de búsqueda», «Peso (1 a 10)», «Años mínimos (opcional)» y la casilla «Requisito legal o esencial (exige verificación documental)» (solo se marca donde la tabla dice «sí»). Si el campo «Términos de búsqueda» muestra «Términos relacionados sugeridos», ignorarlos: se pegan los de la tabla.
3. **Aprobar los criterios.** En la misma pestaña, botón «Aprobar criterios» y confirmar con «Aprobar criterios». El botón está desactivado mientras no haya al menos un requisito. **Cualquier alta, edición o borrado de un requisito vuelve a dejar los criterios sin aprobar** y hay que aprobar de nuevo.
4. **Publicar.** Botón «Publicar» (arriba a la derecha de la ficha) y confirmar con «Publicar». La publicación **no** exige criterios aprobados. Para que la vacante salga en la página pública necesita descripción de al menos 50 caracteres, tipo de empleo y (si no es remota) ciudad y región; con los datos de esta guía se cumple. Si se publica y falta algo, la ficha muestra la alerta «No sale en Google ni en el feed de empleo».
5. **Pestaña «Portales».** Solo se pueden enviar vacantes a portales si están **publicadas**; en borrador la pestaña muestra «La vacante debe estar publicada». Si el robot no está configurado verá «Robot de portales apagado» (las solicitudes quedan en cola). Se marcan los portales y se pulsa «Guardar cambios»; también existe «Marcar publicada a mano».
6. **Cargar los CVs, opción A (recomendada, en lote).** En la ficha de la vacante, botón «Carga masiva de CV» (solo vacantes en Borrador o Publicada).
   1. Elegir en «Portal de origen de los CV» cualquiera (por ejemplo «Otro») y pulsar «Iniciar lote».
   2. Arrastrar o seleccionar los 4 PDFs de la carpeta del puesto (PDF o DOCX, máx. 4 MB cada uno; un lote admite hasta 50 archivos).
   3. En la tabla «Revisión» comprobar «Nombre», «Correo» y «Teléfono» de cada fila contra la tabla «Candidatos» del puesto y corregir si hace falta (el nombre propuesto sale del CV y puede venir mal).
   4. Pulsar «Registrar seleccionados (n)». Si los criterios ya están aprobados, la app evalúa cada candidato con el motor de reglas en ese mismo momento; si no, avisa «No se evaluaron porque los criterios de la vacante aún no están aprobados».
   5. Pulsar «Cerrar lote» al terminar (borra los archivos no registrados).
7. **Cargar los CVs, opción B (uno a uno).** Menú Candidatos, botón «Registrar candidato». Campos: «Nombre completo», «Correo», «Teléfono», «Ubicación», «Perfil de LinkedIn» (opcional, dejar vacío), «Fuente de la candidatura» (dejar «Registro manual»), «Detalle de la fuente» (vacío) y «Postula a» (elegir la vacante; solo aparecen las de Borrador o Publicada). Pulsar «Registrar candidato». Después, en la ficha del candidato, «Cargar CV (PDF o DOCX, máx. 4 MB)» y botón «Cargar». Si la app avisa de «Posibles candidatos duplicados» y es otra persona, pulsar «Es otra persona: registrar».
8. **Evaluar.** No se puede evaluar hasta aprobar los criterios (en la pestaña «Candidatos» no aparece el botón y se lee «Apruebe los criterios para evaluarlas»; en la postulación el botón sale desactivado con el aviso «Los criterios de la vacante no están aprobados.»).
   - Para todos a la vez: pestaña «Candidatos» de la vacante, botón «Evaluar pendientes (n)». Termina con el aviso «Evaluación terminada» y la lista queda ordenada por compatibilidad.
   - Para uno: abrir la postulación y pulsar «Evaluar con motor de reglas». El botón «Evaluar con IA» solo funciona si el servidor tiene IA configurada; esta guía no la necesita.
9. **Comparar.** Con al menos 2 postulaciones evaluadas aparece en la pestaña «Candidatos» el botón «Comparar los mejores»; también se pueden marcar casillas y pulsar «Comparar seleccionados (n)».

Si se cambia un requisito después de evaluar, hay que volver a aprobar los criterios y pulsar de nuevo «Evaluar pendientes».

### Cómo busca el motor de reglas (afecta a los resultados)

- Compara sin distinguir mayúsculas ni tildes y colapsa espacios. Un término debe aparecer como **palabra completa** (`venta` no encuentra «ventas»; `SQL` no encuentra «MySQL»).
- Si ningún término aparece, el requisito queda «Sin evidencia suficiente». **El motor nunca marca «no cumplido»**: la ausencia de una mención no prueba que la persona no cumpla.
- «Competencia» nunca se acredita por reglas: aunque se mencione queda «Pendiente de verificación». Lo mismo ocurre con los requisitos marcados «esenciales».
- Con «Años mínimos», acredita si cerca de los términos hay «N años de experiencia» con N suficiente, o si las fechas de los periodos de la sección de experiencia que mencionan los términos suman al menos ese mínimo. Si no, queda «Pendiente de verificación». Estos cálculos usan la fecha del día en que se evalúa; la guía se calculó con el 2026-11-03.
- Puntaje = peso de los requisitos «Acreditado» entre el peso total. Si más del 50 % del peso queda sin evidencia o pendiente, el nivel es «Evaluación pendiente».

---

## 1. Asistente Contable (carpeta `01_Asistente_Contable`)

### Datos de la vacante

| Campo (etiqueta exacta) | Valor a pegar |
|---|---|
| Título del puesto | `Asistente Contable` |
| Área o departamento | `Contabilidad y Finanzas` |
| Descripción | (bloque siguiente) |
| Responsabilidades | (bloque siguiente) |
| Ubicación | `Miraflores, Lima` |
| Modalidad | elegir «Presencial» |
| Tipo de contrato | `Plazo indeterminado` |
| Fecha de apertura | `2026-11-03` (el navegador la muestra como 03/11/2026) |
| Fecha de cierre | `2026-12-03` (03/12/2026) |
| Responsable del proceso | elige cualquier usuario |
| Ciudad | `Lima` |
| Región | `Lima` |
| Tipo de empleo | elegir «Tiempo completo» |
| Sueldo mínimo | `2800` |
| Sueldo máximo | `3600` |
| Moneda | elegir «Soles (PEN)» |
| Periodo | elegir «Por mes» |
| Confidencial | no marcar |

Descripción:

```
Buscamos un Asistente Contable para apoyar el registro de operaciones, la conciliación bancaria y la preparación de las declaraciones tributarias mensuales de una empresa comercial de Lima. Trabajará junto al contador general y participará en el cierre contable de cada mes.

Se valorará la experiencia en tributación peruana, el manejo de Excel y la capacidad para mantener la documentación ordenada y al día.
```

Responsabilidades:

```
- Registrar las operaciones de compras, ventas y tesorería en el sistema contable.
- Elaborar las conciliaciones bancarias mensuales de las cuentas de la empresa.
- Preparar la declaración mensual de IGV y renta (PDT 621) para revisión del contador.
- Llevar los libros electrónicos (PLE) y apoyar en la planilla electrónica (PLAME).
- Revisar y archivar los comprobantes de pago recibidos y emitidos.
- Apoyar en el cierre contable mensual y en la elaboración de los estados financieros.
- Atender los requerimientos de información de auditoría y de la administración tributaria.
```

### Requisitos

| Tipo | Prioridad | Requisito | Términos de búsqueda | Peso (1–10) | Años mínimos | ¿Esencial? |
|---|---|---|---|---|---|---|
| Formación académica | Obligatorio | Título o bachiller en Contabilidad | Bachiller en Contabilidad, Contadora Pública, Contador Público | 8 | (vacío) | no |
| Experiencia profesional | Obligatorio | Mínimo 3 años de experiencia en contabilidad general | contabilidad general, asistente contable, auxiliar contable | 9 | 3 | no |
| Habilidad técnica | Obligatorio | Conocimiento de tributación peruana (IGV, renta mensual, PDT 621) | IGV, PDT 621, SUNAT, tributación | 8 | (vacío) | no |
| Herramienta o programa | Obligatorio | Excel intermedio-avanzado | Excel avanzado, Excel intermedio | 6 | (vacío) | no |
| Certificación | Deseable | Colegiatura vigente en el Colegio de Contadores | Colegiada, Colegiado, Colegio de Contadores | 5 | (vacío) | **sí** (colegiatura: exige verificación documental) |
| Herramienta o programa | Deseable | Experiencia con SAP Business One o Concar | SAP Business One, Concar | 4 | (vacío) | no |
| Herramienta o programa | Deseable | Manejo de PLE y PLAME | PLE, PLAME | 3 | (vacío) | no |
| Habilidad técnica | Deseable | Conciliaciones bancarias | conciliaciones bancarias, conciliación bancaria | 5 | (vacío) | no |
| Habilidad técnica | Deseable | Emisión y registro de comprobantes de pago (facturas y boletas) | facturas, comprobantes, facturación electrónica | 3 | (vacío) | no |

### Candidatos

| Archivo | Nombre completo | Correo | Teléfono | Ajuste esperado |
|---|---|---|---|---|
| `01_Asistente_Contable\CV_Quispe_Carmen.pdf` | Carmen Rosa Quispe Huamani | carmen.quispe@example.com | 999 000 001 | Muy fuerte: contadora colegiada, 6 años, SUNAT, SAP |
| `01_Asistente_Contable\CV_Mendoza_Luis.pdf` | Luis Alberto Mendoza Rojas | luis.mendoza@example.com | 999 000 002 | Bueno: bachiller, 3 años, Concar; sin colegiatura ni PLE/PLAME |
| `01_Asistente_Contable\CV_Salazar_Patricia.pdf` | Patricia Salazar Cueva | patricia.salazar@example.com | 999 000 003 | Medio con carencias: administrativa que estudia contabilidad, sin título |
| `01_Asistente_Contable\CV_Paredes_Jorge.pdf` | Jorge Paredes Tello | jorge.paredes@example.com | 999 000 004 | No cumple: mecánico automotriz, otro rubro |

---

## 2. Ejecutivo Comercial B2B (carpeta `02_Ejecutivo_Comercial`)

### Datos de la vacante

| Campo (etiqueta exacta) | Valor a pegar |
|---|---|
| Título del puesto | `Ejecutivo Comercial B2B` |
| Área o departamento | `Comercial` |
| Descripción | (bloque siguiente) |
| Responsabilidades | (bloque siguiente) |
| Ubicación | `Cerro Colorado, Arequipa` |
| Modalidad | elegir «Híbrido» |
| Tipo de contrato | `Plazo indeterminado con comisiones` |
| Fecha de apertura | `2026-11-03` (03/11/2026) |
| Fecha de cierre | `2026-12-03` (03/12/2026) |
| Responsable del proceso | elige cualquier usuario |
| Ciudad | `Arequipa` |
| Región | `Arequipa` |
| Tipo de empleo | elegir «Tiempo completo» |
| Sueldo mínimo | `3500` |
| Sueldo máximo | `5500` |
| Moneda | elegir «Soles (PEN)» |
| Periodo | elegir «Por mes» |
| Confidencial | no marcar |

Descripción:

```
Buscamos un Ejecutivo Comercial B2B para captar y gestionar clientes empresariales del sector industrial y minero en el sur del país. Será responsable de una cartera de cuentas, de cumplir las metas de venta mensuales y de mantener el registro de cada oportunidad en el CRM.

Buscamos a una persona orientada a resultados, con experiencia demostrable en venta consultiva a empresas y disposición para viajar dentro de la región.
```

Responsabilidades:

```
- Prospectar y captar nuevos clientes empresariales del sector industrial y minero.
- Gestionar y desarrollar una cartera de cuentas clave.
- Elaborar y presentar propuestas comerciales y cotizaciones.
- Negociar precios, condiciones y contratos con los clientes.
- Cumplir las metas mensuales y trimestrales de venta asignadas.
- Registrar visitas, oportunidades y seguimiento en el CRM.
- Coordinar con almacén y facturación la entrega y el cobro de los pedidos.
```

### Requisitos

| Tipo | Prioridad | Requisito | Términos de búsqueda | Peso (1–10) | Años mínimos | ¿Esencial? |
|---|---|---|---|---|---|---|
| Experiencia profesional | Obligatorio | Mínimo 4 años de experiencia en ventas | ventas, ejecutiva comercial, asesor comercial, vendedor | 9 | 4 | no |
| Habilidad técnica | Obligatorio | Experiencia en ventas B2B a empresas | B2B, cuentas clave, contratos marco | 8 | (vacío) | no |
| Habilidad técnica | Obligatorio | Cumplimiento demostrable de metas comerciales | meta anual, meta trimestral, cumplimiento sostenido de metas, superé la meta, cumplí | 7 | (vacío) | no |
| Herramienta o programa | Obligatorio | Manejo de CRM | CRM, HubSpot, Salesforce, Zoho | 6 | (vacío) | no |
| Formación académica | Obligatorio | Estudios técnicos o universitarios en Administración, Marketing o afines | Administración de Empresas, Marketing | 5 | (vacío) | no |
| Experiencia profesional | Deseable | Experiencia en sector industrial o minero | industrial, minero, minería | 4 | (vacío) | no |
| Habilidad técnica | Deseable | Negociación de contratos | negociación de contratos, contratos marco | 3 | (vacío) | no |
| Idioma | Deseable | Inglés intermedio o superior | Inglés avanzado, Inglés intermedio | 2 | (vacío) | no |
| Herramienta o programa | Deseable | Excel a nivel usuario | Excel | 2 | (vacío) | no |

### Candidatos

| Archivo | Nombre completo | Correo | Teléfono | Ajuste esperado |
|---|---|---|---|---|
| `02_Ejecutivo_Comercial\CV_Vargas_Andrea.pdf` | Andrea Milagros Vargas Linares | andrea.vargas@example.com | 999 000 005 | Muy fuerte: 7 años B2B industrial, metas sobre 110 %, inglés C1 |
| `02_Ejecutivo_Comercial\CV_Chavez_Diego.pdf` | Diego Martín Chávez Orellana | diego.chavez@example.com | 999 000 006 | Bueno: 4 años en consumo masivo con CRM y metas; sin B2B industrial |
| `02_Ejecutivo_Comercial\CV_Espinoza_Rocio.pdf` | Rocío Espinoza Barrios | rocio.espinoza@example.com | 999 000 007 | Medio con carencias: solo retail, menos de 4 años, estudios en curso |
| `02_Ejecutivo_Comercial\CV_Gutierrez_Fernando.pdf` | Fernando Gutiérrez Aliaga | fernando.gutierrez@example.com | 999 000 008 | No cumple: técnico en enfermería |

---

## 3. Desarrollador Web Full Stack (carpeta `03_Desarrollador_Web`)

### Datos de la vacante

| Campo (etiqueta exacta) | Valor a pegar |
|---|---|
| Título del puesto | `Desarrollador Web Full Stack` |
| Área o departamento | `Tecnología` |
| Descripción | (bloque siguiente) |
| Responsabilidades | (bloque siguiente) |
| Ubicación | `Remoto (todo el Perú)` |
| Modalidad | elegir «Remoto» |
| Tipo de contrato | `Plazo indeterminado` |
| Fecha de apertura | `2026-11-03` (03/11/2026) |
| Fecha de cierre | `2026-12-03` (03/12/2026) |
| Responsable del proceso | elige cualquier usuario |
| Ciudad | `Lima` |
| Región | `Lima` |
| Tipo de empleo | elegir «Tiempo completo» |
| Sueldo mínimo | `7000` |
| Sueldo máximo | `10000` |
| Moneda | elegir «Soles (PEN)» |
| Periodo | elegir «Por mes» |
| Confidencial | no marcar |

Descripción:

```
Buscamos un Desarrollador Web Full Stack para construir y mantener aplicaciones web internas con TypeScript, React y Node.js sobre una base de datos PostgreSQL. Trabajará en un equipo pequeño con metodologías ágiles, revisión de código y pruebas automatizadas.

El puesto es 100 % remoto dentro del Perú. Se valora la autonomía, la comunicación clara y la lectura de documentación técnica en inglés.
```

Responsabilidades:

```
- Desarrollar interfaces web con React y TypeScript.
- Construir y mantener APIs en Node.js conectadas a PostgreSQL.
- Escribir consultas SQL eficientes y mantener el esquema de la base de datos.
- Escribir pruebas automatizadas y mantener los flujos de integración continua (CI/CD).
- Participar en las revisiones de código y en las reuniones de planificación del equipo.
- Documentar las decisiones técnicas y los cambios en los repositorios.
- Corregir errores de producción y dar soporte técnico a los usuarios internos.
```

### Requisitos

| Tipo | Prioridad | Requisito | Términos de búsqueda | Peso (1–10) | Años mínimos | ¿Esencial? |
|---|---|---|---|---|---|---|
| Experiencia profesional | Obligatorio | Mínimo 3 años de experiencia como desarrollador web | desarrollador, desarrolladora, full stack | 9 | 3 | no |
| Herramienta o programa | Obligatorio | React | React | 8 | (vacío) | no |
| Habilidad técnica | Obligatorio | JavaScript o TypeScript | JavaScript, TypeScript | 6 | (vacío) | no |
| Herramienta o programa | Obligatorio | Node.js | Node.js | 7 | (vacío) | no |
| Habilidad técnica | Obligatorio | Bases de datos SQL | SQL, PostgreSQL, MySQL | 6 | (vacío) | no |
| Herramienta o programa | Obligatorio | Git | Git, GitHub | 4 | (vacío) | no |
| Herramienta o programa | Deseable | Next.js y PostgreSQL | Next.js, PostgreSQL | 4 | (vacío) | no |
| Habilidad técnica | Deseable | Pruebas automatizadas y CI/CD | Jest, Playwright, CI/CD, GitHub Actions | 4 | (vacío) | no |
| Idioma | Deseable | Inglés técnico intermedio o superior | Inglés avanzado, Inglés intermedio | 2 | (vacío) | no |

### Candidatos

| Archivo | Nombre completo | Correo | Teléfono | Ajuste esperado |
|---|---|---|---|---|
| `03_Desarrollador_Web\CV_Ramirez_Sebastian.pdf` | Sebastián Ramírez Cornejo | sebastian.ramirez@example.com | 999 000 009 | Muy fuerte: 6 años full stack, Next.js, PostgreSQL, CI/CD |
| `03_Desarrollador_Web\CV_Ortiz_Valeria.pdf` | Valeria Ortiz Delgado | valeria.ortiz@example.com | 999 000 010 | Bueno: 3 años React/Node con MySQL; sin Next.js ni pruebas automatizadas |
| `03_Desarrollador_Web\CV_Navarro_Hugo.pdf` | Hugo Navarro Peña | hugo.navarro@example.com | 999 000 011 | Medio con carencias: 1 año, PHP/WordPress, JavaScript básico |
| `03_Desarrollador_Web\CV_Fuentes_Milagros.pdf` | Milagros Fuentes Zavala | milagros.fuentes@example.com | 999 000 012 | No cumple: diseñadora gráfica sin programación |

---

## 4. Coordinador de Logística (carpeta `04_Coordinador_Logistica`)

### Datos de la vacante

| Campo (etiqueta exacta) | Valor a pegar |
|---|---|
| Título del puesto | `Coordinador de Logística` |
| Área o departamento | `Operaciones y Logística` |
| Descripción | (bloque siguiente) |
| Responsabilidades | (bloque siguiente) |
| Ubicación | `Zona industrial, Callao` |
| Modalidad | elegir «Presencial» |
| Tipo de contrato | `Plazo indeterminado` |
| Fecha de apertura | `2026-11-03` (03/11/2026) |
| Fecha de cierre | `2026-12-03` (03/12/2026) |
| Responsable del proceso | elige cualquier usuario |
| Ciudad | `Callao` |
| Región | `Callao` |
| Tipo de empleo | elegir «Tiempo completo» |
| Sueldo mínimo | `5000` |
| Sueldo máximo | `6500` |
| Moneda | elegir «Soles (PEN)» |
| Periodo | elegir «Por mes» |
| Confidencial | no marcar |

Descripción:

```
Buscamos un Coordinador de Logística para dirigir la operación de almacén, inventarios y distribución de un centro de distribución en el Callao. Liderará al equipo operativo y controlará los indicadores de servicio, exactitud de inventario y costos de transporte.

Se requiere experiencia comprobable en almacenes, dominio de Excel y capacidad para coordinar con transportistas y proveedores.
```

Responsabilidades:

```
- Coordinar la recepción, el almacenamiento y el despacho de mercadería.
- Planificar y controlar los inventarios mediante conteos cíclicos.
- Dirigir y evaluar al equipo de almacenistas y choferes.
- Programar rutas y coordinar con los transportistas las entregas diarias.
- Negociar tarifas y condiciones con proveedores y empresas de transporte.
- Elaborar reportes semanales de indicadores de servicio y de costos en Excel.
- Velar por el cumplimiento de las normas de seguridad en el almacén.
```

### Requisitos

| Tipo | Prioridad | Requisito | Términos de búsqueda | Peso (1–10) | Años mínimos | ¿Esencial? |
|---|---|---|---|---|---|---|
| Formación académica | Obligatorio | Estudios técnicos o universitarios en Ingeniería Industrial, Logística o afines | Ingeniería Industrial, Administración y Logística, Cadena de Suministro | 7 | (vacío) | no |
| Experiencia profesional | Obligatorio | Mínimo 4 años de experiencia en almacén o distribución | almacén, almacenes, distribución, logística | 9 | 4 | no |
| Habilidad técnica | Obligatorio | Gestión de inventarios | inventarios, inventario, conteos cíclicos | 8 | (vacío) | no |
| Herramienta o programa | Obligatorio | Excel avanzado | Excel avanzado | 6 | (vacío) | no |
| Experiencia profesional | Deseable | Experiencia liderando equipos | Dirigí un equipo, Supervisor de Almacén | 5 | (vacío) | no |
| Herramienta o programa | Deseable | Manejo de WMS o ERP (SAP) | WMS, SAP MM, SAP | 4 | (vacío) | no |
| Habilidad técnica | Deseable | Negociación con transportistas y proveedores | Negociación con proveedores, renegociando | 3 | (vacío) | no |
| Competencia | Deseable | Trabajo bajo presión | bajo presión | 2 | (vacío) | no |
| Idioma | Deseable | Inglés intermedio-alto (nivel B2) | Inglés intermedio (B2), B2 | 2 | (vacío) | no |

### Candidatos

| Archivo | Nombre completo | Correo | Teléfono | Ajuste esperado |
|---|---|---|---|---|
| `04_Coordinador_Logistica\CV_Villanueva_Ricardo.pdf` | Ricardo Villanueva Soto | ricardo.villanueva@example.com | 999 000 013 | Muy fuerte: ingeniero industrial, 8 años, equipo de 14, WMS/SAP |
| `04_Coordinador_Logistica\CV_Castaneda_Elena.pdf` | Elena Castañeda Ríos | elena.castaneda@example.com | 999 000 014 | Bueno: 4 años de analista de almacén; Excel intermedio-avanzado, sin liderazgo formal |
| `04_Coordinador_Logistica\CV_Moreno_Cesar.pdf` | César Moreno Palacios | cesar.moreno@example.com | 999 000 015 | Medio con carencias: auxiliar de almacén, solo secundaria |
| `04_Coordinador_Logistica\CV_Bustamante_Natalia.pdf` | Natalia Bustamante Reyes | natalia.bustamante@example.com | 999 000 016 | No cumple: psicóloga clínica |

---

## 5. Analista de Atención al Cliente (carpeta `05_Analista_Atencion_Cliente`)

### Datos de la vacante

| Campo (etiqueta exacta) | Valor a pegar |
|---|---|
| Título del puesto | `Analista de Atención al Cliente` |
| Área o departamento | `Servicio al Cliente` |
| Descripción | (bloque siguiente) |
| Responsabilidades | (bloque siguiente) |
| Ubicación | `Santiago de Surco, Lima` |
| Modalidad | elegir «Híbrido» |
| Tipo de contrato | `Plazo fijo renovable` |
| Fecha de apertura | `2026-11-03` (03/11/2026) |
| Fecha de cierre | `2026-12-03` (03/12/2026) |
| Responsable del proceso | elige cualquier usuario |
| Ciudad | `Lima` |
| Región | `Lima` |
| Tipo de empleo | elegir «Tiempo completo» |
| Sueldo mínimo | `2200` |
| Sueldo máximo | `2800` |
| Moneda | elegir «Soles (PEN)» |
| Periodo | elegir «Por mes» |
| Confidencial | no marcar |

Descripción:

```
Buscamos un Analista de Atención al Cliente para gestionar los reclamos y consultas de los clientes, monitorear los indicadores de calidad del servicio y apoyar la capacitación de los asesores del contact center.

La persona trabajará con un sistema de tickets, atenderá casos que requieren seguimiento y propondrá mejoras a partir del análisis de los reclamos recurrentes.
```

Responsabilidades:

```
- Registrar, clasificar y resolver los reclamos y consultas de los clientes en el sistema de tickets.
- Dar seguimiento a los casos hasta su cierre dentro de los plazos de atención.
- Atender llamadas y mensajes de chat que requieran escalamiento.
- Monitorear los indicadores de calidad del servicio, como NPS y CSAT.
- Elaborar un reporte mensual de reclamos y propuestas de mejora.
- Apoyar la capacitación y el acompañamiento de los asesores nuevos.
- Coordinar con las áreas internas la solución de los casos complejos.
```

### Requisitos

| Tipo | Prioridad | Requisito | Términos de búsqueda | Peso (1–10) | Años mínimos | ¿Esencial? |
|---|---|---|---|---|---|---|
| Formación académica | Obligatorio | Estudios técnicos o universitarios | Título profesional, Administración, egresado | 5 | (vacío) | no |
| Experiencia profesional | Obligatorio | Mínimo 3 años de experiencia en atención al cliente o contact center | atención al cliente, servicio al cliente, contact center | 9 | 3 | no |
| Habilidad técnica | Obligatorio | Gestión de reclamos | gestión de reclamos, gestión de quejas | 8 | (vacío) | no |
| Herramienta o programa | Obligatorio | Manejo de CRM o sistema de tickets | Zendesk, Freshdesk | 7 | (vacío) | no |
| Habilidad técnica | Deseable | Indicadores de calidad (NPS, CSAT) | NPS, CSAT | 4 | (vacío) | no |
| Experiencia profesional | Deseable | Experiencia capacitando equipos | Capacité, Capacitación de personal | 4 | (vacío) | no |
| Idioma | Deseable | Inglés intermedio | Inglés intermedio | 2 | (vacío) | no |
| Competencia | Deseable | Comunicación asertiva | Comunicación asertiva | 3 | (vacío) | no |
| Habilidad técnica | Deseable | Atención de llamadas y consultas por teléfono o chat | llamadas, atención telefónica, chat | 3 | (vacío) | no |

### Candidatos

| Archivo | Nombre completo | Correo | Teléfono | Ajuste esperado |
|---|---|---|---|---|
| `05_Analista_Atencion_Cliente\CV_Ccopa_Daniela.pdf` | Daniela Ccopa Marín | daniela.ccopa@example.com | 999 000 017 | Muy fuerte: 5 años, reclamos, NPS/CSAT, capacitación |
| `05_Analista_Atencion_Cliente\CV_Huertas_Marco.pdf` | Marco Antonio Huertas Lazo | marco.huertas@example.com | 999 000 018 | Bueno: casi 4 años con CRM; sin reclamos, indicadores ni capacitación |
| `05_Analista_Atencion_Cliente\CV_Torres_Yesenia.pdf` | Yesenia Torres Aguirre | yesenia.torres@example.com | 999 000 019 | Medio con carencias: recepcionista de 1 año, sin reclamos ni CRM |
| `05_Analista_Atencion_Cliente\CV_Lozano_Oscar.pdf` | Óscar Lozano Medina | oscar.lozano@example.com | 999 000 020 | No cumple: chofer, sin experiencia en atención |

---

## Qué comprobar

**Esto es una EXPECTATIVA, no un resultado observado en la app.** Sale de leer los CVs y de ejecutar el propio motor de reglas (`reglas-v2`) y la fórmula de puntaje del repositorio sobre el texto extraído de los 20 PDFs, con fecha de referencia 2026-11-03. Todavía no se ha probado en la aplicación. Las cifras exactas pueden variar si se evalúa otro día (solo afecta a los cálculos de años por fechas) o si se escribió algún término distinto.

Puntaje esperado = peso «Acreditado» / peso total. Los requisitos «Competencia» y los marcados «esenciales» nunca suman por reglas (quedan «Pendiente de verificación»).

| Puesto | Orden esperado de mayor a menor (puntaje y nivel) |
|---|---|
| 1. Asistente Contable | Quispe (90 %, alta) > Mendoza (78 %, alta) > Salazar (6 %, pendiente) > Paredes (0 %, pendiente) |
| 2. Ejecutivo Comercial B2B | Vargas (100 %, alta) > Chávez (63 %, parcial) > Espinoza (4 %, pendiente) > Gutiérrez (0 %, pendiente) |
| 3. Desarrollador Web | Ramírez (100 %, alta) > Ortiz (84 %, alta) > Navarro (24 %, pendiente) > Fuentes (0 %, pendiente) |
| 4. Coordinador de Logística | Villanueva (96 %, alta) > Castañeda (52 %, parcial) > Moreno (17 %, pendiente) > Bustamante (0 %, pendiente) |
| 5. Analista de Atención al Cliente | Ccopa (93 %, alta) > Huertas (53 %, parcial) > Torres (7 %, pendiente) > Lozano (0 %, pendiente) |

Qué debería quedar sin cumplir en quien no encaja (recordar que el motor lo muestra como «Sin evidencia suficiente», no como «no cumplido», y por eso el nivel nunca sale «Compatibilidad baja» en estos datos; sale «Evaluación pendiente»):

- **Asistente Contable.** Paredes y Salazar: sin evidencia en los cuatro obligatorios (título o bachiller en Contabilidad, 3 años en contabilidad general, tributación peruana, Excel intermedio-avanzado). Mendoza: sin colegiatura, PLE/PLAME ni inglés intermedio. Carmen Quispe debe salir con la colegiatura «Pendiente de verificación» (requisito esencial).
- **Ejecutivo Comercial B2B.** Gutiérrez: sin evidencia en los cinco obligatorios. Espinoza: sin evidencia en B2B, metas comerciales, CRM y formación, y «Pendiente de verificación» en los 4 años de ventas (solo suma menos de 4). Chávez: sin evidencia en B2B (obligatorio).
- **Desarrollador Web.** Fuentes: sin evidencia en los seis obligatorios. Navarro: sin evidencia en React, Node.js y Git; los 3 años quedan «Pendiente de verificación» (tiene 1). Ortiz: cumple todos los obligatorios; le faltan Next.js/PostgreSQL y las pruebas automatizadas (deseables).
- **Coordinador de Logística.** Bustamante: sin evidencia en los cuatro obligatorios. Moreno: sin evidencia en formación y Excel avanzado; sus 4 años en almacén quedan «Pendiente de verificación» (tiene menos de 4). Castañeda: sin evidencia en Excel avanzado (su CV dice «intermedio-avanzado»).
- **Analista de Atención al Cliente.** Lozano: sin evidencia en los cuatro obligatorios. Torres: sin evidencia en los cuatro obligatorios (solo suma «atención de llamadas»). Huertas: sin evidencia en gestión de reclamos (obligatorio).

Qué más mirar:

- Que «Aprobar criterios» desbloquee «Evaluar pendientes» y que, al editar un requisito, vuelva a pedir aprobación.
- Que en la ficha de cada postulación las evidencias citen frases reales del CV.
- Que al comparar los mejores de cada puesto, el orden coincida con la tabla de arriba.
- Limitación conocida del motor: no distingue niveles («Excel básico» frente a «avanzado») salvo que el término lo incluya, ni interpreta sinónimos. Por eso, por ejemplo, Valeria Ortiz (TypeScript básico) acredita «JavaScript o TypeScript».

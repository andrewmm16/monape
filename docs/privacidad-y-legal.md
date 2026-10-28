# Privacidad, protección de datos y cuestiones legales

> Este documento es una **base técnica de trabajo**, no una opinión legal. La aplicación se diseñó considerando la Ley N.º 29733, Ley de Protección de Datos Personales, y su Reglamento aprobado por el D. S. N.º 016-2024-JUS, pero **no se afirma que cumpla** la normativa. Las decisiones marcadas como «A DEFINIR» corresponden a la empresa con asesoría especializada.

## 1. Inventario de datos (privacidad desde el diseño)

| Dato | Dónde | Finalidad | Quién accede | Necesidad |
|---|---|---|---|---|
| Nombre, correo, teléfono, ubicación, LinkedIn | `candidates` | Identificar y contactar al postulante | RRHH y administración | Necesario para el proceso |
| Fuente de la candidatura | `candidates.source` | Trazabilidad del proceso | Ídem | Útil para informes |
| CV (archivo) | Storage `resumes` (privado) | Evaluar la idoneidad para el puesto | Ídem; descarga auditada | Necesario |
| Texto extraído y corregido del CV | `resume_extractions` | Evaluación y revisión | Ídem | Necesario |
| Experiencia, formación, habilidades, certificaciones | `candidate_profile_items` | Evaluación | Ídem | Necesario |
| Postulaciones, estados, observaciones | `applications`, `application_events` | Gestión del proceso | Ídem | Necesario |
| Evaluaciones de compatibilidad | `candidate_evaluations`, `…_items` | Apoyo a la decisión | Ídem | Necesario |
| Usuarios internos (nombre, correo, rol) | `profiles`, Supabase Auth | Control de acceso | Usuarios internos activos | Necesario |
| Usuarios internos eliminados (nombre y rol; sin correo ni credenciales) | `profiles` con `deleted_at` | Trazabilidad del historial: quién hizo cada cambio | Usuarios internos activos | Necesario; plazo de conservación por definir |
| Auditoría (quién, qué, cuándo; sin valores personales) | `audit_logs` | Seguridad y trazabilidad | Solo administración | Necesario |

**Minimización aplicada:** no se solicitan DNI, fecha de nacimiento, foto, estado civil, nacionalidad, salud, religión ni otros datos sensibles; los formularios advierten no registrarlos; la auditoría no guarda valores; los datos de contacto se eliminan antes de cualquier envío a un proveedor de IA.

**Riesgo residual:** los CV pueden contener datos sensibles que el candidato incluyó por iniciativa propia (foto, edad, estado civil, salud). La plataforma no los usa para evaluar, pero sí los almacena. A DEFINIR: instrucción a postulantes de no incluirlos y procedimiento si aparecen.

## 2. Base jurídica e información al titular

- A DEFINIR por la empresa: la base que legitima cada tratamiento (consentimiento, relación precontractual u otra prevista en la ley). No se asume que el consentimiento sea siempre necesario ni que siempre sea innecesario.
- Si se requiere consentimiento (por ejemplo, para conservar el CV en una **cartera de talento** para futuras vacantes o para el uso de IA), debe ser libre, previo, expreso, informado e inequívoco, separado por finalidad y verificable. Las tablas `privacy_notices` y `consent_records` (versión del aviso, fecha, medio, finalidad) se adelantaron a la Etapa 2, porque la postulación en línea las requiere (paquete 2.1).
- Hoy los candidatos se registran manualmente por RRHH: la empresa debe asegurar que el canal por el que recibe el CV (correo, bolsa de empleo, web) informa el aviso de privacidad.

### Borrador de aviso de privacidad para candidatos

> **[RAZÓN SOCIAL]**, con RUC **[RUC]** y domicilio en **[DOMICILIO]**, tratará los datos personales que usted nos proporcione en su postulación (datos de contacto, currículum y la información que este contenga) con la finalidad de gestionar el proceso de reclutamiento y selección para el puesto al que postula: evaluar su perfil frente a los requisitos del puesto, comunicarnos con usted y registrar el resultado del proceso.
>
> Para apoyar la revisión de su currículum utilizamos herramientas automatizadas que comparan su contenido con los requisitos del puesto **[y, de aprobarse: un servicio de inteligencia artificial de [PROVEEDOR], ubicado en [PAÍS]]**. Estas herramientas no toman decisiones: el personal de Recursos Humanos revisa cada candidatura y decide.
>
> Sus datos serán accesibles por el personal de Recursos Humanos y las personas que participen en la evaluación del puesto, y se almacenan en servicios de **[Supabase (región [REGIÓN])]** y **[Vercel]**, que actúan como encargados del tratamiento. Los conservaremos durante **[PLAZO]** después de concluido el proceso **[o, si usted lo autoriza, durante [PLAZO] para considerarlo en futuras vacantes]**, y luego serán eliminados o anonimizados.
>
> Usted puede ejercer sus derechos de acceso, rectificación, cancelación y oposición escribiendo a **[CORREO DE CONTACTO]**, adjuntando una copia de su documento de identidad. Si considera que sus derechos no han sido atendidos, puede presentar un reclamo ante la Autoridad Nacional de Protección de Datos Personales. Banco de datos: **[NOMBRE Y CÓDIGO DE INSCRIPCIÓN EN EL RNPDP]**.

## 3. Derechos de los titulares (ARCO)

Implementado hoy:

- **Localización de datos:** la ficha del candidato reúne datos, CV, extracciones, perfil, postulaciones, evaluaciones e historial.
- **Rectificación:** edición de datos, corrección del texto del CV y verificación de datos.
- **Eliminación técnica:** las relaciones están definidas con borrado en cascada desde `candidates` (postulaciones, CV, extracciones, evaluaciones, historial); solo administración puede borrar.

Pendiente (Etapa 4):

- Registro de solicitudes (`privacy_requests`: fecha, titular, tipo, responsable, estado, resolución, plazos).
- Exportación de los datos de un titular (acceso) y procedimiento de cancelación que borre también los archivos del bucket y respete los plazos de conservación obligatorios (bloqueo en lugar de borrado cuando corresponda).
- A DEFINIR: plazos de respuesta vigentes y canal de recepción.

## 4. Conservación

A DEFINIR por la empresa (propuesta para discusión):

| Situación | Propuesta |
|---|---|
| Candidato no seleccionado, sin autorización para cartera | Eliminar o anonimizar [N] meses después del cierre de la vacante |
| Candidato con autorización para cartera de talento | Conservar [N] meses; renovar autorización |
| Candidato seleccionado | Trasladar a gestión de personal según sus propias reglas |
| Auditoría | Conservar [N] meses/años por seguridad |

La eliminación automática **no está implementada** a propósito: primero deben definirse los plazos y las obligaciones de conservación.

## 5. Banco de datos personales

- La empresa debe verificar la inscripción en el **Registro Nacional de Protección de Datos Personales** del banco de datos de postulantes/candidatos (o su inclusión en uno ya inscrito), con su finalidad, ubicación, encargados y transferencias.
- **No existe evidencia en este proyecto de que la inscripción se haya realizado.**
- Información de apoyo para la inscripción: inventario de la sección 1, proveedores de la sección 6, medidas de seguridad de [seguridad.md](seguridad.md).

## 6. Proveedores y transferencias

| Proveedor | Función | Datos | Ubicación | Estado |
|---|---|---|---|---|
| Supabase | Base de datos, autenticación, almacenamiento | Todos | Región elegida al crear el proyecto (A DEFINIR) | Revisar DPA, subencargados, región, respaldos |
| Vercel | Hospedaje de la aplicación, logs | Tránsito de datos; logs técnicos | Región de funciones (A DEFINIR) | Revisar DPA y retención de logs |
| Anthropic (opcional) | Evaluación con IA | Texto del CV sin datos de contacto; requisitos | EE. UU. u otra según contrato | **Deshabilitado.** Requiere aprobación, revisión de retención y uso para entrenamiento, y análisis de transferencia internacional |
| Resend (Etapa 3) | Correo transaccional | Nombre y correo del candidato; contenido del mensaje | Según proveedor | No integrado |

Elegir un proveedor conocido **no garantiza** el cumplimiento: revise contratos (encargo de tratamiento), subencargados, medidas de seguridad, notificación de incidentes y el régimen de **transferencia internacional** previsto en la normativa peruana.

## 7. IA responsable

- La IA no decide; propone valoraciones que RRHH revisa. No hay rechazos automáticos.
- No se usan ni infieren características protegidas (edad, sexo, raza, religión, discapacidad, etc.); el prompt lo prohíbe y los formularios no las solicitan.
- No se entrenan modelos con CV. A DEFINIR: verificar contractualmente que el proveedor tampoco lo haga.
- Criterios, pesos, metodología y limitaciones documentados en [metodologia-evaluacion.md](metodologia-evaluacion.md); cada evaluación guarda método, versión del prompt o motor, modelo y versión de criterios.
- Recomendación: revisión periódica de resultados por grupos de vacantes y de las correcciones de RRHH para detectar sesgos.

## 8. Cuestiones para revisar con asesoría especializada

1. Base jurídica aplicable a cada tratamiento del proceso de selección y, en su caso, diseño del consentimiento (cartera de talento, IA).
2. Texto definitivo del aviso de privacidad y canales donde se mostrará.
3. Inscripción o actualización del banco de datos personales en el RNPDP.
4. Plazos de conservación y obligaciones legales de conservación.
5. Procedimiento y plazos vigentes para atender derechos ARCO.
6. Transferencias internacionales (Supabase, Vercel, proveedor de IA, Resend) y contratos de encargo.
7. Obligaciones del Reglamento D. S. 016-2024-JUS aplicables a la empresa: medidas de seguridad documentadas, gestión y comunicación de incidentes de seguridad (plazos y destinatarios), eventual designación de un oficial de datos personales y necesidad de una evaluación de impacto para el tratamiento con herramientas automatizadas.
8. Uso de decisiones o perfilamiento automatizados y derecho del titular a obtener intervención humana y explicación. **Desde el 23/10/2026 la plataforma preselecciona un estado del proceso a partir de la compatibilidad** (incluido «No seleccionado» cuando una evaluación con IA indica requisitos obligatorios aparentemente no cumplidos). Una persona debe confirmarlo, pero legal debe valorar si basta para considerar que hay intervención humana real, y si el aviso de privacidad («estas herramientas no toman decisiones») debe precisarlo.
9. Tratamiento de datos sensibles incluidos espontáneamente en los CV.
10. Confidencialidad del personal que accede a los datos (acuerdos y capacitación).
11. Política de gestión de incidentes y su prueba.

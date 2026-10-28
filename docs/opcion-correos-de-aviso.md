# Opción A · Recibir los CV leyendo los correos de aviso de los portales

**Versión 1 · 27/10/2026 · Estado: en pausa.** El usuario estima que los correos de estos portales no traen el CV. Se retomará solo si una prueba con cuentas reales muestra lo contrario. Portales cubiertos: LinkedIn, Bumeran y Trabajos Diarios. Se añade Computrabajo porque su revisión estaba pendiente. La revisión de condiciones de uso es una lectura técnica de los textos publicados por cada portal: **no es una opinión legal** y debe validarla el área legal.

## Resumen

El postulante postula **dentro del portal**, como siempre. El portal envía un correo de aviso al buzón de empleo de la empresa, y la plataforma lee ese buzón y registra al postulante con su CV, como si RRHH lo hubiera subido en la carga masiva. La plataforma **no entra al portal**: solo lee el correo de la propia empresa.

- **A favor:** ninguna de las condiciones revisadas prohíbe expresamente que la empresa procese en sus sistemas los correos que recibe.
- **El dato decisivo sigue sin verificar:** si esos correos traen el CV adjunto, o al menos los datos del postulante. Ningún portal lo dice en sus fuentes públicas. Se averigua con una prueba real (ver [Pasos siguientes](#pasos-siguientes)).
- **Computrabajo** tiene una restricción explícita sobre guardar datos de candidatos fuera de sus herramientas, que afecta también a la carga masiva actual (ver [Advertencia sobre Computrabajo](#advertencia-sobre-computrabajo)).

## Cómo funcionaría

```
Postulante postula en LinkedIn / Bumeran / Trabajos Diarios
        │
        ▼
El portal envía «Nueva postulación…» a empleos@<dominio de la empresa>
        │
        ▼
La plataforma revisa el buzón cada pocos minutos (solo lectura)
        │
        ├─ ¿El correo viene realmente del portal? (remitente y firmas del correo)
        ├─ ¿A qué vacante corresponde? (título o código en el asunto)
        ├─ Extrae nombre, correo, teléfono y el CV adjunto
        ▼
Registra al candidato con su portal de origen, lo evalúa por reglas
y lo deja en la bandeja «Postulaciones nuevas», con aviso si es posible duplicado
        │
        ▼
Marca el correo como procesado (nunca lo borra)
```

**Lo que se construiría**

1. **Conexión al buzón** con permiso de solo lectura. Depende de dónde esté alojado el correo de la empresa:
   - Google Workspace: API de Gmail;
   - Microsoft 365: Microsoft Graph;
   - otro proveedor: IMAP.

   Se configura una vez desde una pantalla de Administración.
2. **Un lector por portal.** Cada portal tiene su propio formato de correo, así que se escribe y se prueba uno por portal, con correos de ejemplo ficticios.
3. **Verificación del remitente.** Cualquiera puede enviar un correo falso al buzón. Solo se aceptan correos del dominio del portal que pasen las comprobaciones de autenticidad (SPF, DKIM y DMARC). Los demás se ignoran y quedan registrados.
4. **Registro.** Se reutiliza lo que ya hace la carga masiva:
   - mismas validaciones del archivo;
   - mismo aviso de duplicados;
   - misma evaluación por reglas;
   - forma de ingreso «Correo».
5. **Revisión opcional.** En una primera etapa conviene que cada correo leído entre en un lote pendiente de confirmación por RRHH, en lugar de registrarse directo. Cuando el lector sea fiable, pasa a ser automático.
6. **Registro de lo procesado:** qué correo se leyó, cuándo y con qué resultado, sin copiar su contenido.

## Revisión de condiciones de uso (consultadas el 27/10/2026)

| Portal | ¿Prohíbe esta opción? | Qué dicen sus condiciones | Fuente |
|---|---|---|---|
| **LinkedIn** | **No lo prohíbe expresamente** | Las condiciones para empleos permiten pasar los datos de postulantes a proveedores de la empresa, como un sistema de seguimiento de candidatos (ATS): *"Provide identifiable candidate resume or application data to any other parties"* está prohibido *"except for Customer's service providers (such as an applicant tracking system)"*. Solo se puede contactar al postulante por esa vacante: *"contact applicants for purposes other than related to the specific employment opportunity described in the posting"*. | [LinkedIn Service Terms, sec. 1.5](https://www.linkedin.com/legal/l/service-terms) (vigentes desde el 06/08/2026). Verificado |
| **Bumeran Perú** | **No lo prohíbe expresamente** | Sus Términos y Condiciones de Uso (8/7/2024) y sus Condiciones Generales de Contratación (10/4/2025) **no regulan** los correos de aviso ni cómo guarda la empresa los datos de los postulantes. Sus prohibiciones apuntan al uso de software para navegar el sitio y a compartir la contraseña, que esta opción no hace. | Textos de Perú extraídos de bumeran.com.pe/terminos-y-condiciones y /condiciones-de-contratacion (entidad: Bumeran.com Perú S.A.C., RUC 20519147247) |
| **Trabajos Diarios** | **No lo prohíbe expresamente** | Limita el uso de los datos a la selección: *"utilizar los datos de los candidatos únicamente para fines de reclutamiento y selección de personal"*, *"nunca para fines comerciales o de otra índole"*. | [pe.trabajosdiarios.com/terminos-condiciones](https://pe.trabajosdiarios.com/terminos-condiciones). El texto no tiene fecha ni indica la entidad legal |
| **Computrabajo Perú** | **Conflicto probable** (ver la advertencia) | Exige gestionar la selección con sus herramientas o las de su grupo, y prohíbe formar una base privada de CV. | [pe.computrabajo.com/avisolegal](https://pe.computrabajo.com/avisolegal/) (actualizado el 14/10/2026) |

**Qué traen los correos: sin información en ninguno de los cuatro.**
- **LinkedIn:** su ayuda de publicación gratuita dice *"Send email updates through LinkedIn or an external website"*, pero no aclara qué contiene el correo ([fuente](https://www.linkedin.com/help/linkedin/answer/a522384)). Según esa misma ayuda, la publicación gratuita dura 14 días y se pausa al alcanzar un límite de solicitudes, normalmente entre 10 y 30.
- **Bumeran, Trabajos Diarios y Computrabajo:** no se encontró nada en sus fuentes públicas.

### Advertencia sobre Computrabajo

Las Condiciones Legales de Computrabajo Perú (actualizadas el 14/10/2026) dicen:

> «Utilizar los servicios del Sitio Web para la publicación de ofertas de trabajo y búsqueda de Demandantes de Trabajo y gestión de sus procesos de selección mediante el uso de las herramientas ofrecidas por el portal web y dentro del mismo, o bien, mediante la herramienta de software de reclutamiento ofrecida por DGNET. Cualquier otro uso está terminantemente prohibido.»

> «En ningún caso, se otorga permiso al Usuario Profesional para almacenar los datos de los Candidatos para otros anuncios de trabajo ni para constituir una base de datos privada de CVs ni para cualquier otro uso distinto a la finalidad del Portal Web, salvo que ello sea permitido por DGNET, ya sea mediante el uso de la herramienta de software de reclutamiento ofrecida por el mismo y otras autorizadas o mediante autorización expresa por escrito.»

También limita el acceso a los datos de los inscritos. Para ofertas básicas es de 60 días naturales; en otros planes, 60 días desde la inscripción o 30 días tras el vencimiento.

**Consecuencia:** pasar a la plataforma los CV recibidos por Computrabajo, sea por correo o con la **carga masiva actual**, entra en conflicto probable con estas cláusulas. El riesgo es mayor si los CV se conservan para otras vacantes. Las vías legítimas son tres:
1. pedir a Computrabajo autorización expresa por escrito;
2. usar su herramienta autorizada (Pandapé, de su mismo grupo, que es de pago);
3. como mínimo, usar esos CV solo para la vacante a la que postularon y borrarlos al cerrarla. Esta última debe validarla legal.

## Ventajas y desventajas

| A favor | En contra |
|---|---|
| El postulante no hace ningún paso extra | Si el correo no trae el CV, la opción no sirve para ese portal |
| La plataforma no entra al portal ni guarda contraseñas de los portales | Cada portal tiene su formato; si lo cambian, hay que ajustar el lector |
| Gratis: usa el buzón que la empresa ya tiene | Algunos portales envían resúmenes diarios en vez de un correo por postulante; hay que configurarlo |
| Mucho menos frágil que un robot | El buzón pasa a contener datos personales: hay que limitar quién lo lee y cuánto se conservan los correos |

## Qué hace falta

| Requisito | Quién |
|---|---|
| Saber dónde está alojado el correo de la empresa (Google Workspace, Microsoft 365 u otro) | Empresa |
| Crear el buzón de empleo (por ejemplo `empleos@…`) | Empresa |
| Cuentas de empresa en LinkedIn, Bumeran y Trabajos Diarios | Empresa |
| Aviso de privacidad aprobado por legal, que mencione que los datos llegan desde los portales | Legal |
| Validación legal de esta revisión de condiciones, en especial la de Computrabajo | Legal |

## Pasos siguientes

1. **Prueba real, sin construir nada todavía.** Con las cuentas de empresa:
   - publicar una vacante de prueba en cada portal;
   - pedir a una persona del equipo, con su consentimiento, que postule con un CV ficticio;
   - revisar qué llega al buzón: si trae el CV adjunto, qué datos trae, qué asunto tiene y si se puede pedir un correo por postulante.

   Con eso se decide portal por portal.
2. Construir el lector **solo para los portales cuyo correo traiga el CV**, empezando por el que más postulaciones reciba.
3. Para Computrabajo, decidir antes entre pedir autorización escrita, contratar Pandapé o limitar el uso de esos CV a su vacante.

**Nivel de verificación:**
- Las cláusulas citadas se leyeron directamente de los sitios de cada portal el 27/10/2026.
- Qué contienen los correos no está verificado en ningún portal.
- Nada de esta opción está implementado.

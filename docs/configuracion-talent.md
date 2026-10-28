# Recepción de postulaciones de Talent.com (Talent Apply)

**Estado al 27/10/2026:** implementada y probada en local, con envíos simulados según la documentación pública de Talent.com. **No se ha probado con Talent.com real.** Está apagada por defecto.

## Qué hace

Talent.com es un buscador de empleo que lee el feed de vacantes de la empresa. Con «Talent Apply», el postulante postula **dentro de Talent.com** y Talent.com envía sus datos y su CV a la plataforma. La postulación aparece sola en la bandeja «Postulaciones nuevas», con el portal «Talent.com» y la forma de ingreso «Integración», evaluada por reglas si la vacante tiene los criterios aprobados.

```
Talent.com lee el feed privado de la empresa
  └─ cada vacante trae su dirección de envío (con una clave propia)
Postulante postula en Talent.com
  └─ Talent.com envía nombre, correo, teléfono y CV a esa dirección
La plataforma comprueba la clave y la vacante, valida el CV,
crea un candidato nuevo con su postulación y lo evalúa por reglas
  └─ Si se parece a alguien ya registrado: «Posible duplicado»
```

## Cómo se activa

1. **Confirmar con Talent.com** lo que su documentación no dice. Ver el [mensaje propuesto](#mensaje-propuesto-para-talentcom):
   - el costo y si cubre Perú;
   - cómo codifica el CV;
   - qué respuesta espera y si reintenta.
2. **Requisitos previos:**
   - la plataforma en internet con su dominio;
   - la parte pública de vacantes encendida (`PUBLIC_JOBS_ENABLED`, `PUBLIC_SITE_URL`, `PUBLIC_COMPANY_NAME`);
   - el aviso de privacidad aprobado por legal, que debe mencionar que los datos llegan desde Talent.com.
3. **Configurar el servidor:**

   | Variable | Valor |
   |---|---|
   | `TALENT_APPLY_ENABLED` | `true` |
   | `TALENT_APPLY_SECRET` | Texto aleatorio de 32 caracteres o más. Con él se calcula la clave de envío de cada vacante |
   | `TALENT_FEED_TOKEN` | Otro texto aleatorio de 32 caracteres o más. Es la clave del feed privado |

   Para generar cada valor: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.
4. **Dar a Talent.com la dirección del feed privado:**
   `<PUBLIC_SITE_URL>/api/integraciones/talent/feed/<TALENT_FEED_TOKEN>`

   Esta dirección es **secreta**: contiene las direcciones de envío de todas las vacantes. No se publica ni se pone en el feed público `/empleos/feed.xml`.

## Qué se guarda y qué no

| Se guarda | No se guarda |
|---|---|
| Nombre, correo, teléfono y CV, en un candidato **nuevo** (nunca se modifica una ficha existente) | La dirección IP, el navegador y el dispositivo que envía Talent.com |
| Un registro de cada envío: identificador de Talent.com, vacante, resultado y motivo del rechazo (sin datos personales) | El mensaje completo recibido |
| Los motivos de posible duplicado: mismo correo, mismo teléfono o mismo CV | Las respuestas a preguntas adicionales (no se usan) |

## Respuestas de la plataforma a Talent.com

| Código | Cuándo |
|---|---|
| 200 | Postulación registrada, o repetición de una ya registrada (no se duplica) |
| 400 | El contenido no es un JSON válido |
| 404 | Función apagada, clave incorrecta o vacante inexistente, confidencial o en borrador |
| 410 | La vacante está cerrada |
| 413 | El envío supera 6 MB |
| 415 | El envío no es JSON |
| 422 | Faltan datos obligatorios o el CV no es un PDF o Word válido de hasta 4 MB |
| 429 | Se superó el límite: 200 envíos por hora por vacante o 1000 por día en total |
| 500 | Error inesperado |

## Seguridad

- **Una clave distinta por vacante.** Talent.com no documenta firma ni autenticación, así que la dirección de envío lleva una clave calculada a partir de `TALENT_APPLY_SECRET`. Sin la clave correcta, la respuesta es 404.
- **Cambiar `TALENT_APPLY_SECRET`** cambia las direcciones de todas las vacantes. Talent.com debe volver a leer el feed, y los envíos a las direcciones antiguas reciben 404.
- **Cambiar `TALENT_FEED_TOKEN`** obliga a dar a Talent.com la dirección nueva del feed.
- Las dos rutas no usan sesión ni cookies, y no aparecen en buscadores.
- Las claves van en la dirección. Por eso pueden quedar en los registros de acceso del alojamiento (Vercel), que deben tratarse como confidenciales.

## Limitaciones conocidas

- **Formato sin confirmar.** La documentación pública de Talent.com no dice cómo codifica el CV, qué respuesta espera ni si reintenta. La plataforma acepta CV en base64, con o sin prefijo `data:`.
- **Tamaño del CV.** El máximo es de 4 MB. En Vercel, el límite de 4,5 MB por solicitud y la codificación base64 (que aumenta el tamaño en un tercio) dejan el máximo real en unos 3,3 MB. Es un cálculo, no una prueba.
- **CV o datos inválidos.** Si el CV no es un PDF o Word válido, o faltan datos obligatorios, la postulación no se registra. Queda anotada como rechazada, sin datos personales, siempre que traiga su identificador. Que Talent.com la reintente o avise al postulante depende de Talent.com.
- **Respuesta perdida.** Si la postulación se registra pero la respuesta no llega a enviarse, un reintento de Talent.com recibe 200 y no la duplica. En ese caso puede quedar sin evaluar, y RRHH la evalúa con el botón de la postulación.
- **Archivo huérfano.** Si el servidor se cae justo entre guardar el CV y registrar la postulación, el archivo queda sin borrar.
- **«Sistema (integración)»** aparece como autor de lo que hizo la integración y también de lo que hizo un usuario ya eliminado: hoy no se distinguen.

## Pruebas realizadas

Ver [informe-pruebas.md](informe-pruebas.md), sección del paquete 2.10.

## Mensaje propuesto para Talent.com

> Hello, we are a company in Peru that publishes its job openings through an XML feed and would like to enable **Talent Apply**. Before integrating, could you confirm:
> 1. Is Talent Apply available for jobs located in Peru, and does it have any cost for the employer?
> 2. How is `applicant.resume.file.data` encoded (base64?), and what is the maximum resume size?
> 3. Which HTTP response do you expect from our endpoint, and do you retry on errors (which codes, how many times)?
> 4. Do you sign requests or send any header we can use to verify that a request comes from Talent.com?
> 5. Can we test with a staging feed before going live?
>
> Thank you.

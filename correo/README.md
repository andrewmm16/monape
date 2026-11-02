# Lector de correo de postulaciones

Proceso aparte (como `bot/`) que lee los correos de aviso de los portales de empleo en el buzón de la empresa, extrae al postulante y su CV adjunto y los entrega a la app por la API del robot (`BotApi`, reutilizada de `bot/src/api.ts`). Diseño: `docs/opcion-correos-de-aviso.md`.

## Ejecutarlo

```
cp correo/env.example .env.correo      # completar valores (ignorado por git)
npm run correo                         # bucle cada MAIL_POLL_SECONDS
npm run correo -- --once               # una sola pasada
npm run correo -- --folder muestras-correo   # procesa .eml locales, sin IMAP
```

Pruebas: `npx vitest run --project unit tests/unit/correo`.

## Qué hace

1. Lee el buzón IMAP en **solo lectura** (nunca borra, mueve ni marca correos) o, con `--folder`, los `.eml` de una carpeta.
2. Verifica el remitente: el dominio debe estar en `senderDomains` de una plantilla (o ser un subdominio) y, con `MAIL_REQUIRE_AUTH=true` (por defecto), el **primer** `Authentication-Results` debe traer `dmarc=pass` y además `dkim=pass` o `spf=pass`. Sin ese encabezado, se rechaza. Solo se mira el primero porque es el que añade nuestro servidor; los demás pueden venir del remitente.
3. Una plantilla por portal extrae oferta, nombre, correo y teléfono. La oferta se busca entre `api.active(portal)` por `externalId`.
4. Elige el primer adjunto PDF/DOCX de hasta 4 MB (las imágenes no cuentan) y llama a `sendApplicant`. El `externalId` es `correo-<sha256 del Message-ID>` (sin datos personales). La app deduplica por publicación + `externalId`.
5. Guarda en `MAIL_STATE_FILE` el hash del Message-ID y el resultado (no direcciones). Solo se reintentan los `error`; `oferta_desconocida`, `sin_cv`, etc. son definitivos. Para repetir un correo, borre su entrada del archivo.

Resultados (los únicos que se registran, con un hash corto del Message-ID; nunca nombre, correo, teléfono, asunto ni texto): `registrada`, `ya_registrada`, `sin_cv`, `remitente_no_autorizado`, `sin_plantilla`, `oferta_desconocida`, `cv_invalido`, `error`.

`sin_cv`: no se envía nada; el código queda en el registro y el estado para que RRHH o el robot lo atiendan.

## Plantillas

`src/templates/index.ts` tiene el registro de producción **vacío**: ningún formato de portal real está verificado y no se inventa. Cada plantilla se escribe con un correo real reenviado como `.eml` a `muestras-correo/`. `ejemplo-ficticio` (formato inventado, solo para pruebas) se activa con `MAIL_ENABLE_EXAMPLE=1`.

## Qué NO está verificado

- **Los correos reales de los portales**: no se sabe si traen el CV adjunto ni qué formato tienen.
- **El servidor IMAP real**: `ImapSource` se escribió según los tipos de `imapflow` 2.10.0, pero no se probó contra ningún servidor.
- **Microsoft 365**: suele exigir OAuth2 en lugar de contraseña para IMAP. **OAuth no está implementado**; queda pendiente verificarlo con la documentación oficial de Microsoft. Hoy solo funciona con contraseña de aplicación.
- La API real de la app y Supabase: las pruebas usan fakes.
- Ventana de lectura: solo se miran los correos de los últimos 30 días; no hay tope de tamaño por correo.

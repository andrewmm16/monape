# Despliegue

## Entornos

| Entorno | Supabase | Vercel | Datos |
|---|---|---|---|
| Desarrollo | Local (CLI + Docker) o proyecto `dev` | `npm run dev` | Ficticios (`npm run db:seed`) |
| Pruebas | Proyecto `staging` | *Preview* | Ficticios |
| Producción | Proyecto `prod` | *Production* | Reales |

Cada entorno tiene sus **propias claves**. Nunca reutilice la clave secreta de producción en otros entornos.

## Vercel

1. Importe el repositorio en Vercel (framework detectado: Next.js). Node 24: lo fija `engines` (`24.x`) en `package.json`, que manda sobre la versión de *Project Settings*; la predeterminada de Vercel es 26 y no está probada. Esta PC usa 24.22.1 y el ensayo en Linux (19/11/2026) pasó con Node 24. **Plan:** el plan Hobby (gratuito) es solo para uso personal no comercial ([fair use guidelines](https://vercel.com/docs/limits/fair-use-guidelines), consultado el 28/10/2026). Una plataforma de la empresa necesita el plan Pro.
2. En **Settings → Environment Variables**, defina por entorno (*Production*, *Preview*, *Development*):
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - `SUPABASE_SECRET_KEY` (marcar como *Sensitive*)
   - `APP_URL` (URL pública del entorno), `APP_ENV` (`staging` / `production`)
   - Variables de IA solo si corresponde (ver [configuracion-ia.md](configuracion-ia.md)). Con `AI_PROVIDER=claude-cli`, `AI_WORKER_SECRET` (*Sensitive*) y el worker desplegado en una máquina siempre encendida ([ia-worker/README.md](../ia-worker/README.md)).
   - Parte pública y formulario: `PUBLIC_JOBS_ENABLED`, `PUBLIC_SITE_URL`, `PUBLIC_COMPANY_NAME`, `PUBLIC_APPLY_ENABLED` e `INTAKE_HASH_SECRET` (*Sensitive*, 32 caracteres o más). El formulario solo se enciende con el aviso de privacidad activado en «Configuración → Privacidad».
   - Talent.com, solo si se activa: ver [configuracion-talent.md](configuracion-talent.md).
   - `CRON_SECRET` (*Sensitive*, 32 caracteres o más): enciende las tareas programadas (sección siguiente).
3. Añada `https://<dominio>/auth/confirm` a las *Redirect URLs* de Supabase y ajuste la *Site URL*.
4. Despliegue y ejecute las comprobaciones de la sección siguiente.

### Tareas programadas (cron)

`vercel.json` programa dos rutas que Vercel Cron llama con `Authorization: Bearer <CRON_SECRET>`. Sin `CRON_SECRET`, responden 404 y no hacen nada.

| Ruta | Horario (UTC) | Qué hace |
|---|---|---|
| `/api/tareas/recordatorios-entrevista` | `0 13 * * *` (08:00 de Lima) | Envía el recordatorio de las entrevistas de las próximas 24 h a la persona candidata y a los entrevistadores con correo. No recuerda una entrevista agendada o cambiada hace menos de 12 h, porque la invitación acaba de llegar. Cada recordatorio sale una sola vez por entrevista, fecha y destinatario. |
| `/api/tareas/limpieza-cv` | `0 9 * * *` (04:00 de Lima) | Borra del bucket los CV que nada referencia: candidato o CV eliminado, o subida sin registrar. Deja un margen de 48 h. Con `?simular=1` solo cuenta. |

- **Frecuencia:** las dos tareas se pueden ejecutar con cualquier frecuencia sin duplicar trabajo. En el plan Pro, `0 * * * *` (cada hora) da recordatorios más parejos, unas 24 h antes.
- **Sin Vercel Cron:** cualquier programador sirve, por ejemplo `pg_cron` + `pg_net` en Supabase, GitHub Actions o el Programador de tareas de Windows:
  ```bash
  curl -H "Authorization: Bearer $CRON_SECRET" https://<dominio>/api/tareas/recordatorios-entrevista
  ```
- **Respuesta:** solo contadores, nunca datos personales. En modo de correo `test` los recordatorios responden `{"status":"omitida"}` y no reservan nada.

### Respaldos

Ver [respaldo-y-restauracion.md](respaldo-y-restauracion.md) (`scripts/respaldo/`). Haga un respaldo antes de cada despliegue con migraciones y ensaye la restauración en *staging*.

### Consideraciones

- **Tamaño de carga:** Vercel limita el cuerpo de las funciones a 4,5 MB; por eso el máximo de CV es 4 MB (`next.config.ts`, `file-validation.ts`). Para archivos mayores habría que subir directamente a Storage con URL firmadas de carga (pendiente).
- **Renderizado dinámico:** todas las páginas se generan por solicitud (CSP con *nonce*). No se cachean datos de candidatos.
- **Región de funciones:** configure la región de Vercel cercana a la del proyecto Supabase.
- **IP del postulante:** el límite de envíos del formulario público usa el primer valor de `x-forwarded-for`, que Vercel fija con la IP real del cliente.
  - Si se pone otro proxy delante, por ejemplo Cloudflare, todos los postulantes parecerán venir de la misma IP y compartirán el límite. Antes de hacerlo, hay que ajustar `src/modules/online-apply/subject.ts`.
  - Sin un proxy que fije la cabecera, un cliente podría falsearla.
- **OCR local de escaneados:** usa `tesseract.js` 7.0.0, `@tesseract.js-data/spa` 1.0.0 y `@napi-rs/canvas` 1.0.13, que tiene un binario nativo por plataforma (en Linux, `@napi-rs/canvas-linux-x64-gnu`, unos 37 MB).
  - Están en `serverExternalPackages`. Los datos de idioma y los `.wasm` se incluyen con `outputFileTracingIncludes` (`next.config.ts`). En local, los `.nft.json` de las rutas con OCR los contienen.
  - Vercel limita cada función a 250 MB sin comprimir y, con Fluid, a 300 s por defecto ([limitaciones](https://vercel.com/docs/functions/limitations), actualizada el 24/08/2026). Un OCR puede tardar hasta unos 2 minutos en el peor caso (30 s de renderizado y 90 s de reconocimiento), también dentro de `after()` en el formulario y en Talent.com.
  - Escribe la caché del idioma en `os.tmpdir()`.

## Comprobaciones posteriores al despliegue

```bash
npm run build
npm run test:secrets              # con las variables secretas del entorno cargadas
```

- [ ] `/panel` sin sesión redirige a `/ingresar`.
- [ ] Cabeceras: `Content-Security-Policy` con nonce, `X-Frame-Options: DENY`, `Strict-Transport-Security`.
- [ ] Invitación de usuario de prueba y recuperación de contraseña funcionan.
- [ ] RRHH no ve la sección Usuarios; una cuenta creada desde el panel de Supabase nace desactivada.
- [ ] La descarga de CV genera URL firmada de corta duración y un registro en `audit_logs`.
- [ ] `tests/e2e/flujo-rrhh.spec.ts` ejecutado contra *staging*.
- [ ] **Tareas programadas:** en Vercel → *Cron Jobs*, las dos tareas figuran y su última ejecución respondió 200. `curl` sin el secreto responde 404.
- [ ] **Respaldo:** se hizo uno de *staging* y se restauró sobre un proyecto vacío ([respaldo-y-restauracion.md](respaldo-y-restauracion.md)).
- [ ] **Lectura de CV en Vercel:** subir un PDF real en *staging* y comprobar que el texto se extrae. La extracción corre en un `worker_threads`; si el worker no arrancara, todos los CV quedarían como «Extracción fallida» sin otro error visible.
- [ ] **Formulario público en *staging*:** postular sin sesión desde el celular y comprobar que la postulación llega a la bandeja con su referencia, su evaluación y sus constancias. Comprobar también que la respuesta no envía cookies.
- [ ] **Google:** validar una página de vacante con la prueba de resultados enriquecidos y enviar el sitemap en Search Console.
- [ ] **OCR en Vercel:** subir en *staging* un PDF escaneado ficticio por la carga masiva y por el formulario. Comprobar que:
  - el texto se lee, con el aviso de OCR;
  - `@napi-rs/canvas` carga su binario de Linux;
  - las funciones no superan el tamaño máximo;
  - la postulación del formulario queda evaluada después del `after()`.

  Si el OCR no arrancara, los CV escaneados quedarían «sin texto legible» y se podrían transcribir a mano.
- [ ] **Texto sin contraste en Vercel:** subir en *staging* un PDF con texto blanco sobre blanco escrito con una fuente estándar **no incrustada** (Helvetica, como la de `tests/unit/pdf-contrast.test.ts`) y comprobar que sale el aviso de texto oculto. Desde el 19/11/2026 la app trae las fuentes estándar de PDF.js (`pdfjs-dist`) y el lector las pasa como ruta del disco (`extraction-core.ts`), así que no depende de las fuentes del servidor: comprobado en un Linux sin fuentes (antes la página salía en blanco y la detección se omitía en silencio), y el build empaqueta las 16 fuentes en las 8 rutas que leen PDF (`next.config.ts`). Esta comprobación confirma que también pasa en Vercel.

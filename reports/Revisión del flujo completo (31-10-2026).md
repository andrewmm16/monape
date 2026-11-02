# Revisión del flujo completo de la plataforma y el robot

**Fecha de la revisión:** sábado 31/10/2026, ~13:00–13:30 (hora de Lima).
**Qué es esto:** una foto del proyecto *mientras otras conversaciones seguían editando el robot y los portales ficticios* (`bot/src/index.ts`, `round.ts`, `runner.ts`, `fake-portal/*`, `.bot.log` cambiaban durante la revisión). Lo que digo del robot puede haber cambiado al lunes: vuelve a correr el robot y el informe de entrenamiento antes de darlo por válido.

**Cómo leer los niveles** (según tus reglas de rigor):
- **[Leído]** lo vi en el código o en los logs reales de hoy.
- **[Ejecutado]** lo corrí y vi el resultado.
- **[Supuesto]** lo deduzco, no lo comprobé.

---

## 1. Secuencia completa (cómo funciona todo, de punta a punta)

```
RRHH (persona)            App (Next.js + Supabase)              Robot (bot/, tu PC)            Portal (real o ficticio)
─────────────             ─────────────────────────              ───────────────────            ────────────────────────
1. Crea vacante ───────►  Borrador
2. Define requisitos ──►  requisitos con peso y palabras
3. «Aprobar criterios» ►  versión de criterios
4. «Publicar» ─────────►  Publicada ──► página pública /empleos, JobPosting, feed XML
5. Pestaña «Portales»:
   marca portales ─────►  portal_publications = 'pendiente'
                                                                6. cada BOT_POLL_SECONDS:
                                                                   POST /api/bot/publicaciones/siguiente
                          bot_claim_publication ─────────────►  recibe el trabajo (estado 'publicando',
                          (reserva 30 min, máx. 3 intentos)      intentos+1)
                                                                7. adaptador publica ─────────────────►  oferta creada
                                                                   guarda id en el diario (publicadas.json)
                          ◄── POST .../resultado (publicada) ── 8. informa id y enlace
                          estado 'publicada'
                                                                                                       9. El postulante postula
                                                                                                          DENTRO del portal
                                                                10. GET /api/bot/publicaciones/activas
                                                                11. adaptador lista postulantes ◄─────  tabla de postulantes
                                                                12. baja el CV de los nuevos ◄────────  PDF
                          ◄── POST /api/bot/postulantes ─────── 13. multipart: id externo, nombre,
                              (register_bot_application)            correo, teléfono, CV
                          candidato NUEVO + postulación
                          extrae texto (OCR local si es escaneo)
                          evalúa con reglas-v2 (sin IA)
                          ◄── POST .../sincronizada ──────────── 14. marca la oferta revisada
15. Bandeja «Postulaciones nuevas» / pestaña «Candidatos» (ordenados por compatibilidad)
16. Revisa evaluación → verifica requisitos → compara 2–4 → programa entrevista
17. Decide estado (siempre una persona; la IA está apagada)
18. «Cerrar» vacante ───► trigger: publicaciones → 'retirar'
                                                                19. siguiente ciclo: retira la oferta ─►  oferta cerrada
                          ◄── resultado (retirada) ────────────  estado 'retirada'
```

**Rutas paralelas de entrada de CV** (no pasan por el robot): formulario público en `/empleos/[slug]`, receptor de Talent Apply (apagado por defecto), carga masiva por lote, registro manual de candidato, y `/api/evaluar-cv`.

**Vigilancia del robot:**
- Prueba de estructura del portal (`healthCheck`) al arrancar y cada `BOT_HEALTH_CHECK_HOURS`; si falla, el robot no toca la cola.
- Cada fallo con el portal queda como incidente en `bot/.state/incidentes/`; se avisa una vez por WhatsApp (Baileys, no oficial).
- El robot informa su estado a `POST /api/bot/estado`; la app muestra un banner rojo si «necesita persona» o si pasan 15 min sin señal.
- Un portal detenido por `pagina_cambio` se reanuda solo cuando su prueba de estructura vuelve a pasar (cambio nuevo, en edición por otra conversación).

---

## 2. Qué salió mal / qué encontré

Ordenados por gravedad. Cada uno dice su nivel de evidencia.

### 🔴 A. Un portal caído se clasifica como «el portal cambió su página» (error de diagnóstico)

**[Leído, con prueba real en los logs de hoy]**
- `bot/src/errors.ts:66-71` (`errorCodeOf`): todo error que no sea de la app, `PortalError` o navegador cerrado se convierte en `pagina_cambio`. Incluye `net::ERR_CONNECTION_REFUSED`, `ERR_NAME_NOT_RESOLVED`, tiempos de espera por red lenta, etc.
- Prueba: hoy a las 17:54 UTC (12:54 Lima) los portales ficticios (puerto 4011) estaban apagados. El robot creó **6 incidentes `pagina_cambio` con `reparable: true`** (`bot/.state/incidentes/0001–0006.json`), todos con mensaje `ERR_CONNECTION_REFUSED`. Los adaptadores no estaban rotos; el servidor del portal no existía.

**Consecuencias:**
1. RRHH ve «El portal cambió su página y el robot no pudo continuar» cuando en realidad hubo un corte de internet o el portal estuvo en mantenimiento.
2. Marcar `reparable: true` invita a la reparación asistida por IA (la que diseñaste con aprobación por WhatsApp) a «arreglar» un adaptador sano. Cada intento cuesta (~$1–9 según tu estimación, no medida) y podría proponer cambios incorrectos.
3. Distorsiona el informe de entrenamiento: esos incidentes pueden contarse como «detectados» de un cambio que no ocurrió.
4. En `processQueue` (`runner.ts:168-171`), 2 fallos de publicación seguidos → `fallos_seguidos` → portal detenido; como `fallos_seguidos` no es `pagina_cambio`, **no es reanudable** (`round.ts:41`): con un solo portal o con todos caídos, el robot **termina con código 2** y espera a una persona por un simple corte de red.

**Cómo arreglarlo (propuesta, no aplicada):** clasificar por mensaje de red (`ERR_CONNECTION_*`, `ERR_NAME_NOT_RESOLVED`, `ERR_INTERNET_DISCONNECTED`, `ERR_TIMED_OUT` en `page.goto`) como `portal_no_disponible`, `reparable: false`, que reintente sin detener ni gastar IA. Hace falta un código nuevo en `PORTAL_ERROR_LABELS` (`src/lib/labels.ts:215`).

### 🔴 B. Los postulantes que llegan entre el último ciclo y el retiro de la oferta se pierden

**[Leído]**
- `runCycle` (`runner.ts:302-308`) hace primero `processQueue` (publica y **retira**) y después `syncApplicants`.
- Al informar «retirada», la publicación pasa a `retirada` (`bot_report_publication`), y `bot_list_active_publications` solo devuelve `publicada` y `retirar` (migración `20261029000100`, línea 325).
- Resultado: una vez retirada, el robot **nunca más lee esa oferta**. Cualquiera que postuló desde el último ciclo (hasta 10 min con el valor por defecto) hasta el retiro **queda en el portal pero no llega a la app**.
- Aunque `register_bot_application` acepta publicaciones `retirada` (línea 393), nadie la llama para ellas.
- Es el caso más probable al cerrar una vacante porque ya se contrató a alguien: justo cuando acaba de llegar la última tanda de CV.

**Arreglo propuesto:** antes de ejecutar un retiro, hacer una sincronización final de esa oferta y retirarla solo si termina bien (o, mínimo, que el robot sincronice las `retirar` antes de procesar la cola).

### 🟠 C. Una oferta que desaparece del portal se reintenta eternamente y se reporta como «cambio de página»

**[Leído en código + comportamiento visto en el log; la causa exacta de hoy es un supuesto]**
- El portal ficticio guarda las ofertas en memoria y arranca los ids desde `fp-1` (`fake-portal/server.ts:126,195`). Hoy, tras reiniciarlo, la app seguía creyendo publicadas `fp-7`, `fp-8`, `fp-10`… y el robot repitió en cada ciclo timeouts de 15 s por oferta (`waitFor '#li-candidatos'`, `table.tabla-postulantes`, `#postulantes`; log de las 17:59–18:00).
- Con 10 ofertas, un ciclo puede tardar más de 2,5 min solo en esperar, más que `BOT_POLL_SECONDS=120`.
- **Peligro adicional con el portal ficticio:** al reiniciarse, los ids nuevos pueden **coincidir** con los viejos (`fp-1`…) y asignar postulantes de una oferta a otra vacante en la app. En un portal real el equivalente es una oferta vencida o eliminada por el propio portal (p. ej. avisos que expiran), que hoy no tiene un estado propio: no existe «la oferta ya no existe en el portal».
- Cada ciclo recorre **todas** las ofertas activas sin límite ni uso de `last_synced_at`: no escala a decenas de ofertas por portal.

**Arreglo propuesto:** distinguir «oferta no encontrada» (404/redirección) de «página cambiada»; marcar la publicación para revisión de RRHH; escalonar la lectura usando `last_synced_at`. En el portal ficticio, persistir las ofertas o usar ids no reutilizables.

### 🟠 D. Los errores de un solo portal pueden dejar al robot completamente parado

**[Leído]** `allStopped` (`round.ts:44`) exige que todos los portales estén detenidos *y no reanudables*. En la demo con 5 portales eso es correcto; en producción con **solo Trabajos Diarios**, cualquier `fallos_seguidos`, `api_no_disponible` o sesión vencida termina el proceso (código 2) y nadie lo relanza solo (no hay servicio de Windows ni tarea programada documentada). Si la PC se reinicia, tampoco arranca.
**[Supuesto]** que esto sea un problema en tu entorno: depende de cómo lo dejes corriendo. Conviene decidir si el robot debe vivir como tarea programada con reinicio automático.

### 🟡 E. Documentación desactualizada

**[Leído]** `docs/como-funciona.md` (paso 5) todavía dice «la plataforma **no puede** publicar sola en Computrabajo, Bumeran, LinkedIn o Indeed… Luis copia el aviso». Desde el 29/10 existe la cola, la pestaña «Portales» y el robot (solo con portales ficticios y, en la práctica, con ningún portal real). El texto es correcto para portales reales, pero no explica el robot ni dice que **no hay ningún adaptador real**. Riesgo: que alguien crea que el robot ya publica en Bumeran/Computrabajo/LinkedIn.

### 🟡 F. Lo que depende de tu decisión o de terceros (no son errores de código)

- **No hay adaptador de ningún portal real.** Todo lo probado es contra portales ficticios. No se puede afirmar nada sobre el comportamiento en Trabajos Diarios, Bumeran, etc. hasta tener capturas/HTML de tu cuenta.
- **Falta autorización escrita del jefe/legal** para el robot y, aparte, para IA externa. LinkedIn, Bumeran y Computrabajo prohíben robots en sus condiciones; Computrabajo prohíbe además la «base de datos privada de CVs».
- **WhatsApp con Baileys (no oficial)** puede hacer que restrinjan tu número personal; ya lo aceptaste, solo queda anotado.
- **Todavía no está en la nube**: sigue todo en tu PC (Supabase local, `next start -p 3000`). El robot necesita `BOT_API_URL` con `https` salvo localhost: al pasar a la nube hay que reconfigurarlo.
- **`.env.bot.bak`** guarda claves reales que no están en `.env.local` (según tu memoria): sigue sin borrarse a la espera de que decidas.

---

## 3. Cómo está funcionando (resumen honesto)

| Pieza | Estado | Evidencia |
|---|---|---|
| Cola de publicaciones (SQL + API `/api/bot/*`) | Funciona según el diseño; bien protegida (secreto compartido con comparación segura, 404 uniforme, funciones solo para `service_role`, idempotencia por oferta + id externo) | [Leído] migraciones `20261029000100` y `20261030000100`, `auth.ts`, `applicants.ts`. No volví a ejecutar las pruebas de BD. |
| Publicar en 5 portales ficticios | Funcionó hoy | [Leído en log] 10 «Publicada» entre 17:50:00 y 17:50:26 UTC, 2 «Retirada» a las 17:52. |
| Prueba de estructura | Funcionó | [Leído en log] 5 «correcta» al arrancar. |
| Detección de cambios (mutador) | Detecta, pero con diagnóstico pobre | Ver hallazgo A: hoy generó 6 incidentes por un corte, no por un cambio. |
| Traer postulantes | Probado el 29/10 de punta a punta (según tu memoria); hoy no hubo postulantes nuevos en el log | [Leído] memoria + log. No lo repetí. |
| Evaluación por reglas, comparación, entrevistas | Terminado y probado según el informe del 28/10 | [Leído] `docs/informe-pruebas.md` §4 terdecies (unit 477, db 247, 6 E2E). Hoy solo intenté repetir las unitarias (abajo). |
| Aviso a RRHH (banner) y WhatsApp | Implementado; el banner depende de `POST /api/bot/estado` | [Leído]. No probé el WhatsApp hoy. |
| Adaptadores reales | **No existen** | [Leído] `bot/README.md` línea 5. |

## 4. Resultados de ejecución de hoy

**[Ejecutado] `tsc --noEmit`:** terminó sin errores (código 0), con el código tal como estaba a las ~13:13.

**[Ejecutado] `vitest run --project unit` (13:22–13:32, 564 s):** **49 fallidas de 603; 554 pasaron.** En el informe del 28/10 eran 477/477, así que hoy NO se reproduce el verde. Pero el patrón apunta más a lentitud que a lógica rota:

| Archivo | Fallos | Tipo |
|---|---|---|
| `online-apply.test.ts` | 28 | tiempo agotado (20 s) |
| `resumes.test.ts` | 7 | tiempo agotado / `tiempo_agotado` en vez de `recursos_agotados` |
| `extraction-ocr-keep.test.ts` | 5 | tiempo agotado |
| `ocr.test.ts` | 3 | tiempo agotado (90–120 s) |
| `intake.test.ts` | 2 | tiempo agotado |
| `talent-apply.test.ts` | 2 | 1 tiempo agotado + 1 consecuencia en cadena (el mock quedó llamado) |
| `public-robots.test.ts` | 1 | una prueba de rendimiento (3370 ms contra un límite de 500 ms) |
| `rule-engine.test.ts` | 1 | no lo detallé |

Todos los fallos están en extracción de PDF/OCR (`worker_threads`, tesseract) o en lo que depende de ella. **[Supuesto, no comprobado]:** la causa es la carga de la PC (en ese momento corrían el robot con Chromium, WhatsApp, `next start` y Supabase, más otras conversaciones; tu memoria ya registra que el equipo se vuelve lentísimo a ratos). **No puedo afirmar que el código esté bien ni que esté mal.** Para saberlo: cerrar el robot y las otras conversaciones, y repetir solo esos 8 archivos. Si `resumes.test.ts` sigue dando `tiempo_agotado` en lugar de `recursos_agotados` con la PC quieta, sería un error real del límite de memoria del worker.

**No ejecuté:** `test:db`, `test:bot`, `test:e2e`, `lint` ni `build` (este último reemplazaría `.next` mientras tu servidor en el puerto 3000 está en uso).

## 5. Para el lunes (orden sugerido)

1. Decidir si quieres que corrija A (clasificar caída de red) y B (sincronización final antes de retirar). Son cambios pequeños y de mayor valor. Los dejé sin tocar porque `runner.ts`, `round.ts` e `index.ts` los está editando otra conversación.
2. Pedir a las otras conversaciones que terminen y volver a correr: `npm run test:unit`, `npm run test:bot`, `npm run typecheck`, y `npm run bot:training-report` con los incidentes ya decididos (`sí N` / `no N`).
3. Limpiar los incidentes 1–6 de hoy (son falsos) para que no contaminen el informe de entrenamiento.
4. Actualizar `docs/como-funciona.md` paso 5 cuando el robot esté listo.
5. Reunir lo que falta para un adaptador real: capturas/HTML de la cuenta de Trabajos Diarios y el permiso escrito.

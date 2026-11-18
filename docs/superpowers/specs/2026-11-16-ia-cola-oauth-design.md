# Diseño: evaluación con IA en cola, ejecutada con la suscripción de Claude (OAuth)

- **Fecha:** 2026-11-16
- **Estado:** aprobado por Omar ("sigamos de esa manera, empieza a implementarlo").
- **Ámbito:** BD (cola), servidor (API del worker, encolado), worker nuevo `ia-worker/`, UI de la postulación, docs.

## Intención

El motor de reglas sigue siendo la primera línea. Para cubrir sus falsos positivos y
negativos, una evaluación con IA se encola y la procesa un **worker siempre encendido**
que ejecuta el CLI oficial `claude -p` con la suscripción de Omar (`claude setup-token` →
`CLAUDE_CODE_OAUTH_TOKEN`). Sin tope de análisis: el único límite es el del plan (ventanas
de 5 h y semanales); al alcanzarlo, la cola espera y se reanuda sola.

Riesgo aceptado por Omar: los términos de Anthropic no contemplan este uso de una
suscripción; puede bloquearse sin aviso. Por eso el motor nunca depende de la IA y el
transporte es intercambiable (`AI_PROVIDER=anthropic` sigue disponible).

## Decisiones

1. **El worker es un transporte, no confía en nada.** Recibe solo el prompt ya armado
   (CV con datos de contacto reemplazados + requisitos) y devuelve la salida cruda del
   modelo. El servidor valida la respuesta (`interpretAiResponse`: citas literales,
   requisitos legales nunca acreditados), aplica las verificaciones de RRHH, calcula la
   puntuación determinista y registra con `record_evaluation_core`.
2. **Sin clave de servicio de Supabase en el worker.** Habla con la app por
   `/api/ia/trabajos/*` con `Authorization: Bearer <AI_WORKER_SECRET>` (mismo patrón que
   `/api/bot/*`).
3. **Integridad entre reclamo y resultado.** Al reclamar se guarda el SHA-256 del texto
   enviado y la versión de criterios. Si al reportar el CV o los criterios cambiaron, el
   trabajo vuelve a la cola sin contar intento.
4. **Encolado automático configurable** (`AI_AUTO_ENQUEUE`): `off`, `dudosos` (por
   defecto) o `todos`, tras cada evaluación del motor. No se re-encola si ya hay una
   evaluación con IA del mismo CV y la misma versión de criterios. El botón «Evaluar con
   IA» siempre encola (prioridad sobre los automáticos).
5. **Caso dudoso** (`isDoubtful`): nivel `pendiente` o `parcial`; puntaje a 10 puntos o
   menos de un corte (40/70); un obligatorio «no cumplido»; o 30 puntos o más entre puntaje
   y máximo alcanzable.
6. **Reintentos:** máx. 3 intentos con espera creciente; el límite del plan no cuenta como
   intento y fija `available_at` en la hora de renovación (o +15 min si no se conoce).
   Reserva de 10 min: si el worker se cae, el trabajo se retoma.
7. **El resultado se registra como evaluación `ia`** (pasa a ser la vigente, como hoy con
   «Evaluar con IA»); la del motor queda en el historial. Actor: quien la pidió, o nulo si
   fue automática.

## Fuera de alcance

Vista comparativa motor vs. IA por requisito; panel global de la cola.

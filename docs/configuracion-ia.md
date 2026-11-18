# Configuración del proveedor de IA

## Estado actual

- La evaluación por defecto usa el **motor de reglas determinista**: no envía datos a terceros.
- Hay dos formas de usar IA, elegidas con `AI_PROVIDER`:
  - **`claude-cli` (cola, suscripción de Claude, sin costo por token).** La evaluación se encola y la procesa el worker [`ia-worker/`](../ia-worker/README.md), que ejecuta el CLI oficial `claude -p` con OAuth (`claude setup-token`). **Probada de punta a punta el 16/11/2026** en local, con un CV ficticio y `claude-opus-5-5`.
  - **`anthropic` (API de pago, dentro de la solicitud).** Implementado y probado con respuestas simuladas, pero **no se ha probado contra la API real**.

## Condiciones para habilitarla

La opción «Evaluar con IA» solo se activa si se cumplen las tres condiciones (`src/modules/evaluation/ai/availability.ts`):

1. `AI_PROVIDER=claude-cli` o `AI_PROVIDER=anthropic`
2. Con `claude-cli`: `AI_WORKER_SECRET` configurado (32 caracteres o más). Con `anthropic`: `AI_API_KEY` configurada. Ambas son variables de servidor.
3. `AI_EXTERNAL_PROCESSING_APPROVED=true`

## Modo cola (`AI_PROVIDER=claude-cli`)

- **Sin tope de análisis.** No aplica `AI_MAX_EVALUATIONS_PER_DAY` ni el límite por usuario. Solo hay un trabajo abierto por postulación. El freno real es el límite del plan de Claude: al alcanzarlo, la cola espera hasta la renovación.
- **Segunda opinión automática** (`AI_AUTO_ENQUEUE`), tras cada evaluación del motor (manual, masiva, formulario, robot, integraciones):
  - `dudosos` (por defecto): nivel pendiente o parcial; puntaje a 10 puntos o menos de un corte (40/70); un obligatorio «no cumplido»; o 30 puntos o más entre el puntaje y el máximo alcanzable (`ai/doubtful.ts`).
  - `todos`: toda evaluación del motor.
  - `off`: solo a pedido.

  No se repite si ya hay una evaluación con IA del mismo CV y la misma versión de criterios.
- **«Evaluar con IA»** encola a pedido, con prioridad sobre los automáticos. La página muestra el estado («en cola», «analizando», «en espera por límite», «error») y se actualiza sola hasta que llega el resultado.
- **El resultado se registra como evaluación `ia`** y pasa a ser la vigente; la del motor queda en el historial. Las salvaguardas son las mismas de abajo. El worker solo transporta: no ve la base de datos y la validación la hace la app.
- **Riesgo aceptado:** los términos de Anthropic no contemplan este uso de una suscripción y puede bloquearse sin aviso. El motor nunca depende de la IA, y cambiar a `anthropic` o `none` no requiere tocar código.
- **Vigilancia del worker:** si no da señales de vida en 3 minutos o está en pausa, RRHH lo ve en el panel y en la postulación. Si hay que intervenir (sesión de Claude inválida), se avisa por correo a administración.
- **Medición** con los CV ficticios: `npm run medir:ia`. Los resultados del 16/11/2026 están en el README del worker.
- Puesta en marcha, despliegue del worker y errores: [`ia-worker/README.md`](../ia-worker/README.md).

`AI_EXTERNAL_PROCESSING_APPROVED=true` habilita el envío del texto del CV al proveedor externo. Mientras esté en `false`, la opción «Evaluar con IA» no aparece.

## Variables

| Variable | Valor por defecto | Descripción |
|---|---|---|
| `AI_PROVIDER` | `none` | `none`, `claude-cli` (cola con la suscripción) o `anthropic` (API de pago) |
| `AI_API_KEY` | — | Clave del proveedor (solo servidor; solo `anthropic`) |
| `AI_WORKER_SECRET` | — | Secreto de la API del worker `/api/ia/*` (solo `claude-cli`; 32 caracteres o más). Sin él, la API responde 404 |
| `AI_AUTO_ENQUEUE` | `dudosos` | Solo `claude-cli`: `off`, `dudosos` o `todos` |
| `AI_MODEL` | `claude-haiku-5-5` | Modelo. Haiku basta para leer el CV y confirmar texto; para más finura use `claude-sonnet-5-5` o `claude-opus-5-5` (gastan más del plan). Si cambia de modelo, verifique que admita salida estructurada y el parámetro `effort` |
| `AI_EXTERNAL_PROCESSING_APPROVED` | `false` | Habilita el envío del CV a un proveedor externo |
| `AI_MAX_EVALUATIONS_PER_DAY` | `50` | Límite global diario (control de costos; solo `anthropic`) |
| `AI_MAX_INPUT_CHARS` | `30000` | Caracteres máximos del CV enviados (se indica en las limitaciones si se recorta) |

## Qué se envía y qué no

- Se envía: el texto del CV **con correos, teléfonos, enlaces y números de documento reemplazados** (`ai/redact.ts`), el título de la vacante y los requisitos aprobados.
- No se envía: el archivo original, el nombre del archivo, observaciones internas, datos de otros candidatos.
- Limitación: la redacción automática no elimina nombres propios ni direcciones.

## Salvaguardas

- **Prompt versionado** (`ai/prompt.ts`, versión `ia-prompt-v1`, guardada en cada evaluación). Prohíbe usar o inferir características protegidas y trata el CV como dato no confiable (mitiga instrucciones inyectadas en el CV).
- **Salida estructurada** con esquema Zod; las respuestas inválidas se descartan y no se registra evaluación.
- **Verificación de citas** (`ai/response.ts`): toda cita debe aparecer literalmente en el texto enviado; una valoración «acreditado» o «no cumplido» sin cita verificable pasa a «pendiente de verificación». Los requisitos legales/esenciales nunca quedan acreditados automáticamente. Requisitos omitidos o inventados por el modelo se gestionan de forma segura.
- **La puntuación no la calcula el modelo**: se calcula con la misma metodología determinista que el motor de reglas y la base de datos la recalcula al registrar.
- Se usa el parámetro `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`): si el modelo declina por política, la API reintenta en el modelo alternativo que define el proveedor. Si todos declinan, se informa al usuario y no se registra nada.
- Límites (solo `anthropic`): 10 evaluaciones con IA por usuario cada 10 minutos y el límite diario global. En modo cola no hay tope propio.

## Costos orientativos

El costo depende del modelo y de la longitud del CV. Con `claude-opus-5-5` (USD 4 / 20 por millón de tokens de entrada/salida según la tabla de precios vigente al 6/10/2026) y un CV de ~8 000 tokens, cada evaluación cuesta del orden de USD 0,05–0,15. Confirme precios actuales antes de aprobar el presupuesto. Puede reducir el costo con `AI_MAX_INPUT_CHARS` o eligiendo otro modelo tras evaluar su calidad con casos ficticios.

## Antes de producción

- [ ] Prueba con CV **ficticios** en el entorno de pruebas y revisión manual de resultados.
- [ ] Revisión periódica de sesgos: comparar resultados de IA y del motor de reglas, y las correcciones de RRHH.

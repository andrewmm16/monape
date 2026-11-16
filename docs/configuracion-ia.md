# Configuración del proveedor de IA

## Estado actual

- La evaluación por defecto usa el **motor de reglas determinista**: no envía datos a terceros.
- El adaptador de IA (Anthropic, SDK oficial) está implementado y probado con respuestas simuladas, pero **no se ha probado contra la API real**.

## Condiciones para habilitarla

La opción «Evaluar con IA» solo se activa si se cumplen las tres condiciones (`src/modules/evaluation/ai/availability.ts`):

1. `AI_PROVIDER=anthropic`
2. `AI_API_KEY` configurada (variable de servidor)
3. `AI_EXTERNAL_PROCESSING_APPROVED=true`

`AI_EXTERNAL_PROCESSING_APPROVED=true` habilita el envío del texto del CV al proveedor externo. Mientras esté en `false`, la opción «Evaluar con IA» no aparece.

## Variables

| Variable | Valor por defecto | Descripción |
|---|---|---|
| `AI_PROVIDER` | `none` | `none` o `anthropic` |
| `AI_API_KEY` | — | Clave del proveedor (solo servidor) |
| `AI_MODEL` | `claude-opus-5-5` | Modelo. Si cambia de modelo, verifique que admita salida estructurada y el parámetro `effort` |
| `AI_EXTERNAL_PROCESSING_APPROVED` | `false` | Habilita el envío del CV a un proveedor externo |
| `AI_MAX_EVALUATIONS_PER_DAY` | `50` | Límite global diario (control de costos) |
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
- Límites: 10 evaluaciones con IA por usuario cada 10 minutos y el límite diario global.

## Costos orientativos

El costo depende del modelo y de la longitud del CV. Con `claude-opus-5-5` (USD 4 / 20 por millón de tokens de entrada/salida según la tabla de precios vigente al 6/10/2026) y un CV de ~8 000 tokens, cada evaluación cuesta del orden de USD 0,05–0,15. Confirme precios actuales antes de aprobar el presupuesto. Puede reducir el costo con `AI_MAX_INPUT_CHARS` o eligiendo otro modelo tras evaluar su calidad con casos ficticios.

## Antes de producción

- [ ] Prueba con CV **ficticios** en el entorno de pruebas y revisión manual de resultados.
- [ ] Revisión periódica de sesgos: comparar resultados de IA y del motor de reglas, y las correcciones de RRHH.

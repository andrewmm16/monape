# Diseño corto: señal de solapamiento de fechas en el historial laboral

- **Fecha:** 2026-11-14
- **Estado:** aprobado por Omar (alcance v1 = solo solapamientos)
- **Ámbito:** `src/modules/evaluation/` (motor determinista). No toca scoring, BD ni UI.

## Intención y porqué

Detectar cuando el CV declara **dos empleos que coinciden en el tiempo** y convertirlo en una
**nota para que RRHH lo verifique en la entrevista** — nunca un descarte ni un puntaje de
"veracidad". Es la señal #2 del frente anti-trampas (tras el detector de texto oculto). Da a
RRHH una pregunta concreta y verificable, en línea con que lo que predice el desempeño es la
entrevista estructurada, no un filtro automático.

## Objetivos / no-objetivos / anti-objetivos

**Objetivos**
- Marcar solapamientos **ciertos** entre empleos distintos, con cita literal de ambas fechas.
- Mantener el carácter determinista y explicable; no cambiar el puntaje ni el orden.

**No-objetivos (v1)**
- **Huecos** entre empleos: NO se marcan. Un hueco es ausencia de información y correlaciona con
  características protegidas (maternidad, salud, cuidado familiar); marcarlo introduce sesgo
  indirecto, contra el principio rector. Decisión explícita de Omar.
- **Fechas imposibles** (fin antes de inicio, etc.): quedan para v1.1 (viven en los descartes
  internos de `parsePeriods`; reportarlas exige instrumentar código calibrado + revalidar bancos).

**Anti-objetivos (fracaso aunque "funcione")**
- Inflar la señal con falsos positivos (p. ej. marcar como solapamiento el año de transición entre
  dos empleos secuenciales declarados solo con el año). El error caro del proyecto es el ruido que
  hace que RRHH ignore la señal.

## Diseño

- **Detección conservadora.** Cada periodo de `experience-dates.ts` trae dos cotas por mes: `lo`
  (coexistencia garantizada) y `hi` (máxima posible). Se marca solapamiento entre dos empleos solo
  si la intersección de sus `lo` es **≥ 2 meses**. Así:
  - dos empleos con meses explícitos que se pisan → se marcan;
  - dos empleos secuenciales que comparten solo el año de transición (declarado solo con año) →
    su `lo` no se intersecta → NO se marcan (se evita el falso positivo);
  - dos empleos declarados solo con el mismo año → `lo` colapsa a 1 mes (< 2) → NO se marcan
    (ambiguo, no se infla).
- **Módulo nuevo `date-consistency.ts`** (puro): `findDateOverlaps(index)` sobre el
  `ExperienceIndex` ya existente; `describeDateOverlaps(overlaps)` redacta las notas con las dos
  citas; `detectDateOverlapNotes(original, referenceDate)` aplica `maskReferences` +
  `buildExperienceIndex` y devuelve `string[]`.
- **Integración:** `service.ts` calcula las notas sobre el CV completo (ambos métodos) y las pasa a
  `assembleEvaluation`, que las concatena en `limitations` vía `buildLimitations`. Tope de notas
  para no inundar.
- **Versiones:** no cambia `RULE_ENGINE_VERSION` ni `SCORING_VERSION` (no altera puntaje ni orden);
  `medir:motor` debe seguir 8/8.

## Verificación

- Tests unitarios de `findDateOverlaps`/`describeDateOverlaps` (solapa / secuencial / año-solo).
- `medir:motor` 8/8 (el orden no cambia), vitest unit completo, typecheck y lint.

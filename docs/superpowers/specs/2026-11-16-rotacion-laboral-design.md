# Diseño corto: señal neutra de rotación laboral (job-hopping)

- **Fecha:** 2026-11-16
- **Estado:** aprobado por Omar (umbrales: ≤ 12 meses y ≥ 3 empleos cortos)
- **Ámbito:** `src/modules/evaluation/` (motor determinista). No toca scoring, BD ni UI.

## Intención y porqué

Señal #3 del frente anti-trampas, la que cierra el plan de señales. Cuando el CV
declara **varios empleos de corta duración**, se añade una **nota informativa para
RRHH** que invita a conversar la trayectoria en la entrevista. Nunca descarta ni
puntúa: por decisión explícita de Omar, la rotación **no es, por sí sola, un
criterio de selección** (correlaciona con sector, edad y circunstancias ajenas al
desempeño). Es solo un aviso neutro para que una persona lo valore.

## Objetivos / no-objetivos / anti-objetivos

**Objetivos**
- Contar los empleos de la sección de experiencia que con certeza son cortos y, si
  hay varios, emitir una nota neutra con la cifra como evidencia.
- Mantener el carácter determinista y explicable; no cambiar el puntaje ni el orden.

**No-objetivos**
- No calcula un "índice de inestabilidad" ni penaliza. Solo cuenta y describe.
- No mira huecos entre empleos (terreno de sesgo, ya excluido en la señal #2).

**Anti-objetivos (fracaso aunque "funcione")**
- Marcar como rotación una trayectoria normal. Un empleo declarado solo con años
  («2019 – 2020») es ambiguo: podría abarcar hasta 24 meses, así que **no** se
  cuenta como corto. El error caro es el ruido que hace que RRHH ignore la señal.

## Diseño

- **Detección conservadora.** Cada periodo trae la cota `hi` (duración máxima
  posible). Un empleo se cuenta como corto solo si incluso su `hi` es
  ≤ `SHORT_TENURE_MAX_MONTHS` (12). Un empleo con solo el año no llega al umbral.
- **Umbral de la nota:** se emite solo con ≥ `MIN_SHORT_TENURES` (3) empleos cortos.
- **Reutiliza el índice** que ya calcula `experience-dates.ts`
  (`buildExperienceIndex`), el mismo que usan las señales #1 y #2. Módulo
  `date-consistency.ts`: `countShortTenures(index)` y `describeJobHopping(n)`;
  `detectDateSignalNotes` suma sus notas a las de solapamiento e incoherencia.
- **Integración:** ya existe; `service.ts` pasa `signalNotes` a `assembleEvaluation`,
  que las concatena en `limitations`. No se cambia nada del flujo.
- **Versiones:** no cambia `RULE_ENGINE_VERSION` ni `SCORING_VERSION`; `medir:motor`
  debe seguir 8/8.

## Verificación

- Tests unitarios de `countShortTenures`/`describeJobHopping` (tres cortos marcan;
  dos no; año-solo no cuenta; empleo largo no cuenta; redacción con cifra y «entrevista»).
- `medir:motor` 8/8, vitest unit completo, typecheck y lint.
- Comprobación de falsos positivos sobre los 80 CV del banco.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { assembleEvaluation } from "@/modules/evaluation/assemble";
import type { Assessment, RequirementInput } from "@/modules/evaluation/types";
import {
  addRequirement,
  approveCriteria,
  asActor,
  createApplication,
  createCandidate,
  createTestDatabase,
  createUser,
  createVacancy,
  user,
} from "./harness";

/**
 * La puntuación y el nivel se calculan en TypeScript (scoring.ts) y la base de
 * datos los recalcula al registrar (record_evaluation), rechazando cualquier
 * diferencia. Esta prueba verifica que ambas implementaciones coinciden en
 * combinaciones aleatorias reproducibles de pesos, prioridades y valoraciones.
 */
let db: PGlite;
let rrhh: string;

beforeAll(async () => {
  db = await createTestDatabase();
  rrhh = await createUser(db, "rrhh");
});

afterAll(async () => {
  await db?.close();
});

function seededRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

const ASSESSMENTS: Assessment[] = ["acreditado", "no_cumplido", "sin_evidencia", "pendiente_verificacion"];

describe("coherencia de la metodología entre TypeScript y la base de datos", () => {
  it("60 combinaciones aleatorias se registran sin discrepancias", async () => {
    const random = seededRandom(20261022);
    const levels = new Set<string>();

    for (let combo = 0; combo < 60; combo++) {
      const vacancyId = await createVacancy(db, { title: `Combinación ${combo}` });
      const count = 1 + Math.floor(random() * 8);
      const requirements: RequirementInput[] = [];
      for (let i = 0; i < count; i++) {
        const weight = 1 + Math.floor(random() * 10);
        const priority = random() < 0.6 ? "obligatorio" : "deseable";
        const id = await addRequirement(db, vacancyId, { description: `R${i}`, weight, priority });
        requirements.push({ id, category: "habilidad_tecnica", priority, description: `R${i}`, keywords: [], weight, minYears: null, isEssential: false });
      }
      const version = await approveCriteria(db, vacancyId);
      const applicationId = await createApplication(db, await createCandidate(db), vacancyId);

      const result = assembleEvaluation({
        method: "reglas",
        methodVersion: "reglas-v1",
        model: null,
        requirements,
        items: requirements.map((r) => ({
          requirementId: r.id,
          assessment: ASSESSMENTS[Math.floor(random() * ASSESSMENTS.length)]!,
          evidence: [],
          rationale: "Prueba de coherencia",
        })),
        textWasCorrected: false,
        textTruncated: false,
      });
      levels.add(result.level);

      const { rows } = await asActor(db, user(rrhh), () =>
        db.query<{ id: string }>(
          `select public.record_evaluation($1, null, $2, 'reglas', 'reglas-v1', $3, null, $4, $5, $6,
             $7::public.compatibility_level, $8, $9, null, $10::jsonb) as id`,
          [
            applicationId,
            version,
            result.scoringVersion,
            result.scores.score,
            result.scores.potential,
            result.scores.coverage,
            result.level,
            result.summary,
            result.limitations,
            JSON.stringify(result.items.map((i) => ({ requirement_id: i.requirementId, assessment: i.assessment }))),
          ],
        ),
      );
      expect(rows[0]!.id).toBeTruthy();
    }

    // Las combinaciones cubren los cuatro niveles.
    expect([...levels].sort()).toEqual(["alta", "baja", "parcial", "pendiente"]);
  });
});

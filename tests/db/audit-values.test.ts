import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { addRequirement, asActor, createCandidate, createTestDatabase, createUser, createVacancy, user } from "./harness";

let db: PGlite;
let rrhh: string;

beforeAll(async () => {
  db = await createTestDatabase();
  rrhh = await createUser(db, "rrhh", "RRHH Ficticio");
});

afterAll(async () => {
  await db?.close();
});

type Row = { action: string; metadata: Record<string, unknown> };
const logsOf = (table: string, id: string) =>
  db.query<Row>("select action, metadata from public.audit_logs where entity_type = $1 and entity_id = $2 order by created_at, id", [table, id]);

describe("auditoría con valor anterior y nuevo", () => {
  it("al modificar una vacante guarda el valor anterior y el nuevo de los campos permitidos", async () => {
    const vacancyId = await createVacancy(db);
    await asActor(db, user(rrhh), () =>
      db.query("update public.vacancies set title = 'Título nuevo', department = 'Finanzas' where id = $1", [vacancyId]),
    );
    const { rows } = await logsOf("vacancies", vacancyId);
    const update = rows.find((r) => r.action === "update")!;
    const changes = update.metadata.changes as Record<string, { from: unknown; to: unknown }>;
    expect(changes.title!.to).toBe("Título nuevo");
    expect(changes.department).toEqual({ from: "Operaciones", to: "Finanzas" });
  });

  it("al crear un requisito guarda su texto y al eliminarlo no se pierde", async () => {
    const vacancyId = await createVacancy(db);
    const requirementId = await addRequirement(db, vacancyId, { description: "Excel avanzado", weight: 3 });
    const { rows } = await logsOf("vacancy_requirements", requirementId);
    expect((rows.find((r) => r.action === "insert")!.metadata.values as Record<string, unknown>).description).toBe("Excel avanzado");

    await db.query("delete from public.vacancy_requirements where id = $1", [requirementId]);
    const after = await logsOf("vacancy_requirements", requirementId);
    expect((after.rows.find((r) => r.action === "delete")!.metadata.values as Record<string, unknown>).description).toBe("Excel avanzado");
  });

  it("no guarda datos personales: del candidato y del usuario solo campos no sensibles", async () => {
    const candidateId = await createCandidate(db, "Nombre Que No Debe Aparecer");
    await db.query("update public.candidates set phone = '999111222', full_name = 'Otro Nombre Privado' where id = $1", [candidateId]);
    const { rows } = await logsOf("candidates", candidateId);
    const text = JSON.stringify(rows.map((r) => r.metadata));
    expect(text).not.toContain("Nombre Que No Debe Aparecer");
    expect(text).not.toContain("Otro Nombre Privado");
    expect(text).not.toContain("999111222");

    const profile = await logsOf("profiles", rrhh);
    expect(JSON.stringify(profile.rows.map((r) => r.metadata))).not.toContain("RRHH Ficticio");
  });

  it("recorta los valores largos a 200 caracteres", async () => {
    const vacancyId = await createVacancy(db);
    const requirementId = await addRequirement(db, vacancyId, { description: "corto", weight: 3 });
    await db.query("update public.vacancy_requirements set description = $2 where id = $1", [requirementId, "x".repeat(400)]);
    const { rows } = await logsOf("vacancy_requirements", requirementId);
    const changes = rows.find((r) => r.action === "update")!.metadata.changes as Record<string, { to: string }>;
    expect(changes.description!.to).toHaveLength(200);
  });
});

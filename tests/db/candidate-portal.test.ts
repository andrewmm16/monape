import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  asActor,
  createApplication,
  createCandidate,
  createTestDatabase,
  createUser,
  createVacancy,
  expectError,
  user,
} from "./harness";

/** Portal del candidato: enlace de seguimiento y estado público (apagado por defecto). */
let db: PGlite;
let admin: string;
let rrhh: string;
let applicationId: string;

beforeAll(async () => {
  db = await createTestDatabase();
  admin = await createUser(db, "admin", "Admin");
  rrhh = await createUser(db, "rrhh", "RRHH");
  applicationId = await createApplication(db, await createCandidate(db), await createVacancy(db, { title: "Analista de Datos" }));
});

afterAll(async () => {
  await db.close();
});

async function asService<T>(fn: () => Promise<T>): Promise<T> {
  await db.exec("set role service_role");
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
  }
}

const createLink = (actor: string) =>
  asActor(db, user(actor), () =>
    db.query<{ token: string }>("select public.create_application_tracking_link($1) as token", [applicationId]),
  ).then((r) => r.rows[0]!.token);

const status = (token: string) =>
  asService(() => db.query<{ status: Record<string, unknown> | null }>("select public.public_application_status($1) as status", [token])).then(
    (r) => r.rows[0]!.status,
  );

const setEnabled = (actor: string, enabled: boolean) =>
  asActor(db, user(actor), () => db.query("update public.candidate_portal_settings set enabled = $1 where id", [enabled]));

describe("portal del candidato", () => {
  it("apagado por defecto: el enlace no muestra nada", async () => {
    const token = await createLink(rrhh);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(await status(token)).toBeNull();
  });

  it("encendido: muestra la etapa sin datos internos; un enlace nuevo invalida el anterior", async () => {
    await setEnabled(admin, true);
    const first = await createLink(rrhh);
    const shown = await status(first);
    expect(shown).toMatchObject({ vacancy_title: "Analista de Datos", stage: "recibida", next_interview: null });
    expect(Object.keys(shown!).sort()).toEqual(["applied_at", "next_interview", "stage", "updated_at", "vacancy_title"]);

    await asActor(db, user(rrhh), () =>
      db.query("select public.schedule_interview($1, now() + interval '2 days', 45, 'virtual', 'https://meet.example/z')", [applicationId]),
    );
    const withInterview = await status(first);
    expect(withInterview).toMatchObject({ stage: "entrevista" });
    expect(withInterview!.next_interview).toMatchObject({ modality: "virtual", location: "https://meet.example/z" });

    const second = await createLink(rrhh);
    expect(await status(first)).toBeNull();
    expect(await status(second)).not.toBeNull();
    expect(await status("no-es-un-token")).toBeNull();
  });

  it("se guarda solo la huella del token", async () => {
    const token = await createLink(rrhh);
    const { rows } = await db.query<{ token_hash: string }>(
      "select token_hash from public.application_tracking_tokens where application_id = $1",
      [applicationId],
    );
    expect(rows[0]!.token_hash).not.toBe(token);
    expect(rows[0]!.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("permisos: RRHH no enciende el portal; solo el servidor lee el estado público", async () => {
    await setEnabled(rrhh, false);
    const { rows } = await db.query<{ enabled: boolean }>("select enabled from public.candidate_portal_settings");
    expect(rows[0]!.enabled).toBe(true); // la RLS no dejó cambiarlo
    await expectError(asActor(db, user(rrhh), () => db.query("select public.public_application_status('x')")));
    await expectError(asActor(db, user(rrhh), () => db.query("select * from public.application_tracking_tokens")));
  });
});

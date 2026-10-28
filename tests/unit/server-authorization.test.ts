import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VacancyFormInput } from "@/modules/vacancies/schemas";

/**
 * Las Server Actions y rutas verifican sesión y rol en el servidor antes de
 * acceder a datos. Se sustituye Supabase por un cliente falso que registra
 * cada operación, para comprobar que una solicitud no autorizada no llega a
 * ejecutar escrituras, RPC, subidas de archivos ni el cliente con clave secreta.
 */

type Profile = { id: string; full_name: string; email: string; role: "admin" | "rrhh"; is_active: boolean };

const state = vi.hoisted(() => ({
  userId: null as string | null,
  profile: null as Profile | null,
  calls: [] as string[],
  adminClientCreated: false,
  allowAdmin: false,
  visibleResume: false,
  evaluationApplicationId: null as string | null,
}));

function createQuery(table: string) {
  const result = { data: [] as unknown[], error: null, count: 0 };
  const query: Record<string, unknown> = {};
  const chain = () => query;
  for (const method of ["select", "eq", "neq", "in", "is", "or", "order", "range", "limit", "gte"]) query[method] = chain;
  for (const method of ["insert", "update", "delete", "upsert"]) {
    query[method] = () => {
      state.calls.push(`${method}:${table}`);
      return query;
    };
  }
  query.maybeSingle = async () => ({
    data:
      table === "profiles"
        ? state.profile
        : table === "candidates"
          ? { id: "2b1c1f8e-6a0b-4f53-9a1c-3c5f0f6f1a10" }
          : table === "resumes" && state.visibleResume
            ? { id: "2b1c1f8e-6a0b-4f53-9a1c-3c5f0f6f1a10", storage_path: "candidates/x/y.pdf", original_filename: "cv.pdf" }
            : table === "candidate_evaluations" && state.evaluationApplicationId
              ? { application_id: state.evaluationApplicationId }
              : null,
    error: null,
  });
  query.single = async () => ({ data: null, error: { code: "PGRST116" } });
  query.then = (resolve: (value: typeof result) => unknown) => resolve(result);
  return query;
}

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getClaims: async () => ({ data: state.userId ? { claims: { sub: state.userId } } : null, error: null }),
      signOut: async () => {
        state.calls.push("auth:signOut");
        return { error: null };
      },
    },
    from: (table: string) => createQuery(table),
    rpc: async (name: string) => {
      state.calls.push(`rpc:${name}`);
      return { data: true, error: null };
    },
    storage: {
      from: () => ({
        upload: async () => {
          state.calls.push("storage:upload");
          return { error: null };
        },
        createSignedUrl: async () => {
          state.calls.push("storage:signed_url");
          return { data: { signedUrl: "https://ejemplo.test/firmada" }, error: null };
        },
      }),
    },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => {
    state.adminClientCreated = true;
    if (!state.allowAdmin) throw new Error("No debería crearse el cliente con clave secreta");
    return {
      storage: {
        from: () => ({
          createSignedUrl: async (_path: string, ttl: number) => {
            state.calls.push(`admin:signed_url:${ttl}`);
            return { data: { signedUrl: "https://ejemplo.test/firmada" }, error: null };
          },
        }),
      },
    };
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
  unstable_rethrow: vi.fn(),
}));

const { createVacancy, approveCriteria, addRequirement, deleteDraftVacancy } = await import("@/modules/vacancies/actions");
const { createCandidate, verifyCandidateField } = await import("@/modules/candidates/actions");
const { uploadResume } = await import("@/modules/resumes/actions");
const { runEvaluation, changeApplicationStatus, reviewEvaluation, addApplicationNote, requestOpinion } = await import(
  "@/modules/applications/actions"
);
const { deleteUser, inviteUser, updateUser } = await import("@/modules/users/actions");
const { activateNotice, createNotice, deleteNotice, revokeConsent, updateNotice } = await import("@/modules/privacy/actions");
const { GET: downloadResume } = await import("@/app/api/resumes/[id]/download/route");
const { GET: inactiveAccount } = await import("@/app/auth/cuenta-desactivada/route");
const { NextRequest } = await import("next/server");

const ID = "2b1c1f8e-6a0b-4f53-9a1c-3c5f0f6f1a10";

function signInAs(role: Profile["role"] | null, options: { active?: boolean } = {}) {
  if (!role) {
    state.userId = null;
    state.profile = null;
    return;
  }
  state.userId = `00000000-0000-0000-0000-00000000000${role.length}`;
  state.profile = { id: state.userId, full_name: "Persona Ficticia", email: "ficticia@ejemplo.test", role, is_active: options.active ?? true };
}

const vacancyInput: VacancyFormInput = {
  title: "Analista",
  department: "Finanzas",
  description: "",
  responsibilities: "",
  location: "",
  modality: "",
  contractType: "",
  openingDate: "",
  closingDate: "",
  ownerId: "",
  city: "",
  region: "",
  employmentType: "",
  salaryMin: "",
  salaryMax: "",
  salaryCurrency: "",
  salaryPeriod: "",
  isConfidential: false,
};

const noticeInput = { title: "Aviso", body: "Texto del aviso." };
const activationInput = { approvalReference: "Acta ficticia", confirmed: true as const };

function resumeForm() {
  const form = new FormData();
  form.set("candidateId", ID);
  form.set("file", new File([new Uint8Array([37, 80, 68, 70])], "cv.pdf", { type: "application/pdf" }));
  return form;
}

beforeEach(() => {
  state.calls = [];
  state.adminClientCreated = false;
  state.allowAdmin = false;
  state.visibleResume = false;
  state.evaluationApplicationId = null;
});

describe("cuenta desactivada: ninguna acción llega a la base de datos", () => {
  beforeEach(() => signInAs("rrhh", { active: false }));

  const forbidden = { ok: false, error: "Su cuenta está desactivada." };

  it.each([
    ["crear vacante", () => createVacancy(vacancyInput)],
    ["aprobar criterios", () => approveCriteria(ID)],
    ["agregar requisito", () => addRequirement(ID, { category: "otro", priority: "deseable", description: "X", keywords: "", weight: 1, minYears: "", isEssential: false })],
    ["eliminar vacante", () => deleteDraftVacancy(ID)],
    ["registrar candidato", () => createCandidate({ fullName: "Persona", email: "", phone: "", location: "", linkedinUrl: "", source: "manual", sourceDetail: "", vacancyId: "" })],
    ["verificar datos", () => verifyCandidateField(ID, "email")],
    ["subir CV", () => uploadResume(resumeForm())],
    ["ejecutar evaluación", () => runEvaluation(ID, "reglas")],
    ["revisar evaluación", () => reviewEvaluation(ID, { evaluationId: ID, outcome: "conforme", notes: "" })],
    ["cambiar estado", () => changeApplicationStatus({ applicationId: ID, status: "seleccionado", reason: "", note: "" })],
    ["pedir opinión", () => requestOpinion(ID, ID)],
    ["invitar usuarios", () => inviteUser({ email: "nuevo@ejemplo.test", fullName: "Nuevo", role: "admin" })],
    ["cambiar roles", () => updateUser({ userId: ID, role: "admin" })],
    ["eliminar usuarios", () => deleteUser(ID)],
    ["registrar observación", () => addApplicationNote({ applicationId: ID, note: "Buen dominio técnico" })],
    ["crear aviso de privacidad", () => createNotice(noticeInput)],
    ["activar aviso de privacidad", () => activateNotice(ID, activationInput)],
    ["registrar revocación", () => revokeConsent(ID, ID)],
  ])("%s", async (_, action) => {
    expect(await action()).toEqual(forbidden);
    expect(state.calls).toEqual([]);
    expect(state.adminClientCreated).toBe(false);
  });
});

describe("RRHH", () => {
  beforeEach(() => signInAs("rrhh"));

  it("no puede gestionar usuarios ni usar la clave secreta", async () => {
    expect((await inviteUser({ email: "x@ejemplo.test", fullName: "X", role: "rrhh" })).ok).toBe(false);
    expect((await updateUser({ userId: ID, isActive: false })).ok).toBe(false);
    expect((await deleteUser(ID)).ok).toBe(false);
    expect(state.adminClientCreated).toBe(false);
  });

  it("no elimina vacantes (solo administración) y sí registra observaciones", async () => {
    expect(await deleteDraftVacancy(ID)).toEqual({ ok: false, error: "No tiene permisos para realizar esta acción." });
    expect(state.calls).toEqual([]);
    const result = await addApplicationNote({ applicationId: ID, note: "Buen dominio técnico" });
    expect(result.ok).toBe(true);
    expect(state.calls).toEqual(["insert:application_events"]);
  });

  it("las entradas inválidas se rechazan antes de llegar a la base de datos", async () => {
    const result = await createVacancy({ ...vacancyInput, title: "x", openingDate: "2026-10-10", closingDate: "2026-01-01" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors?.title).toBeDefined();
      expect(result.fieldErrors?.closingDate).toBeDefined();
    }
    expect(state.calls).toEqual([]);

    const badId = await approveCriteria("1; drop table vacancies");
    expect(badId.ok).toBe(false);
    expect(state.calls).toEqual([]);
  });

  it("no revisa una evaluación usando el identificador de otra postulación", async () => {
    state.evaluationApplicationId = "11111111-1111-4111-8111-111111111111";
    const result = await reviewEvaluation(ID, { evaluationId: ID, outcome: "conforme", notes: "" });
    expect(result).toEqual({ ok: false, error: "La evaluación no corresponde a la postulación." });
    expect(state.calls).not.toContain("rpc:review_evaluation");
  });

  it("no puede descartar el motivo de un 'no seleccionado'", async () => {
    const result = await changeApplicationStatus({ applicationId: ID, status: "no_seleccionado", reason: "", note: "" });
    expect(result.ok).toBe(false);
    expect(state.calls).toEqual([]);
  });

  it("un archivo inválido no llega al almacenamiento", async () => {
    const form = new FormData();
    form.set("candidateId", ID);
    form.set("file", new File(["<script>alert(1)</script>"], "cv.pdf", { type: "application/pdf" }));
    const result = await uploadResume(form);
    expect(result).toEqual({ ok: false, error: "El archivo no es un PDF válido." });
    expect(state.calls).toEqual(["rpc:consume_rate_limit"]);
  });
});

describe("avisos de privacidad: solo administración", () => {
  const forbidden = { ok: false, error: "No tiene permisos para realizar esta acción." };

  it("RRHH no crea, edita, activa ni elimina avisos y nada llega a la base de datos", async () => {
    signInAs("rrhh");
    expect(await createNotice(noticeInput)).toEqual(forbidden);
    expect(await updateNotice(ID, noticeInput)).toEqual(forbidden);
    expect(await activateNotice(ID, activationInput)).toEqual(forbidden);
    expect(await deleteNotice(ID)).toEqual(forbidden);
    expect(state.calls).toEqual([]);
    expect(state.adminClientCreated).toBe(false);
  });

  it("sin sesión tampoco", async () => {
    signInAs(null);
    expect((await createNotice(noticeInput)).ok).toBe(false);
    expect((await activateNotice(ID, activationInput)).ok).toBe(false);
    expect(state.calls).toEqual([]);
  });

  it("administración sí llega a la base de datos", async () => {
    signInAs("admin");
    await createNotice(noticeInput);
    await updateNotice(ID, noticeInput);
    await deleteNotice(ID);
    const activation = await activateNotice(ID, activationInput);
    expect(activation.ok).toBe(true);
    expect(state.calls).toEqual([
      "insert:privacy_notices",
      "update:privacy_notices",
      "delete:privacy_notices",
      "rpc:activate_privacy_notice",
    ]);
  });

  it("activar exige referencia y la confirmación del área legal antes de llamar a la base de datos", async () => {
    signInAs("admin");
    const noReference = await activateNotice(ID, { approvalReference: "  ", confirmed: true });
    expect(noReference.ok).toBe(false);
    const unconfirmed = await activateNotice(ID, { approvalReference: "Acta ficticia", confirmed: false as unknown as true });
    expect(unconfirmed.ok).toBe(false);
    expect(state.calls).toEqual([]);
  });

  it("RRHH sí registra la revocación de la cartera (personal)", async () => {
    signInAs("rrhh");
    expect((await revokeConsent(ID, ID)).ok).toBe(true);
    expect(state.calls).toEqual(["rpc:revoke_consent"]);
  });
});

describe("sesión", () => {
  it("sin sesión, las acciones informan sesión expirada y no tocan datos", async () => {
    signInAs(null);
    expect(await createVacancy(vacancyInput)).toEqual({ ok: false, error: "Su sesión expiró. Vuelva a iniciar sesión." });
    expect(state.calls).toEqual([]);
  });

  it("una cuenta desactivada no puede operar aunque conserve un token válido", async () => {
    signInAs("admin", { active: false });
    expect(await inviteUser({ email: "x@ejemplo.test", fullName: "X", role: "rrhh" })).toEqual({
      ok: false,
      error: "Su cuenta está desactivada.",
    });
    expect(state.calls).toEqual([]);
  });
});

describe("descarga de CV", () => {
  const request = {} as Parameters<typeof downloadResume>[0];
  const context = { params: Promise.resolve({ id: ID }) };

  it("sin sesión responde 401 y no genera URL firmada", async () => {
    signInAs(null);
    const response = await downloadResume(request, context);
    expect(response.status).toBe(401);
    expect(state.calls).not.toContain("storage:signed_url");
  });

  it("si el CV no es visible para el usuario (RLS) responde 404 sin auditar ni firmar", async () => {
    signInAs("rrhh");
    const response = await downloadResume(request, context);
    expect(response.status).toBe(404);
    expect(state.calls).toEqual(["rpc:consume_rate_limit"]);
    expect(state.adminClientCreated).toBe(false);
  });

  it("con acceso: límite, auditoría y solo después URL firmada de 60 s", async () => {
    signInAs("rrhh");
    state.visibleResume = true;
    state.allowAdmin = true;
    const response = await downloadResume(request, context);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://ejemplo.test/firmada");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(state.calls).toEqual(["rpc:consume_rate_limit", "rpc:log_resume_download", "admin:signed_url:60"]);
  });

  it("rechaza identificadores inválidos", async () => {
    signInAs("rrhh");
    const response = await downloadResume(request, { params: Promise.resolve({ id: "../../etc/passwd" }) });
    expect(response.status).toBe(400);
    expect(state.calls).toEqual([]);
  });
});

describe("cuentas desactivadas con sesión vigente", () => {
  const request = () => new NextRequest("http://localhost:3000/auth/cuenta-desactivada");

  it("cierra la sesión y redirige al ingreso con el motivo (evita bucles de redirección)", async () => {
    signInAs("rrhh", { active: false });
    const response = await inactiveAccount(request());
    expect(state.calls).toEqual(["auth:signOut"]);
    expect(response.headers.get("location")).toBe("http://localhost:3000/ingresar?motivo=cuenta-desactivada");
  });

  it("no cierra la sesión de una cuenta activa (no permite cierres forzados)", async () => {
    signInAs("rrhh");
    const response = await inactiveAccount(request());
    expect(state.calls).toEqual([]);
    expect(response.headers.get("location")).toBe("http://localhost:3000/panel");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { makePdf } from "../fixtures/documents";

/**
 * Carga masiva: el servidor mueve el archivo a su ruta definitiva ANTES de
 * llamar a register_batch_item y compensa según el estado real del ítem si la
 * función falla. También se comprueba la autorización de cada acción y que el
 * lote no aplique el límite de evaluación.
 */

type Profile = { id: string; full_name: string; email: string; role: "admin" | "rrhh"; is_active: boolean };

const BATCH = "2b1c1f8e-6a0b-4f53-9a1c-3c5f0f6f1a10";
const VACANCY = "3c2d2a9f-7b1c-4a64-8b2d-4d6a1a7a2b21";
const ITEM_ID = "4d3e3b0a-8c2d-4b75-9c3e-5e7b2b8b3c32";
const ITEM_B = "5e4f4c1b-9d3e-4c86-8d4f-6f8c3c9c4d43";

const state = vi.hoisted(() => ({
  userId: null as string | null,
  profile: null as Profile | null,
  calls: [] as string[],
  moves: [] as [string, string][],
  removed: [] as string[],
  uploaded: [] as string[],
  moveFailsFor: new Set<string>(),
  adminClientCreated: false,
  criteriaApproved: false,
  items: [] as { id: string; status: string; original_filename: string; storage_path: string | null }[],
  registerErrors: new Set<string>(),
  /** Estado real del ítem tras un error de register_batch_item (null: ya no existe). */
  itemLookup: { status: "listo" } as { status: string } | null,
  /** Ítem que devuelve la consulta de descarte. */
  discardItem: null as { id: string; status: string; storage_path: string | null } | null,
  closePaths: [] as string[],
  insertFails: false,
}));

const evaluate = vi.hoisted(() => vi.fn());

function createQuery(table: string) {
  const result = { data: [] as unknown[], error: null as unknown, count: 0 };
  const query: Record<string, unknown> = {};
  let columns = "";
  let inserted: Record<string, unknown> = {};
  const chain = () => query;
  for (const method of ["eq", "neq", "in", "is", "order", "range", "limit"]) query[method] = chain;
  query.select = (cols: string) => {
    columns = cols;
    return query;
  };
  query.insert = (row: Record<string, unknown>) => {
    state.calls.push(`insert:${table}`);
    inserted = row;
    return query;
  };
  for (const method of ["update", "delete"]) {
    query[method] = () => {
      state.calls.push(`${method}:${table}`);
      return query;
    };
  }
  query.maybeSingle = async () => {
    let data: unknown = null;
    if (table === "profiles") data = state.profile;
    else if (table === "intake_batches") {
      data = {
        id: BATCH,
        status: "abierto",
        vacancy_id: VACANCY,
        vacancies: { criteria_approved_at: state.criteriaApproved ? "2026-10-01" : null },
      };
    } else if (table === "intake_batch_items" && columns === "status") data = state.itemLookup;
    else if (table === "intake_batch_items" && columns === "id, status, storage_path") data = state.discardItem;
    return { data, error: null };
  };
  query.single = async () => {
    if (table === "intake_batch_items" && state.insertFails) {
      return { data: null, error: { code: "RH409", message: "El lote está cerrado" } };
    }
    return {
      data: {
        id: (inserted.id as string | undefined) ?? ITEM_ID,
        status: inserted.status === "error" ? "error" : "listo",
      },
      error: null,
    };
  };
  query.then = (resolve: (value: unknown) => unknown) =>
    resolve(
      table === "intake_batch_items"
        ? { ...result, data: state.items }
        : table === "intake_batches"
          ? { ...result, data: [{ id: BATCH }] }
          : result,
    );
  return query;
}

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getClaims: async () => ({ data: state.userId ? { claims: { sub: state.userId } } : null, error: null }),
    },
    from: (table: string) => createQuery(table),
    rpc: async (name: string, args: Record<string, string>) => {
      state.calls.push(`rpc:${name}`);
      if (name === "register_batch_item") {
        if (state.registerErrors.has(args.p_item_id!)) {
          return { data: null, error: { code: "RH409", message: "El archivo ya fue registrado" } };
        }
        return { data: `app-${args.p_item_id}`, error: null };
      }
      if (name === "close_intake_batch") return { data: state.closePaths, error: null };
      return { data: true, error: null };
    },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => {
    state.adminClientCreated = true;
    return {
      storage: {
        from: () => ({
          upload: async (path: string) => {
            state.calls.push("storage:upload");
            state.uploaded.push(path);
            return { error: null };
          },
          remove: async (paths: string[]) => {
            state.calls.push(`storage:remove:${paths.length}`);
            state.removed.push(...paths);
            return { error: null };
          },
          move: async (from: string, to: string) => {
            state.moves.push([from, to]);
            return { error: state.moveFailsFor.has(from) ? { message: "fallo" } : null };
          },
        }),
      },
    };
  },
}));

vi.mock("@/modules/evaluation/service", () => ({ evaluateApplication: evaluate }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
  unstable_rethrow: vi.fn(),
}));

const { startBatch, uploadBatchItem, updateBatchItem, registerBatchItems, discardBatchItem, closeBatch } = await import(
  "@/modules/intake/actions"
);

function signInAs(role: Profile["role"] | null, options: { active?: boolean } = {}) {
  if (!role) {
    state.userId = null;
    state.profile = null;
    return;
  }
  state.userId = "00000000-0000-0000-0000-000000000001";
  state.profile = {
    id: state.userId,
    full_name: "Persona Ficticia",
    email: "ficticia@ejemplo.test",
    role,
    is_active: options.active ?? true,
  };
}

beforeEach(() => {
  state.calls = [];
  state.moves = [];
  state.removed = [];
  state.uploaded = [];
  state.moveFailsFor = new Set();
  state.adminClientCreated = false;
  state.criteriaApproved = false;
  state.items = [];
  state.registerErrors = new Set();
  state.itemLookup = { status: "listo" };
  state.discardItem = null;
  state.closePaths = [];
  state.insertFails = false;
  evaluate.mockReset();
  evaluate.mockResolvedValue("evaluation-id");
});

const fileForm = (name: string, content: BlobPart) => {
  const form = new FormData();
  form.set("batchId", BATCH);
  form.set("file", new File([content], name, { type: "application/pdf" }));
  return form;
};

const actions: [string, () => Promise<unknown>][] = [
  ["abrir lote", () => startBatch({ vacancyId: VACANCY, portalId: ITEM_ID })],
  ["subir archivo", () => uploadBatchItem(fileForm("cv.pdf", "x"))],
  ["corregir datos", () => updateBatchItem({ itemId: ITEM_ID, fullName: "Ana Ruiz", email: "", phone: "" })],
  ["registrar", () => registerBatchItems(BATCH, [ITEM_ID])],
  ["descartar", () => discardBatchItem(ITEM_ID)],
  ["cerrar lote", () => closeBatch(BATCH)],
];

describe("autorización de cada acción", () => {
  it.each(actions)("sin sesión: %s no toca datos ni Storage", async (_, action) => {
    signInAs(null);
    expect(await action()).toEqual({ ok: false, error: "Su sesión expiró. Vuelva a iniciar sesión." });
    expect(state.calls).toEqual([]);
    expect(state.adminClientCreated).toBe(false);
  });

  it.each(actions)("cuenta desactivada: %s no toca datos ni Storage", async (_, action) => {
    signInAs("rrhh", { active: false });
    expect(await action()).toEqual({ ok: false, error: "Su cuenta está desactivada." });
    expect(state.calls).toEqual([]);
    expect(state.adminClientCreated).toBe(false);
  });

  it.each(actions)("sin el permiso candidates:manage: %s es rechazada", async (_, action) => {
    signInAs("rrhh");
    // Un rol que la matriz de permisos no conoce no obtiene ningún permiso.
    state.profile = { ...state.profile!, role: "otro" as never };
    expect(await action()).toEqual({ ok: false, error: "No tiene permisos para realizar esta acción." });
    expect(state.calls).toEqual([]);
    expect(state.adminClientCreated).toBe(false);
  });

  it("las entradas inválidas se rechazan antes de llegar a la base de datos", async () => {
    signInAs("rrhh");
    expect((await registerBatchItems("no-es-uuid", [ITEM_ID])).ok).toBe(false);
    expect((await registerBatchItems(BATCH, [])).ok).toBe(false);
    expect((await discardBatchItem("1; drop table")).ok).toBe(false);
    expect((await updateBatchItem({ itemId: ITEM_ID, fullName: "A", email: "sin-arroba", phone: "" })).ok).toBe(false);
    expect(state.calls).toEqual([]);
  });
});

describe("subida de archivos", () => {
  beforeEach(() => signInAs("rrhh"));

  it("un archivo inválido crea un ítem con error, sin archivo en Storage", async () => {
    const result = await uploadBatchItem(fileForm("cv.pdf", "<script>alert(1)</script>"));
    expect(result).toMatchObject({
      ok: true,
      data: { itemId: ITEM_ID, status: "error", message: "El archivo no es un PDF válido." },
    });
    expect(state.calls).toEqual(["rpc:consume_rate_limit", "insert:intake_batch_items"]);
    expect(state.adminClientCreated).toBe(false);
  });

  it("camino feliz: valida, sube a la ruta temporal y solo después inserta el ítem", async () => {
    const pdf = await makePdf([
      "Lucia Fernanda Ramos",
      "Analista de datos con experiencia en SQL Server, reportes y modelado de datos.",
      "Formación en ingeniería industrial y manejo de herramientas de análisis.",
    ]);
    const result = await uploadBatchItem(fileForm("lucia.pdf", pdf as BlobPart));
    expect(result).toMatchObject({ ok: true, data: { status: "listo" } });
    expect(state.uploaded[0]).toContain(`/${(result as { data: { itemId: string } }).data.itemId}.pdf`);
    expect(state.calls).toEqual(["rpc:consume_rate_limit", "storage:upload", "insert:intake_batch_items"]);
    expect(state.uploaded).toHaveLength(1);
    expect(state.uploaded[0]).toMatch(new RegExp(`^intake/${BATCH}/[0-9a-f-]{36}\\.pdf$`));
    expect(state.removed).toEqual([]);
  });

  it("si falla el insert del ítem, borra el archivo recién subido", async () => {
    state.insertFails = true;
    const pdf = await makePdf(["Lucia Fernanda Ramos", "Analista de datos con experiencia en SQL Server y reportes de gestión para el área comercial."]);
    const result = await uploadBatchItem(fileForm("lucia.pdf", pdf as BlobPart));
    expect(result.ok).toBe(false);
    expect(state.calls).toEqual(["rpc:consume_rate_limit", "storage:upload", "insert:intake_batch_items", "storage:remove:1"]);
    expect(state.removed).toEqual(state.uploaded);
  });
});

describe("registro del lote", () => {
  beforeEach(() => {
    signInAs("rrhh");
    state.items = [
      { id: ITEM_ID, status: "listo", original_filename: "ana.pdf", storage_path: `intake/${BATCH}/${ITEM_ID}.pdf` },
      { id: ITEM_B, status: "listo", original_filename: "beto.docx", storage_path: `intake/${BATCH}/${ITEM_B}.docx` },
    ];
  });

  it("mueve el archivo a candidates/… antes de registrar y no aplica el límite de evaluación", async () => {
    const result = await registerBatchItems(BATCH, [ITEM_ID]);
    expect(result).toMatchObject({ ok: true, data: { registered: 1, evaluated: 0, notEvaluated: 0, errors: [] } });
    expect(state.moves).toHaveLength(1);
    expect(state.moves[0]![0]).toBe(`intake/${BATCH}/${ITEM_ID}.pdf`);
    expect(state.moves[0]![1]).toMatch(/^candidates\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.pdf$/);
    expect(state.calls).toEqual(["rpc:register_batch_item"]);
    expect(evaluate).not.toHaveBeenCalled();
  });

  it("si el registro falla, el archivo vuelve a la ruta temporal y el resto del lote sigue", async () => {
    state.registerErrors.add(ITEM_B);
    const result = await registerBatchItems(BATCH, [ITEM_ID, ITEM_B]);
    expect(result).toMatchObject({
      ok: true,
      data: { registered: 1, errors: [{ itemId: ITEM_B, filename: "beto.docx", message: "El archivo ya fue registrado" }] },
    });
    const temporary = `intake/${BATCH}/${ITEM_B}.docx`;
    const forward = state.moves.find(([from]) => from === temporary)!;
    expect(forward[1]).toMatch(/^candidates\/.+\.docx$/);
    expect(state.moves).toContainEqual([forward[1], temporary]);
    expect(state.moves.filter(([, to]) => to === `intake/${BATCH}/${ITEM_ID}.pdf`)).toEqual([]);
    expect(state.removed).toEqual([]);
  });

  it("si el error llega con el ítem ya registrado (respuesta perdida tras el commit), el archivo no se mueve", async () => {
    state.registerErrors.add(ITEM_ID);
    state.itemLookup = { status: "registrado" };
    await registerBatchItems(BATCH, [ITEM_ID]);
    // Solo el movimiento de ida: no se devuelve ni se borra.
    expect(state.moves).toHaveLength(1);
    expect(state.moves[0]![0]).toBe(`intake/${BATCH}/${ITEM_ID}.pdf`);
    expect(state.removed).toEqual([]);
  });

  it("si el ítem ya no existe (lote cerrado), borra el archivo de la ruta definitiva en vez de devolverlo", async () => {
    state.registerErrors.add(ITEM_ID);
    state.itemLookup = null;
    await registerBatchItems(BATCH, [ITEM_ID]);
    expect(state.moves).toHaveLength(1);
    expect(state.removed).toEqual([state.moves[0]![1]]);
    expect(state.removed[0]).toMatch(/^candidates\//);
  });

  it("si no se puede mover el archivo no se llama a la función de base de datos", async () => {
    state.moveFailsFor.add(`intake/${BATCH}/${ITEM_ID}.pdf`);
    const result = await registerBatchItems(BATCH, [ITEM_ID]);
    expect(result).toMatchObject({ ok: true, data: { registered: 0, errors: [{ itemId: ITEM_ID }] } });
    expect(state.calls).not.toContain("rpc:register_batch_item");
  });

  it("no registra ítems sin nombre o ya registrados", async () => {
    state.items = [
      { id: ITEM_ID, status: "requiere_datos", original_filename: "a.pdf", storage_path: "intake/x/a.pdf" },
      { id: ITEM_B, status: "registrado", original_filename: "b.pdf", storage_path: null },
    ];
    const result = await registerBatchItems(BATCH, [ITEM_ID, ITEM_B]);
    expect(result).toMatchObject({ ok: true, data: { registered: 0 } });
    expect(state.moves).toEqual([]);
    expect(state.calls).toEqual([]);
  });

  it("con criterios aprobados evalúa por reglas; un fallo de evaluación no deshace el registro", async () => {
    state.criteriaApproved = true;
    evaluate.mockImplementation(async (_supabase: unknown, applicationId: string) => {
      if (applicationId === `app-${ITEM_B}`) throw new Error("falló");
      return "evaluation-id";
    });
    const result = await registerBatchItems(BATCH, [ITEM_ID, ITEM_B]);
    expect(result).toMatchObject({ ok: true, data: { registered: 2, evaluated: 1, notEvaluated: 1, errors: [] } });
    expect(evaluate).toHaveBeenCalledWith(expect.anything(), `app-${ITEM_ID}`, "reglas");
    expect(state.calls).not.toContain("rpc:consume_rate_limit");
  });
});

describe("descartar y cerrar", () => {
  beforeEach(() => signInAs("rrhh"));

  it("descartar borra el archivo y después el ítem", async () => {
    const path = `intake/${BATCH}/${ITEM_ID}.pdf`;
    state.discardItem = { id: ITEM_ID, status: "listo", storage_path: path };
    const result = await discardBatchItem(ITEM_ID);
    expect(result.ok).toBe(true);
    expect(state.removed).toEqual([path]);
    expect(state.calls).toEqual(["storage:remove:1", "delete:intake_batch_items"]);
  });

  it("no descarta un ítem ya registrado", async () => {
    state.discardItem = { id: ITEM_ID, status: "registrado", storage_path: null };
    expect((await discardBatchItem(ITEM_ID)).ok).toBe(false);
    expect(state.calls).toEqual([]);
  });

  it("cerrar el lote usa la función de base de datos y borra los archivos que ella devuelve", async () => {
    const path = `intake/${BATCH}/${ITEM_ID}.pdf`;
    state.closePaths = [path];
    const result = await closeBatch(BATCH);
    expect(result.ok).toBe(true);
    expect(state.calls).toEqual(["rpc:close_intake_batch", "storage:remove:1"]);
    expect(state.removed).toEqual([path]);
    // Sin UPDATE ni DELETE directos sobre el lote o sus ítems.
    expect(state.calls.some((call) => call.startsWith("update:") || call.startsWith("delete:"))).toBe(false);
  });
});

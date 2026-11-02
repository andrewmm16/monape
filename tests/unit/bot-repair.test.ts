import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_REPAIR_MODEL, loadConfig, loadRepairConfig } from "../../bot/src/config";
import { FileIncidentStore, type Incident } from "../../bot/src/incidents";
import { BotControl } from "../../bot/src/notify/control";
import { createIncomingHandler, incidentMessage } from "../../bot/src/notify/incoming";
import { createRepairFromConfig, createRepairService, proposalMessage } from "../../bot/src/repair";
import { askModel, createAnthropicComplete, type Complete, type CompleteResult } from "../../bot/src/repair/client";
import { buildPrompt } from "../../bot/src/repair/prompt";
import { ProposalStore, validateProposal } from "../../bot/src/repair/proposals";
import { configureSelectorState, estricto, getOverride, registerBook, resetSelectorState, setOverride, tolerante } from "../../bot/src/selectors";

// Nunca se llama a la API real: el SDK está simulado y los demás casos usan un `complete` falso.
const sdk = vi.hoisted(() => ({ options: [] as unknown[], create: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class FakeAnthropic {
    messages = { create: sdk.create };
    constructor(options?: unknown) {
      sdk.options.push(options);
    }
  },
}));

const PORTAL = "t-portal";
registerBook(PORTAL, {
  campo_titulo: tolerante("Campo del título del puesto", "#titulo", [{ etiqueta: ["Título", "Cargo"] }]),
  boton_enviar: estricto("Botón de publicar", "#publicar"),
  marca_paso: estricto("Marca del paso {n}", "#paso-{n}"),
});

let dir: string;
let clock: number;
const now = () => new Date(clock);
const logs: string[] = [];
const sent: string[] = [];

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "reparacion-"));
  configureSelectorState({ overridesFile: path.join(dir, "selectores.json"), tolerancesFile: path.join(dir, "tolerancias.json") });
  clock = Date.parse("2026-03-02T10:00:00Z");
  logs.length = 0;
  sent.length = 0;
  sdk.options.length = 0;
  sdk.create.mockReset();
});
afterEach(async () => {
  resetSelectorState();
  await rm(dir, { recursive: true, force: true });
});

const STRUCTURE = '{"url":"http://x/empleos/nuevo","fields":[{"tag":"input","type":"text","name":"titulo_v2","id":"titulo-v2","label":"Título del puesto","required":false}],"buttons":[{"id":"","text":"Publicar","type":"submit"}]}';

const incident = (over: Partial<Incident> = {}): Incident => ({
  id: 1,
  createdAt: "2026-03-02T09:59:00.000Z",
  lastSeenAt: "2026-03-02T09:59:00.000Z",
  occurrences: 1,
  portal: PORTAL,
  step: "prueba_estructura",
  errorCode: "pagina_cambio",
  message: "falta «Campo del título del puesto» [campo_titulo]",
  reparable: true,
  structure: STRUCTURE,
  status: "abierto",
  ...over,
});

const answer = (over: Record<string, unknown> = {}): CompleteResult => ({
  text: JSON.stringify({ sin_propuesta: false, clave: "campo_titulo", selector: "#titulo-v2", confianza: "alta", razon: "El campo cambió de id.", ...over }),
  stopReason: "end_turn",
  tokensEntrada: 321,
  tokensSalida: 45,
});

const PASS = { resultado: "paso", mensaje: "la prueba de estructura pasó con el selector en ensayo" } as const;

function setup(result: CompleteResult | (() => Promise<CompleteResult>) = answer(), extra: { maxPerDay?: number; verifyMinutes?: number } = {}) {
  const complete = vi.fn<Complete>(async () => (typeof result === "function" ? result() : result));
  const store = new ProposalStore(path.join(dir, "propuestas"), now);
  const onApplied = vi.fn();
  const repair = createRepairService({
    complete,
    model: DEFAULT_REPAIR_MODEL,
    maxPerDay: extra.maxPerDay ?? 10,
    verifyMinutes: extra.verifyMinutes ?? 30,
    maxAttempts: 3,
    rehearse: async () => PASS,
    store,
    notify: async (text) => void sent.push(text),
    log: (message) => void logs.push(message),
    now,
    onApplied,
  });
  return { complete, store, repair, onApplied };
}

describe("cliente (SDK simulado, sin llamadas reales)", () => {
  it("envía solo lo permitido para claude-sonnet-5-5: sin temperature/top_p/top_k/thinking/tool_choice/prefill", async () => {
    sdk.create.mockResolvedValue({ content: [{ type: "text", text: '{"a":1}' }], stop_reason: "end_turn", usage: { input_tokens: 11, output_tokens: 5 } });
    const complete = createAnthropicComplete();
    expect(sdk.options).toHaveLength(0); // el cliente se crea al primer uso
    const result = await complete({ model: "claude-sonnet-5-5", system: "sistema", prompt: "consulta" });
    expect(result).toEqual({ text: '{"a":1}', stopReason: "end_turn", tokensEntrada: 11, tokensSalida: 5 });
    expect(sdk.options).toEqual([{ timeout: 30_000, maxRetries: 1 }]);

    const params = sdk.create.mock.calls[0]![0] as Record<string, unknown>;
    expect(params).toMatchObject({
      model: "claude-sonnet-5-5",
      max_tokens: 2000,
      system: "sistema",
      output_config: { effort: "low", format: { type: "json_schema", schema: expect.objectContaining({ type: "object", additionalProperties: false }) } },
    });
    for (const forbidden of ["temperature", "top_p", "top_k", "thinking", "tool_choice", "tools"]) expect(params, forbidden).not.toHaveProperty(forbidden);
    const messages = params.messages as { role: string }[];
    expect(messages).toEqual([{ role: "user", content: "consulta" }]); // termina en turno de usuario: sin prefill
  });

  it("refusal y max_tokens no dan propuesta; un JSON roto o fuera de formato tampoco", async () => {
    const ask = (r: Partial<CompleteResult>) => askModel(async () => ({ ...answer(), ...r }), { model: "m", system: "s", prompt: "p" });
    expect(await ask({ stopReason: "refusal" })).toMatchObject({ ok: false, motivo: expect.stringContaining("refusal"), tokensEntrada: 321 });
    expect(await ask({ stopReason: "max_tokens" })).toMatchObject({ ok: false, motivo: expect.stringContaining("max_tokens") });
    expect(await ask({ text: null })).toMatchObject({ ok: false });
    expect(await ask({ text: "no es json" })).toMatchObject({ ok: false });
    expect(await ask({ text: JSON.stringify({ clave: "x" }) })).toMatchObject({ ok: false, motivo: expect.stringContaining("formato") });
    expect(await ask({ text: JSON.stringify({ sin_propuesta: false, clave: "a", selector: "b", confianza: "segura", razon: "c" }) })).toMatchObject({ ok: false });
    expect(await ask({})).toMatchObject({ ok: true, respuesta: { clave: "campo_titulo", selector: "#titulo-v2", confianza: "alta" }, tokensSalida: 45 });
  });
});

describe("prompt", () => {
  it("lleva portal, paso, código, mensaje saneado, esquema y el libro con sus selectores actuales, y nada más", () => {
    setOverride(PORTAL, "campo_titulo", { selector: "#titulo-nuevo", aprobadoEn: "2026-03-01T00:00:00Z", incidenteId: 9 });
    const leaky = { ...incident(), applicants: ["Lucía Ramos Ficticia"], cv: "Experiencia secreta" };
    const { system, prompt } = buildPrompt({ incident: leaky });
    for (const part of ["Portal: t-portal", "prueba_estructura", "pagina_cambio", "[campo_titulo]", "titulo_v2", "campo_titulo: Campo del título del puesto", "Selector actual: #titulo-nuevo", "boton_enviar: Botón de publicar [estricta"]) {
      expect(prompt).toContain(part);
    }
    expect(prompt).not.toContain("Lucía");
    expect(prompt).not.toContain("secreta");
    expect(system).toContain("PROPUESTA");
    expect(system).toContain("No inventes claves");
    expect(system).toContain("sin_propuesta");
  });
});

describe("validación de la propuesta", () => {
  const ok = { sin_propuesta: false, clave: "campo_titulo", selector: "#titulo-v2", confianza: "alta" as const, razon: "r" };

  it("acepta una clave del libro con un selector razonable", () => {
    expect(validateProposal(PORTAL, ok)).toEqual({ ok: true, clave: "campo_titulo", selector: "#titulo-v2" });
    expect(validateProposal(PORTAL, { ...ok, clave: "boton_enviar", selector: "button.publicar > span" })).toMatchObject({ ok: true }); // las estrictas también, las aprueba una persona
  });

  it("descarta claves inventadas, «sin propuesta» y portales sin libro", () => {
    expect(validateProposal(PORTAL, { ...ok, clave: "campo_inventado" })).toMatchObject({ ok: false, motivo: expect.stringContaining("no existe en el libro") });
    expect(validateProposal(PORTAL, { ...ok, clave: "constructor" })).toMatchObject({ ok: false });
    expect(validateProposal(PORTAL, { ...ok, sin_propuesta: true })).toMatchObject({ ok: false });
    expect(validateProposal("otro-portal", ok)).toMatchObject({ ok: false });
    expect(validateProposal(PORTAL, { ...ok, clave: "marca_paso", selector: "#paso-uno" })).toMatchObject({ ok: false, motivo: expect.stringContaining("parametrizada") });
  });

  it.each([
    ["punto y coma", "#a; b"],
    ["llave", "#a{color:red}"],
    ["menor que", "<script>"],
    ["javascript:", "a[href='javascript:alert(1)']"],
    ["salto de línea", "#a\n#b"],
    ["muy largo", `#${"a".repeat(200)}`],
    ["vacío", "   "],
    ["igual al vigente", "#titulo"],
  ])("descarta un selector peligroso o inútil: %s", (_name, selector) => {
    expect(validateProposal(PORTAL, { ...ok, selector })).toMatchObject({ ok: false });
  });
});

describe("servicio: pedir la propuesta", () => {
  it("propuesta válida: se guarda con todos sus campos y se avisa con el texto exacto", async () => {
    const { repair, complete, store } = setup();
    await repair.handleNewIncident(incident());

    expect(complete).toHaveBeenCalledTimes(1);
    const request = complete.mock.calls[0]![0];
    expect(request.model).toBe("claude-sonnet-5-5");
    expect(request.prompt).toContain("campo_titulo");

    const saved = JSON.parse(await readFile(path.join(dir, "propuestas", "0001.json"), "utf8"));
    expect(saved).toEqual({
      incidenteId: 1,
      portal: PORTAL,
      clave: "campo_titulo",
      selector: "#titulo-v2",
      confianza: "alta",
      razon: "El campo cambió de id.",
      modelo: "claude-sonnet-5-5",
      tokensEntrada: 321,
      tokensSalida: 45,
      creadaEn: "2026-03-02T10:00:00.000Z",
      estado: "propuesta",
      probada: true,
      intentos: 1,
      ensayo: { resultado: "paso", mensaje: PASS.mensaje, en: "2026-03-02T10:00:00.000Z" },
    });
    expect(await store.get(1)).toMatchObject({ estado: "propuesta" });
    expect(sent).toEqual([
      "Propuesta PROBADA para #1: usar «#titulo-v2» como campo_titulo; la prueba de estructura pasó con este cambio. Responda «sí 1» para aplicarla o «no 1» para rechazarla.",
    ]);
    expect(sent[0]).toBe(proposalMessage(saved));
  });

  it("clave inventada, selector peligroso, «sin propuesta», refusal y max_tokens: nada guardado ni avisado, solo log", async () => {
    const cases: CompleteResult[] = [
      answer({ clave: "campo_que_no_existe" }),
      answer({ selector: "#a; drop" }),
      answer({ sin_propuesta: true, clave: "", selector: "" }),
      { ...answer(), stopReason: "refusal" },
      { ...answer(), stopReason: "max_tokens" },
    ];
    for (const result of cases) {
      const { repair } = setup(result);
      await repair.handleNewIncident(incident());
    }
    expect(await readdir(path.join(dir, "propuestas")).then((names) => names.filter((n) => /^\d+\.json$/.test(n)))).toEqual([]);
    expect(sent).toEqual([]);
    expect(logs).toHaveLength(5);
    expect(logs.join("\n")).toContain("descartada");
    expect(logs.join("\n")).toContain("refusal");
  });

  it("no consulta si el incidente no es reparable o no trae esquema", async () => {
    const { repair, complete } = setup();
    await repair.handleNewIncident(incident({ reparable: false }));
    await repair.handleNewIncident(incident({ structure: null }));
    expect(complete).not.toHaveBeenCalled();
  });

  it("límite diario: la consulta de más no se hace, y al día siguiente se puede de nuevo", async () => {
    const { repair, complete } = setup(answer(), { maxPerDay: 2 });
    for (const id of [1, 2, 3]) await repair.handleNewIncident(incident({ id }));
    expect(complete).toHaveBeenCalledTimes(2);
    expect(logs.some((l) => l.includes("límite diario (2)"))).toBe(true);
    expect(sent).toHaveLength(2);

    clock += 24 * 3_600_000;
    await repair.handleNewIncident(incident({ id: 4 }));
    expect(complete).toHaveBeenCalledTimes(3);
  });

  it("un fallo del cliente (red, 5xx…) no lanza: queda en el log y el robot sigue", async () => {
    const { repair } = setup(async () => {
      throw new Error("503 sobrecargado, contacto ana@correo.pe");
    });
    await expect(repair.handleNewIncident(incident())).resolves.toBeUndefined();
    expect(logs.join("\n")).toContain("falló la consulta");
    expect(logs.join("\n")).not.toContain("ana@correo.pe");
    expect(sent).toEqual([]);
  });

  it("si falla el aviso, la propuesta queda guardada igualmente", async () => {
    const complete = vi.fn<Complete>(async () => answer());
    const store = new ProposalStore(path.join(dir, "propuestas"), now);
    const repair = createRepairService({
      complete, model: "m", maxPerDay: 5, verifyMinutes: 30, maxAttempts: 1, rehearse: async () => PASS, store, now,
      notify: async () => {
        throw new Error("sin canal");
      },
      log: (m) => void logs.push(m),
    });
    await repair.handleNewIncident(incident());
    expect(await store.get(1)).toMatchObject({ estado: "propuesta" });
  });
});

describe("desactivada sin ANTHROPIC_API_KEY", () => {
  const env = { BOT_API_URL: "http://localhost:3000", PORTAL_BOT_SECRET: "x".repeat(32) };

  it("sin clave no hay servicio y el aviso de incidente es el de siempre", () => {
    const config = loadConfig(env);
    expect(config).toMatchObject({ repairEnabled: false, repairModel: "claude-sonnet-5-5", repairMaxPerDay: 10, repairVerifyMinutes: 30, repairMaxAttempts: 3 });
    expect(createRepairFromConfig(config, { notify: async () => {}, log: () => {}, rehearse: async () => PASS })).toBeNull();
    expect(loadConfig({ ...env, ANTHROPIC_API_KEY: "   " }).repairEnabled).toBe(false);
    expect(incidentMessage(incident())).toContain("Aún no hay reparación automática");
    expect(incidentMessage(incident(), { repairActive: false })).toContain("Aún no hay reparación automática");
  });

  it("con clave se activa (el cliente real no se crea hasta consultar) y lee las variables con validación", () => {
    const config = loadConfig({ ...env, ANTHROPIC_API_KEY: "sk-ant-prueba", BOT_REPAIR_MODEL: "claude-sonnet-5-5", BOT_REPAIR_MAX_PER_DAY: "3", BOT_REPAIR_VERIFY_MINUTES: "5" });
    expect(config).toMatchObject({ repairEnabled: true, repairMaxPerDay: 3, repairVerifyMinutes: 5 });
    expect(Object.values(config)).not.toContain("sk-ant-prueba"); // la clave no se guarda en la configuración
    const repair = createRepairFromConfig(config, { notify: async () => {}, log: () => {}, rehearse: async () => PASS });
    expect(repair).not.toBeNull();
    expect(sdk.options).toHaveLength(0);
    expect(incidentMessage(incident(), { repairActive: true })).toContain("preparando una propuesta");
    expect(incidentMessage(incident({ structure: null }), { repairActive: true })).toContain("Aún no hay reparación automática");

    expect(loadRepairConfig({ ANTHROPIC_API_KEY: "k", BOT_REPAIR_MAX_PER_DAY: "0" }).repairEnabled).toBe(false); // 0 = apagado
    for (const bad of [{ BOT_REPAIR_MAX_PER_DAY: "-1" }, { BOT_REPAIR_MAX_PER_DAY: "2.5" }, { BOT_REPAIR_MAX_PER_DAY: "x" }, { BOT_REPAIR_VERIFY_MINUTES: "0" }, { BOT_REPAIR_VERIFY_MINUTES: "2000" }, { BOT_REPAIR_MAX_ATTEMPTS: "0" }, { BOT_REPAIR_MAX_ATTEMPTS: "6" }, { BOT_REPAIR_MAX_ATTEMPTS: "2.5" }, { BOT_REPAIR_MODEL: "con espacios" }]) {
      expect(() => loadRepairConfig(bad), JSON.stringify(bad)).toThrow(/BOT_REPAIR/);
    }
  });
});

describe("«sí N» / «no N»", () => {
  async function withIncident(result: CompleteResult = answer()) {
    const incidents = new FileIncidentStore(path.join(dir, "incidentes"), () => {});
    await incidents.record({ portal: PORTAL, step: "prueba_estructura", error: Object.assign(new Error("falta el campo"), { code: "pagina_cambio" }), captureStructure: async () => STRUCTURE });
    const created = (await incidents.get(1))!;
    const ctx = setup(result);
    const handle = createIncomingHandler(new BotControl("fake"), incidents, ctx.repair);
    return { ...ctx, incidents, handle, created };
  }
  const decision = (kind: "aprobado" | "rechazado", id = 1) => ({ kind: "decision", decision: kind, id }) as const;

  it("con propuesta, «sí N» escribe el override aprobado, marca la propuesta aplicada y avisa de la comprobación", async () => {
    const { handle, repair, store, incidents, created, onApplied } = await withIncident();
    expect(created.structure).toBe(STRUCTURE);
    await repair.handleNewIncident(created);

    const reply = await handle(decision("aprobado"));
    expect(reply).toContain("marcado como aprobado");
    expect(reply).toContain("«#titulo-v2» como campo_titulo");
    expect(reply).toContain("comprobación automática");
    expect(getOverride(PORTAL, "campo_titulo")).toEqual({ selector: "#titulo-v2", aprobadoEn: "2026-03-02T10:00:00.000Z", incidenteId: 1 });
    expect(await store.get(1)).toMatchObject({ estado: "aplicada", aplicadaEn: "2026-03-02T10:00:00.000Z", overrideAnterior: null });
    expect((await incidents.get(1))!.status).toBe("aprobado");
    expect(onApplied).toHaveBeenCalledWith(PORTAL);
    const file = JSON.parse(await readFile(path.join(dir, "selectores.json"), "utf8"));
    expect(file.overrides[PORTAL].campo_titulo.selector).toBe("#titulo-v2");

    // Decidir otra vez no repite nada.
    expect(await handle(decision("aprobado"))).toContain("ya estaba decidido");
  });

  it("con propuesta, «no N» la rechaza y no toca los selectores", async () => {
    const { handle, repair, store, incidents, created } = await withIncident();
    await repair.handleNewIncident(created);
    expect(await handle(decision("rechazado"))).toContain("rechazado");
    expect(await store.get(1)).toMatchObject({ estado: "rechazada" });
    expect(getOverride(PORTAL, "campo_titulo")).toBeUndefined();
    expect((await incidents.get(1))!.status).toBe("rechazado");
    await expect(readFile(path.join(dir, "selectores.json"), "utf8")).rejects.toThrow();
  });

  it("sin propuesta, «sí» y «no» se comportan exactamente como antes (solo constancia)", async () => {
    const { handle, incidents } = await withIncident({ ...answer(), stopReason: "refusal" });
    expect(await handle(decision("aprobado", 7))).toContain("No existe");
    expect(await handle(decision("aprobado"))).toBe("Incidente #1 marcado como aprobado. Todavía no hay reparación automática: queda solo como constancia.");
    expect((await incidents.get(1))!.status).toBe("aprobado");
    expect(getOverride(PORTAL, "campo_titulo")).toBeUndefined();
  });

  it("sin servicio de reparación (sin clave) el manejador es el de siempre", async () => {
    const incidents = new FileIncidentStore(path.join(dir, "incidentes"), () => {});
    await incidents.record({ portal: PORTAL, step: "publicar", error: new Error("x") });
    const handle = createIncomingHandler(new BotControl("fake"), incidents, null);
    expect(await handle(decision("rechazado"))).toBe("Incidente #1 marcado como rechazado. Todavía no hay reparación automática: queda solo como constancia.");
  });

  it("si no se puede escribir el selector, avisa y el incidente sigue abierto", async () => {
    const { handle, repair, incidents, created, store } = await withIncident();
    await repair.handleNewIncident(created);
    await writeFile(path.join(dir, "bloqueo"), "x");
    configureSelectorState({ overridesFile: path.join(dir, "bloqueo", "selectores.json") }); // un archivo hace de carpeta: no se puede escribir
    const reply = await handle(decision("aprobado"));
    expect(reply).toContain("No pude aplicar la propuesta");
    expect((await incidents.get(1))!.status).toBe("abierto");
    expect(await store.get(1)).toMatchObject({ estado: "propuesta" });
  });
});

describe("verificación y reversión automática", () => {
  async function applied(extra: { verifyMinutes?: number } = {}) {
    const ctx = setup(answer(), extra);
    await ctx.repair.handleNewIncident(incident());
    sent.length = 0;
    expect(await ctx.repair.apply(1)).toMatchObject({ ok: true });
    return ctx;
  }

  it("si la comprobación falla dentro de la ventana, revierte el override, marca «revertida» y avisa", async () => {
    const { repair, store } = await applied();
    clock += 10 * 60_000;
    await repair.onHealthResult(PORTAL, false);
    expect(getOverride(PORTAL, "campo_titulo")).toBeUndefined();
    expect(await store.get(1)).toMatchObject({ estado: "revertida", revertidaEn: "2026-03-02T10:10:00.000Z" });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("no superó la comprobación");
    expect(sent[0]).toContain("se revirtió");
  });

  it("al revertir restaura el override que había antes", async () => {
    setOverride(PORTAL, "campo_titulo", { selector: "#anterior", aprobadoEn: "2026-02-01T00:00:00Z", incidenteId: 5 });
    const { repair, store } = await applied();
    expect(getOverride(PORTAL, "campo_titulo")).toMatchObject({ selector: "#titulo-v2", incidenteId: 1 });
    await repair.onHealthResult(PORTAL, false);
    expect(getOverride(PORTAL, "campo_titulo")).toEqual({ selector: "#anterior", aprobadoEn: "2026-02-01T00:00:00Z", incidenteId: 5 });
    expect(await store.get(1)).toMatchObject({ estado: "revertida" });
  });

  it("si la comprobación pasa, queda activo y avisa «Reparación aplicada y verificada»; fallos posteriores no lo revierten", async () => {
    const { repair, store } = await applied();
    clock += 60_000;
    await repair.onHealthResult(PORTAL, true);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Reparación aplicada y verificada");
    expect(await store.get(1)).toMatchObject({ estado: "aplicada", verificadaEn: "2026-03-02T10:01:00.000Z" });

    await repair.onHealthResult(PORTAL, true); // no se avisa dos veces
    await repair.onHealthResult(PORTAL, false); // un fallo posterior ya no es de la reparación
    expect(sent).toHaveLength(1);
    expect(getOverride(PORTAL, "campo_titulo")).toMatchObject({ selector: "#titulo-v2" });
  });

  it("un fallo fuera de la ventana de verificación no revierte; una comprobación de otro portal tampoco; una que empezó antes de aplicar no cuenta", async () => {
    const { repair, store } = await applied({ verifyMinutes: 30 });
    await repair.onHealthResult("otro-portal", false);
    await repair.onHealthResult(PORTAL, false, clock - 60_000); // empezó antes de aplicarse
    expect(await store.get(1)).toMatchObject({ estado: "aplicada" });
    clock += 31 * 60_000;
    await repair.onHealthResult(PORTAL, false);
    expect(await store.get(1)).toMatchObject({ estado: "aplicada" });
    expect(getOverride(PORTAL, "campo_titulo")).toBeDefined();
    expect(sent).toEqual([]);
  });

  it("no revierte un override que otra decisión ya reemplazó", async () => {
    const { repair, store } = await applied();
    setOverride(PORTAL, "campo_titulo", { selector: "#otro", aprobadoEn: "2026-03-02T10:05:00Z", incidenteId: 8 });
    await repair.onHealthResult(PORTAL, false);
    expect(getOverride(PORTAL, "campo_titulo")).toMatchObject({ selector: "#otro", incidenteId: 8 });
    expect(await store.get(1)).toMatchObject({ estado: "revertida" });
  });
});

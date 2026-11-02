import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ERROR_CODES, errorCodeOf, NOT_REPAIRABLE, PortalError } from "../../bot/src/errors";
import { FileIncidentStore, sanitizeText, type Incident } from "../../bot/src/incidents";
import { parseIncoming } from "../../bot/src/notify/commands";
import { BotControl } from "../../bot/src/notify/control";
import { createIncomingHandler, incidentMessage } from "../../bot/src/notify/incoming";
import { acceptMessage, BoundedSet, hideSignalNoise, WhatsAppNotifier } from "../../bot/src/notify/whatsapp";
import { createHealthSchedule, runCycle } from "../../bot/src/runner";
import { MemorySeenStore } from "../../bot/src/seen";
import type { PortalAdapter } from "../../bot/src/types";
import { MemoryApi } from "../fixtures/bot";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "incidentes-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const changed = (message = "no se encontró el botón") => new PortalError(ERROR_CODES.pageChanged, message);

describe("sanitizeText", () => {
  it("quita correos, teléfonos y parámetros de enlaces", () => {
    const text = sanitizeText("falló para ana@correo.pe, cel +51 987 654 321 en https://portal.pe/o/1?token=secreto#x");
    expect(text).not.toContain("ana@correo.pe");
    expect(text).not.toContain("987");
    expect(text).not.toContain("secreto");
    expect(text).toContain("https://portal.pe/o/1");
  });

  it("recorta los textos largos", () => {
    expect(sanitizeText("a".repeat(2_000)).length).toBeLessThanOrEqual(601);
  });
});

describe("FileIncidentStore", () => {
  it("guarda el incidente con número, estructura y aviso, sin datos personales", async () => {
    const onNew = vi.fn();
    const store = new FileIncidentStore(dir, () => {}, onNew);
    await store.record({
      portal: "trabajos-diarios",
      step: "publicar",
      error: changed("falló con ana@correo.pe"),
      publicationId: "pub-1",
      captureStructure: async () => '{"buttons":[{"text":"Publicar aviso"}]}',
    });

    const [incident] = await store.list();
    expect(incident).toMatchObject({ id: 1, portal: "trabajos-diarios", step: "publicar", errorCode: "pagina_cambio", reparable: true, status: "abierto" });
    expect(incident.message).not.toContain("ana@correo.pe");
    expect(incident.structure).toContain("Publicar aviso");
    expect(onNew).toHaveBeenCalledTimes(1);
    expect(JSON.parse(await readFile(path.join(dir, "0001.json"), "utf8")).id).toBe(1);
  });

  it("marca como no reparables los que exigen a una persona", async () => {
    const store = new FileIncidentStore(dir, () => {});
    await store.record({ portal: "p", step: "publicar", error: new PortalError(ERROR_CODES.sessionExpired) });
    expect((await store.list())[0].reparable).toBe(false);
  });

  it("agrupa el mismo fallo repetido y no vuelve a avisar", async () => {
    const onNew = vi.fn();
    const store = new FileIncidentStore(dir, () => {}, onNew);
    for (let i = 0; i < 3; i++) await store.record({ portal: "p", step: "publicar", error: changed() });
    const all = await store.list();
    expect(all).toHaveLength(1);
    expect(all[0].occurrences).toBe(3);
    expect(onNew).toHaveBeenCalledTimes(1);
  });

  it("un fallo distinto es otro incidente con el siguiente número", async () => {
    const store = new FileIncidentStore(dir, () => {});
    await store.record({ portal: "p", step: "publicar", error: changed() });
    await store.record({ portal: "p", step: "retirar", error: changed() });
    expect((await store.list()).map((i) => i.id)).toEqual([1, 2]);
  });

  it("pasada la ventana, el mismo fallo es un incidente nuevo", async () => {
    let now = new Date("2026-10-30T10:00:00Z");
    const store = new FileIncidentStore(dir, () => {}, undefined, () => now);
    await store.record({ portal: "p", step: "publicar", error: changed() });
    now = new Date("2026-10-30T17:00:00Z");
    await store.record({ portal: "p", step: "publicar", error: changed() });
    expect(await store.list()).toHaveLength(2);
  });

  it("si capturar la estructura falla, guarda igual el incidente", async () => {
    const store = new FileIncidentStore(dir, () => {});
    await store.record({
      portal: "p",
      step: "publicar",
      error: changed(),
      captureStructure: async () => {
        throw new Error("la página se cerró");
      },
    });
    expect((await store.list())[0].structure).toBeNull();
  });

  it("nunca lanza, aunque la carpeta no se pueda escribir", async () => {
    const store = new FileIncidentStore(path.join(dir, "0001.json", "no-se-puede"), () => {});
    await store.record({ portal: "p", step: "publicar", error: changed() });
    await store.record({ portal: "p", step: "publicar", error: changed() });
  });

  it("varios registros a la vez no repiten número ni dejan archivos temporales", async () => {
    const store = new FileIncidentStore(dir, () => {});
    await Promise.all(
      ["publicar", "retirar", "leer_postulantes", "descargar_cv"].map((step) =>
        store.record({ portal: "p", step: step as Incident["step"], error: changed() }),
      ),
    );
    expect((await store.list()).map((i) => i.id).sort()).toEqual([1, 2, 3, 4]);
    const files = await readdir(dir);
    expect(files.filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("una decisión y un registro simultáneos no se pisan", async () => {
    const store = new FileIncidentStore(dir, () => {});
    await store.record({ portal: "p", step: "publicar", error: changed() });
    await Promise.all([store.decide(1, "aprobado"), store.record({ portal: "p", step: "retirar", error: changed() })]);
    const all = await store.list();
    expect(all.map((i) => [i.id, i.status])).toEqual([
      [1, "aprobado"],
      [2, "abierto"],
    ]);
  });

  it("decide una sola vez", async () => {
    const store = new FileIncidentStore(dir, () => {});
    await store.record({ portal: "p", step: "publicar", error: changed() });
    expect(await store.decide(9, "aprobado")).toBe("no_existe");
    expect(await store.decide(1, "aprobado")).toMatchObject({ status: "aprobado" });
    expect(await store.decide(1, "rechazado")).toBe("ya_decidido");
  });
});

describe("parseIncoming", () => {
  it("entiende «sí N» y «no N» con tildes, mayúsculas y #", () => {
    expect(parseIncoming("sí 3")).toEqual({ kind: "decision", decision: "aprobado", id: 3 });
    expect(parseIncoming("SI #12")).toEqual({ kind: "decision", decision: "aprobado", id: 12 });
    expect(parseIncoming("no 3.")).toEqual({ kind: "decision", decision: "rechazado", id: 3 });
  });

  it("entiende las órdenes y «incidentes»", () => {
    expect(parseIncoming("estado")).toEqual({ kind: "command", command: "estado" });
    expect(parseIncoming("Incidentes")).toEqual({ kind: "incidents" });
  });

  it("ignora lo demás: sin número, texto extra o número raro", () => {
    for (const text of ["sí", "no", "sí 3 por favor", "si -1", "si 3.5", "si 1234567", "aprobar 3", ""]) {
      expect(parseIncoming(text)).toBeNull();
    }
  });
});

describe("createIncomingHandler", () => {
  async function setup() {
    const store = new FileIncidentStore(dir, () => {});
    await store.record({ portal: "trabajos-diarios", step: "publicar", error: changed() });
    return { store, handle: createIncomingHandler(new BotControl("fake"), store) };
  }

  it("lista los incidentes abiertos y deja de listar los decididos", async () => {
    const { handle } = await setup();
    expect(await handle({ kind: "incidents" })).toContain("#1 trabajos-diarios");
    expect(await handle({ kind: "decision", decision: "aprobado", id: 1 })).toContain("marcado como aprobado");
    expect(await handle({ kind: "incidents" })).toBe("No hay incidentes abiertos.");
  });

  it("responde con claridad a un número que no existe o ya decidido", async () => {
    const { handle } = await setup();
    expect(await handle({ kind: "decision", decision: "aprobado", id: 7 })).toContain("No existe");
    await handle({ kind: "decision", decision: "rechazado", id: 1 });
    expect(await handle({ kind: "decision", decision: "aprobado", id: 1 })).toContain("ya estaba decidido");
  });

  it("«ayuda» menciona incidentes solo si hay almacén", async () => {
    const { handle } = await setup();
    expect(await handle({ kind: "command", command: "ayuda" })).toContain("incidentes");
    const without = createIncomingHandler(new BotControl("fake"));
    expect(await without({ kind: "command", command: "ayuda" })).not.toContain("incidentes");
    expect(await without({ kind: "incidents" })).toContain("no guarda incidentes");
  });

  it("el aviso explica si es reparable o lo resuelve una persona", () => {
    const base = { id: 4, portal: "p", step: "publicar", errorCode: "x" } as Incident;
    expect(incidentMessage({ ...base, reparable: true })).toContain("cambio del portal");
    expect(incidentMessage({ ...base, reparable: false })).toContain("una persona");
  });
});

describe("hideSignalNoise", () => {
  it("oculta los mensajes internos de la sesión cifrada y deja pasar el resto", () => {
    const seen: unknown[][] = [];
    const fake = {
      info: (...args: unknown[]) => void seen.push(args),
      warn: (...args: unknown[]) => void seen.push(args),
    } as Pick<Console, "info" | "warn">;
    hideSignalNoise(fake);
    fake.info("Closing session:", { clave: "secreta" });
    fake.warn("Decrypted message with closed session.");
    fake.info("Migrating session to:", 1);
    fake.warn("otra advertencia importante");
    expect(seen).toEqual([["otra advertencia importante"]]);
  });
});

describe("el runner registra incidentes", () => {
  function adapter(overrides: Partial<PortalAdapter>): PortalAdapter {
    return {
      slug: "trabajos-diarios",
      healthCheck: vi.fn(async () => {}),
      publish: vi.fn(async () => ({ externalId: "e", externalUrl: "https://p.test/e" })),
      withdraw: vi.fn(async () => {}),
      listApplicants: vi.fn(async () => []),
      downloadResume: vi.fn(),
      close: vi.fn(async () => {}),
      ...overrides,
    };
  }

  it("la prueba de estructura fallida deja un incidente con la estructura de la pantalla", async () => {
    const store = new FileIncidentStore(dir, () => {});
    const deps = {
      api: new MemoryApi(),
      adapter: adapter({
        healthCheck: vi.fn(async () => {
          throw changed("falta #titulo");
        }),
        captureStructure: async () => '{"fields":[]}',
      }),
      seen: new MemorySeenStore(),
      health: createHealthSchedule(24),
      log: () => {},
      incidents: store,
      pauseMs: 0,
      maxJobs: 5,
    };
    const result = await runCycle(deps);
    expect(result).toMatchObject({ halted: true, reason: "pagina_cambio" });
    const [incident] = await store.list();
    expect(incident).toMatchObject({ step: "prueba_estructura", errorCode: "pagina_cambio", structure: '{"fields":[]}' });
    expect(incident.message).toContain("falta #titulo");
  });
});

describe("acceptMessage: solo órdenes recientes, propias y no atendidas", () => {
  const base = () => ({
    fromMe: true,
    id: "MSG1",
    ownChat: true,
    timestampSeconds: 1_000,
    nowSeconds: 1_010,
    sentIds: new BoundedSet(10),
    handledIds: new BoundedSet(10),
  });

  it("acepta una orden reciente del responsable en su chat y no la atiende dos veces", () => {
    const input = base();
    expect(acceptMessage(input)).toBe(true);
    expect(acceptMessage(input)).toBe(false);
  });

  it("rechaza lo que no es suyo, no está en su chat, no tiene id o es un aviso del propio robot", () => {
    expect(acceptMessage({ ...base(), fromMe: false })).toBe(false);
    expect(acceptMessage({ ...base(), ownChat: false })).toBe(false);
    expect(acceptMessage({ ...base(), id: undefined })).toBe(false);
    const sent = new BoundedSet(10);
    sent.add("MSG1");
    expect(acceptMessage({ ...base(), sentIds: sent })).toBe(false);
  });

  it("ignora una orden vieja medida contra la hora actual, no contra el arranque", () => {
    expect(acceptMessage({ ...base(), nowSeconds: 1_000 + 61 })).toBe(false);
    expect(acceptMessage({ ...base(), nowSeconds: 1_000 + 60 })).toBe(true);
  });

  it("BoundedSet conserva solo los últimos elementos", () => {
    const set = new BoundedSet(2);
    set.add("a");
    set.add("b");
    set.add("c");
    expect([set.has("a"), set.has("b"), set.has("c")]).toEqual([false, true, true]);
  });
});

describe("WhatsAppNotifier.notify no frena al robot", () => {
  it("vuelve de inmediato aunque no haya conexión, y avisa en el log cuando se agota la espera", async () => {
    vi.useFakeTimers();
    try {
      const lines: string[] = [];
      const notifier = new WhatsAppNotifier({ authDir: "x", phone: "51999999999", log: (m) => void lines.push(m) });
      await notifier.notify("hola"); // no hay socket: antes bloqueaba hasta 15 s
      expect(lines).toEqual([]);
      await vi.advanceTimersByTimeAsync(16_000);
      expect(lines.join(" ")).toContain("sin conexión");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("portal caído o sin conexión no es un cambio de página", () => {
  const refused = new Error('page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:4011/x Call log: - navigating');

  it.each(["ERR_CONNECTION_REFUSED", "ERR_NAME_NOT_RESOLVED", "ERR_INTERNET_DISCONNECTED", "ERR_CONNECTION_RESET"])(
    "%s se clasifica como portal_no_disponible",
    (name) => {
      expect(errorCodeOf(new Error(`page.goto: net::${name} at https://portal.pe/`))).toBe(ERROR_CODES.portalUnreachable);
    },
  );

  it("un tiempo agotado o un selector que falta siguen siendo cambio de página", () => {
    expect(errorCodeOf(new Error("locator.waitFor: Timeout 15000ms exceeded"))).toBe(ERROR_CODES.pageChanged);
    expect(errorCodeOf(new PortalError(ERROR_CODES.pageChanged, "falta #x"))).toBe(ERROR_CODES.pageChanged);
  });

  it("no es reparable, y el aviso no habla de un cambio del portal", async () => {
    expect(NOT_REPAIRABLE.has(ERROR_CODES.portalUnreachable)).toBe(true);
    const store = new FileIncidentStore(dir, () => {});
    await store.record({ portal: "indeed", step: "publicar", error: refused });
    const [incident] = await store.list();
    expect(incident).toMatchObject({ errorCode: "portal_no_disponible", reparable: false });
    const text = incidentMessage(incident!);
    expect(text).not.toMatch(/cambio del portal/);
    expect(text).toMatch(/no respondió/);
  });

  it("el saneado conserva una dirección IP y sigue ocultando teléfonos", () => {
    const text = sanitizeText("falló en 127.0.0.1:4011, cel 987 654 321");
    expect(text).toContain("127.0.0.1");
    expect(text).not.toContain("987");
  });
});

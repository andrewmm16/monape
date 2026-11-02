import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BotApiLike, SendApplicantStatus } from "../../../bot/src/api";
import type { ApplicantSummary, ResumeFile } from "../../../bot/src/types";
import { loadConfig } from "../../../correo/src/config";
import { isAuthentic, MAX_RESUME_BYTES, runPass, type ProcessDeps } from "../../../correo/src/process";
import { FolderSource, type MailSourceLike, type RawMail } from "../../../correo/src/sources";
import { MemoryStateStore } from "../../../correo/src/state";
import { getTemplates } from "../../../correo/src/templates";

const PUBLICATION_ID = "11111111-1111-4111-8111-111111111111";
const GOOD_AUTH = "mx.empresa.test; dkim=pass header.d=avisos.ejemplo.test; spf=pass; dmarc=pass header.from=avisos.ejemplo.test";

interface EmlOptions {
  messageId?: string;
  from?: string;
  auth?: string | null;
  offer?: string;
  name?: string;
  attachments?: { filename: string; contentType: string; bytes: Buffer }[];
}

/** Correo sintético en formato del portal FICTICIO (los datos son inventados). */
function eml(options: EmlOptions = {}): Buffer {
  const { messageId = "<m1@avisos.ejemplo.test>", from = "avisos@avisos.ejemplo.test", offer = "OF-1", name = "Ana Prueba" } = options;
  const auth = options.auth === undefined ? GOOD_AUTH : options.auth;
  const attachments = options.attachments ?? [{ filename: "cv.pdf", contentType: "application/pdf", bytes: Buffer.from("%PDF-1.4 sintetico") }];
  const boundary = "----limite-prueba";
  const lines = [
    ...(auth ? [`Authentication-Results: ${auth}`] : []),
    `From: Avisos <${from}>`,
    "To: empleos@empresa.test",
    "Subject: [EJEMPLO] Nueva postulación",
    `Message-ID: ${messageId}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    `Oferta: ${offer}`,
    `Nombre: ${name}`,
    "Correo: ana@postulante.test",
    "Telefono: 999111222",
  ];
  for (const item of attachments) {
    lines.push(
      `--${boundary}`,
      `Content-Type: ${item.contentType}; name="${item.filename}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${item.filename}"`,
      "",
      item.bytes.toString("base64").replace(/(.{76})/g, "$1\r\n"),
    );
  }
  lines.push(`--${boundary}--`, "");
  return Buffer.from(lines.join("\r\n"));
}

class FakeSource implements MailSourceLike {
  constructor(private readonly mails: (Buffer | Error)[]) {}
  async *fetchNew(): AsyncGenerator<RawMail> {
    for (const mail of this.mails) {
      if (mail instanceof Error) throw mail;
      yield { raw: mail };
    }
  }
}

class FakeApi implements BotApiLike {
  sent: { publicationId: string; applicant: ApplicantSummary; resume: ResumeFile }[] = [];
  activeCalls = 0;
  status: SendApplicantStatus = "registrada";
  failActive = false;
  publications = [{ publicationId: PUBLICATION_ID, externalId: "OF-1", externalUrl: null, lastSyncedAt: null }];
  async active() {
    this.activeCalls += 1;
    if (this.failActive) throw new Error("red caida");
    return this.publications;
  }
  async sendApplicant(publicationId: string, applicant: ApplicantSummary, resume: ResumeFile) {
    this.sent.push({ publicationId, applicant, resume });
    return this.status;
  }
  async claim(): Promise<never> {
    throw new Error("no usado");
  }
  async report(): Promise<never> {
    throw new Error("no usado");
  }
  async markSynced(): Promise<never> {
    throw new Error("no usado");
  }
  async reportStatus(): Promise<never> {
    throw new Error("no usado");
  }
}

let api: FakeApi;
let logs: string[];
let deps: ProcessDeps;

beforeEach(() => {
  api = new FakeApi();
  logs = [];
  deps = { api, templates: getTemplates(true), state: new MemoryStateStore(), requireAuth: true, log: (message) => logs.push(message) };
});

describe("lector de correo", () => {
  it("caso feliz: entrega al postulante con un id externo sin datos personales", async () => {
    const counts = await runPass(new FakeSource([eml()]), deps);
    expect(counts).toEqual({ registrada: 1 });
    expect(api.sent).toHaveLength(1);
    const { publicationId, applicant, resume } = api.sent[0]!;
    expect(publicationId).toBe(PUBLICATION_ID);
    expect(applicant).toMatchObject({ fullName: "Ana Prueba", email: "ana@postulante.test", phone: "999111222" });
    expect(applicant.externalId).toMatch(/^correo-[0-9a-f]{64}$/);
    expect(resume.filename).toBe("cv.pdf");
    expect(Buffer.from(resume.bytes).toString()).toBe("%PDF-1.4 sintetico");
  });

  it("idempotencia: el mismo correo dos veces no se envía dos veces", async () => {
    await runPass(new FakeSource([eml()]), deps);
    const second = await runPass(new FakeSource([eml()]), deps);
    expect(second).toEqual({});
    expect(api.sent).toHaveLength(1);
  });

  it("el mismo id externo sale siempre del mismo Message-ID", async () => {
    await runPass(new FakeSource([eml()]), deps);
    const other = { ...deps, state: new MemoryStateStore() };
    await runPass(new FakeSource([eml()]), other);
    expect(api.sent[1]!.applicant.externalId).toBe(api.sent[0]!.applicant.externalId);
  });

  it("rechaza un remitente que no es de ningún portal", async () => {
    const counts = await runPass(new FakeSource([eml({ from: "x@otro.test" })]), deps);
    expect(counts).toEqual({ remitente_no_autorizado: 1 });
    expect(api.sent).toHaveLength(0);
    expect(api.activeCalls).toBe(0);
  });

  it("rechaza un correo sin Authentication-Results o sin dmarc=pass", async () => {
    const counts = await runPass(
      new FakeSource([
        eml({ messageId: "<a@x>", auth: null }),
        eml({ messageId: "<b@x>", auth: "mx.empresa.test; dkim=pass; spf=pass; dmarc=fail" }),
        eml({ messageId: "<c@x>", auth: "mx.empresa.test; dkim=fail; spf=fail; dmarc=pass" }),
      ]),
      deps,
    );
    expect(counts).toEqual({ remitente_no_autorizado: 3 });
    expect(api.sent).toHaveLength(0);
  });

  it("con MAIL_REQUIRE_AUTH=false acepta un correo sin Authentication-Results", async () => {
    const counts = await runPass(new FakeSource([eml({ auth: null })]), { ...deps, requireAuth: false });
    expect(counts).toEqual({ registrada: 1 });
  });

  it("isAuthentic solo cree en el primer encabezado", () => {
    expect(isAuthentic([])).toBe(false);
    expect(isAuthentic(["mx; spf=pass; dmarc=pass"])).toBe(true);
    expect(isAuthentic(["mx; dkim=none; dmarc=pass", "falso; dkim=pass; dmarc=pass"])).toBe(false);
  });

  it("sin plantilla activa no acepta nada", async () => {
    const counts = await runPass(new FakeSource([eml()]), { ...deps, templates: getTemplates(false) });
    expect(counts).toEqual({ remitente_no_autorizado: 1 });
  });

  it("de un dominio conocido pero con otro formato: sin_plantilla", async () => {
    const counts = await runPass(new FakeSource([eml({ offer: "", name: "" })]), deps);
    expect(counts).toEqual({ sin_plantilla: 1 });
  });

  it("oferta desconocida: no envía y se reintenta en la pasada siguiente", async () => {
    const counts = await runPass(new FakeSource([eml({ offer: "OF-999" })]), deps);
    expect(counts).toEqual({ oferta_desconocida: 1 });
    expect(api.sent).toHaveLength(0);
  });

  it("sin adjunto: sin_cv, no envía y queda en el estado", async () => {
    const counts = await runPass(new FakeSource([eml({ attachments: [] })]), deps);
    expect(counts).toEqual({ sin_cv: 1 });
    expect(api.sent).toHaveLength(0);
    expect(await runPass(new FakeSource([eml({ attachments: [] })]), deps)).toEqual({});
  });

  it("adjunto demasiado grande o de tipo no admitido: cv_invalido", async () => {
    const big = Buffer.alloc(MAX_RESUME_BYTES + 1, 1);
    const counts = await runPass(
      new FakeSource([
        eml({ messageId: "<big@x>", attachments: [{ filename: "cv.pdf", contentType: "application/pdf", bytes: big }] }),
        eml({ messageId: "<exe@x>", attachments: [{ filename: "cv.exe", contentType: "application/octet-stream", bytes: Buffer.from("MZ") }] }),
      ]),
      deps,
    );
    expect(counts).toEqual({ cv_invalido: 2 });
    expect(api.sent).toHaveLength(0);
  });

  it("elige el PDF aunque haya una imagen y otro adjunto antes", async () => {
    await runPass(
      new FakeSource([
        eml({
          attachments: [
            { filename: "logo.png", contentType: "image/png", bytes: Buffer.from("png") },
            { filename: "notas.txt", contentType: "text/plain", bytes: Buffer.from("x") },
            { filename: "cv.docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", bytes: Buffer.from("PK\x03\x04") },
          ],
        }),
      ]),
      deps,
    );
    expect(api.sent[0]!.resume.filename).toBe("cv.docx");
  });

  it("la app responde cerrada o invalida: se traduce a un código", async () => {
    api.status = "cerrada";
    expect(await runPass(new FakeSource([eml({ messageId: "<c@x>" })]), deps)).toEqual({ oferta_desconocida: 1 });
    api.status = "invalida";
    expect(await runPass(new FakeSource([eml({ messageId: "<i@x>" })]), deps)).toEqual({ cv_invalido: 1 });
  });

  it("un fallo de la app da error, no se guarda y se reintenta", async () => {
    api.failActive = true;
    expect(await runPass(new FakeSource([eml()]), deps)).toEqual({ error: 1 });
    api.failActive = false;
    expect(await runPass(new FakeSource([eml()]), deps)).toEqual({ registrada: 1 });
  });

  it("un correo malo no detiene a los demás", async () => {
    let calls = 0;
    api.active = async () => {
      calls += 1;
      if (calls === 1) throw new Error("fallo puntual");
      return api.publications;
    };
    const counts = await runPass(
      new FakeSource([Buffer.from("esto no es un correo"), eml({ messageId: "<falla@x>" }), eml({ messageId: "<ok@x>" })]),
      deps,
    );
    expect(counts).toEqual({ remitente_no_autorizado: 1, error: 1, registrada: 1 });
    expect(api.sent).toHaveLength(1);
  });

  it("los registros solo llevan códigos y hashes, nunca datos del correo", async () => {
    await runPass(new FakeSource([eml(), eml({ messageId: "<z@x>", attachments: [] })]), deps);
    const text = logs.join("\n");
    expect(logs.length).toBeGreaterThan(0);
    for (const secret of ["Ana", "postulante.test", "999111222", "Nueva postulación", "OF-1", "ejemplo"]) {
      expect(text).not.toContain(secret);
    }
    expect(text).toMatch(/correo [0-9a-f]{8}: registrada/);
  });
});

describe("FolderSource", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "correo-test-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("lee los .eml de la carpeta (ignora otros archivos) y los procesa", async () => {
    writeFileSync(path.join(dir, "uno.eml"), eml({ messageId: "<f1@x>" }));
    writeFileSync(path.join(dir, "dos.EML"), eml({ messageId: "<f2@x>", offer: "OF-999" }));
    writeFileSync(path.join(dir, "notas.txt"), "no es un correo");
    const counts = await runPass(new FolderSource(dir), deps);
    expect(counts).toEqual({ registrada: 1, oferta_desconocida: 1 });
    expect(api.sent).toHaveLength(1);
  });
});

describe("configuración", () => {
  const base = { BOT_API_URL: "https://app.empresa.test/", PORTAL_BOT_SECRET: "s".repeat(32) };
  const imap = { MAIL_IMAP_HOST: "imap.empresa.test", MAIL_USER: "empleos@empresa.test", MAIL_PASSWORD: "x" };

  it("aplica los valores por defecto", () => {
    const config = loadConfig({ ...base, ...imap });
    expect(config).toMatchObject({ apiUrl: "https://app.empresa.test", imapPort: 993, imapSecure: true, mailbox: "INBOX", requireAuth: true, enableExample: false });
    expect(config.stateFile.replace(/\\/g, "/")).toMatch(/correo\/\.state\/procesados\.json$/);
  });

  it("valida la dirección y el secreto como el robot", () => {
    expect(() => loadConfig({ ...base, ...imap, BOT_API_URL: "http://app.empresa.test" })).toThrow(/https/);
    expect(() => loadConfig({ ...base, ...imap, BOT_API_URL: "http://localhost:3000" })).not.toThrow();
    expect(() => loadConfig({ ...base, ...imap, PORTAL_BOT_SECRET: "corto" })).toThrow(/32/);
    expect(() => loadConfig({ ...base })).toThrow(/MAIL_IMAP_HOST/);
    expect(() => loadConfig({ ...base }, false)).not.toThrow();
    expect(() => loadConfig({ ...base, ...imap, MAIL_POLL_SECONDS: "1" })).toThrow(/MAIL_POLL_SECONDS/);
    expect(() => loadConfig({ ...base, ...imap, MAIL_REQUIRE_AUTH: "quizas" })).toThrow(/MAIL_REQUIRE_AUTH/);
  });
});

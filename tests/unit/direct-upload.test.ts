import { describe, expect, it } from "vitest";
import {
  confirmBatchUploadSchema,
  confirmResumeUploadSchema,
  directBatchPath,
  directResumePath,
  nameForConfirmedUpload,
  parseDirectUploadRequest,
} from "@/modules/resumes/direct-upload";
import { MAX_RESUME_BYTES, MAX_RESUME_UPLOAD_BYTES, validateResumeFile } from "@/modules/resumes/file-validation";
import { INLINE_RESUME_BYTES, needsDirectUpload, resumeKindFromName } from "@/modules/resumes/upload-limits";
import { signUploadTicket, ticketStoragePath, UPLOAD_TICKET_TTL_MS, verifyUploadTicket } from "@/modules/online-apply/upload-ticket";
import { makePdf } from "../fixtures/documents";

const SECRET = "secreto-ficticio-del-formulario-0123456789abcdef";
const CANDIDATE = "2b1c1f8e-6a0b-4f53-9a1c-3c5f0f6f1a10";
const RESUME = "9d7c2a40-1b2e-4c55-8f0a-7a6b5c4d3e21";
const NOW = 1_800_000_000_000;

describe("límites de carga de CV", () => {
  it("el tope general sigue en 4 MB y el de la carga directa es de 10 MB", () => {
    expect(MAX_RESUME_BYTES).toBe(4 * 1024 * 1024);
    expect(INLINE_RESUME_BYTES).toBe(MAX_RESUME_BYTES);
    expect(MAX_RESUME_UPLOAD_BYTES).toBe(10 * 1024 * 1024);
  });

  it("solo los archivos de más de 4 MB van directo a Storage", () => {
    expect(needsDirectUpload(INLINE_RESUME_BYTES)).toBe(false);
    expect(needsDirectUpload(INLINE_RESUME_BYTES + 1)).toBe(true);
  });

  it("validateResumeFile acepta hasta el tope indicado y mantiene 4 MB por defecto", async () => {
    const pdf = await makePdf(["Experiencia en ventas"]);
    const padded = new Uint8Array(5 * 1024 * 1024);
    padded.set(pdf);
    // El relleno va después de %%EOF: la cola del archivo ya no lo incluye.
    padded.fill(0x20, pdf.length - 1);
    padded.set(new TextEncoder().encode("\n%%EOF\n"), padded.length - 8);
    const input = { name: "cv.pdf", size: padded.length, declaredType: "", bytes: padded };
    expect(validateResumeFile(input)).toEqual({ ok: false, reason: "El archivo supera el tamaño máximo de 4 MB." });
    expect(validateResumeFile({ ...input, maxBytes: MAX_RESUME_UPLOAD_BYTES })).toMatchObject({ ok: true, kind: "pdf" });

    const huge = new Uint8Array(MAX_RESUME_UPLOAD_BYTES + 1);
    expect(validateResumeFile({ name: "cv.pdf", size: huge.length, declaredType: "", bytes: huge, maxBytes: MAX_RESUME_UPLOAD_BYTES })).toEqual({
      ok: false,
      reason: "El archivo supera el tamaño máximo de 10 MB.",
    });
  });

  it("un texto renombrado a .pdf se rechaza por su contenido, sin confiar en el tipo declarado", () => {
    const bytes = new TextEncoder().encode("esto no es un pdf".repeat(10));
    expect(
      validateResumeFile({ name: "cv.pdf", size: bytes.length, declaredType: "", bytes, maxBytes: MAX_RESUME_UPLOAD_BYTES }),
    ).toEqual({ ok: false, reason: "El archivo no es un PDF válido." });
  });
});

describe("parseDirectUploadRequest", () => {
  it("acepta PDF y DOCX de hasta 10 MB y devuelve tipo y nombre seguros", () => {
    expect(parseDirectUploadRequest({ fileName: "Mi CV.PDF", size: 6 * 1024 * 1024 })).toEqual({
      ok: true,
      kind: "pdf",
      mimeType: "application/pdf",
      safeName: "Mi CV.PDF",
      size: 6 * 1024 * 1024,
    });
    expect(parseDirectUploadRequest({ fileName: "cv.docx", size: MAX_RESUME_UPLOAD_BYTES })).toMatchObject({ ok: true, kind: "docx" });
  });

  it("rechaza lo que supera 10 MB, está vacío, no es numérico o tiene otra extensión", () => {
    expect(parseDirectUploadRequest({ fileName: "cv.pdf", size: MAX_RESUME_UPLOAD_BYTES + 1 })).toEqual({
      ok: false,
      reason: "El archivo supera el tamaño máximo de 10 MB.",
    });
    expect(parseDirectUploadRequest({ fileName: "cv.pdf", size: 0 }).ok).toBe(false);
    expect(parseDirectUploadRequest({ fileName: "cv.pdf", size: Number.NaN }).ok).toBe(false);
    expect(parseDirectUploadRequest({ fileName: "cv.pdf", size: 1.5 }).ok).toBe(false);
    expect(parseDirectUploadRequest({ fileName: "cv.pdf", size: "100" }).ok).toBe(false);
    expect(parseDirectUploadRequest({ fileName: "cv.exe", size: 5_000_000 })).toEqual({
      ok: false,
      reason: "Solo se aceptan archivos PDF o DOCX.",
    });
    expect(parseDirectUploadRequest({ fileName: "", size: 5_000_000 }).ok).toBe(false);
    expect(parseDirectUploadRequest({ fileName: "a".repeat(300) + ".pdf", size: 5_000_000 }).ok).toBe(false);
    expect(parseDirectUploadRequest({ fileName: undefined, size: 5_000_000 }).ok).toBe(false);
  });

  it("la extensión se toma del último segmento del nombre, sin carpetas", () => {
    expect(resumeKindFromName("C:\\docs\\cv.pdf")).toBe("pdf");
    expect(resumeKindFromName("cv.pdf.exe")).toBeNull();
    expect(resumeKindFromName("cv")).toBeNull();
  });
});

describe("rutas de la carga directa", () => {
  it("las decide el servidor con el mismo formato que exige la base de datos", () => {
    expect(directResumePath(CANDIDATE, RESUME, "pdf")).toBe(`candidates/${CANDIDATE}/${RESUME}.pdf`);
    expect(directResumePath(CANDIDATE, RESUME, "docx")).toBe(`candidates/${CANDIDATE}/${RESUME}.docx`);
    expect(directBatchPath(CANDIDATE, RESUME, "pdf")).toBe(`intake/${CANDIDATE}/${RESUME}.pdf`);
  });

  it("la confirmación solo admite UUID y extensiones conocidas (no se puede colar una ruta)", () => {
    const ok = { candidateId: CANDIDATE, resumeId: RESUME, kind: "pdf", fileName: "cv.pdf" };
    expect(confirmResumeUploadSchema.safeParse(ok).success).toBe(true);
    expect(confirmResumeUploadSchema.safeParse({ ...ok, resumeId: "../../otro/archivo" }).success).toBe(false);
    expect(confirmResumeUploadSchema.safeParse({ ...ok, candidateId: `${CANDIDATE}/../x` }).success).toBe(false);
    expect(confirmResumeUploadSchema.safeParse({ ...ok, kind: "exe" }).success).toBe(false);
    expect(confirmResumeUploadSchema.safeParse({ ...ok, path: "candidates/x/y.pdf" }).data).not.toHaveProperty("path");
    const batch = { batchId: CANDIDATE, itemId: RESUME, kind: "docx", fileName: "cv.docx" };
    expect(confirmBatchUploadSchema.safeParse(batch).success).toBe(true);
    expect(confirmBatchUploadSchema.safeParse({ ...batch, itemId: "x" }).success).toBe(false);
  });

  it("el nombre que se valida lleva la extensión de la ruta firmada", () => {
    expect(nameForConfirmedUpload("cv.PDF", "pdf")).toBe("cv.PDF");
    expect(nameForConfirmedUpload("cv.docx", "pdf")).toBe("cv.pdf");
    expect(nameForConfirmedUpload("", "docx")).toBe("cv.docx");
  });
});

describe("comprobante de carga del formulario público", () => {
  const ticket = { vacancyCode: "abc123def4", candidateId: CANDIDATE, resumeId: RESUME, kind: "pdf" as const, expiresAt: NOW + UPLOAD_TICKET_TTL_MS };

  it("se verifica con la misma clave y reconstruye la ruta en el servidor", () => {
    const value = signUploadTicket(SECRET, ticket);
    const verified = verifyUploadTicket(SECRET, value, NOW);
    expect(verified).toEqual(ticket);
    expect(ticketStoragePath(verified!)).toBe(`candidates/${CANDIDATE}/${RESUME}.pdf`);
    expect(value).not.toMatch(/@/);
  });

  it("vence en minutos", () => {
    expect(UPLOAD_TICKET_TTL_MS).toBeLessThanOrEqual(15 * 60 * 1000);
    const value = signUploadTicket(SECRET, ticket);
    expect(verifyUploadTicket(SECRET, value, ticket.expiresAt)).not.toBeNull();
    expect(verifyUploadTicket(SECRET, value, ticket.expiresAt + 1)).toBeNull();
  });

  it("rechaza firma distinta, clave distinta, campos alterados y formato inválido", () => {
    const value = signUploadTicket(SECRET, ticket);
    expect(verifyUploadTicket("otra-clave-ficticia-0123456789abcdef0123", value, NOW)).toBeNull();
    const parts = value.split(".");
    const swap = (index: number, replacement: string) => parts.map((part, i) => (i === index ? replacement : part)).join(".");
    expect(verifyUploadTicket(SECRET, swap(1, "11111111-1111-4111-8111-111111111111"), NOW)).toBeNull();
    expect(verifyUploadTicket(SECRET, swap(2, "11111111-1111-4111-8111-111111111111"), NOW)).toBeNull();
    expect(verifyUploadTicket(SECRET, swap(3, "docx"), NOW)).toBeNull();
    expect(verifyUploadTicket(SECRET, swap(0, "zzz123def4"), NOW)).toBeNull();
    expect(verifyUploadTicket(SECRET, swap(5, "AAAA"), NOW)).toBeNull();
    expect(verifyUploadTicket(SECRET, "", NOW)).toBeNull();
    expect(verifyUploadTicket(SECRET, "a.b.c", NOW)).toBeNull();
    expect(verifyUploadTicket(SECRET, value + "x".repeat(400), NOW)).toBeNull();
  });
});

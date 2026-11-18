import { describe, expect, it } from "vitest";
import { reminderSentFor } from "@/modules/interviews/queries";
import { interviewFormSchema, parseInterviewerEmails } from "@/modules/interviews/schemas";
import { buildInterviewerEmail } from "@/modules/notifications/email/templates/interview-interviewer";
import { countCopyRows } from "../../scripts/respaldo/comun";

describe("correos de los entrevistadores", () => {
  const base = { date: "2026-12-01", time: "10:00", durationMinutes: "45", modality: "virtual" as const, location: "https://meet.example/a" };

  it("normaliza: comas, punto y coma o espacios; minúsculas; sin repetidos", () => {
    expect(parseInterviewerEmails(" Ana@Empresa.pe; pedro@empresa.pe ana@empresa.pe,, ")).toEqual(["ana@empresa.pe", "pedro@empresa.pe"]);
    expect(parseInterviewerEmails("")).toEqual([]);
  });

  it("el formulario rechaza correos no válidos y más de 10", () => {
    const invalid = interviewFormSchema.safeParse({ ...base, interviewers: "", instructions: "", interviewerEmails: "ana@empresa.pe, no-es-correo" });
    expect(invalid.success).toBe(false);
    expect(JSON.stringify(invalid.error?.issues)).toMatch(/no-es-correo/);
    const many = Array.from({ length: 11 }, (_, i) => `p${i}@empresa.pe`).join(", ");
    expect(interviewFormSchema.safeParse({ ...base, interviewers: "", instructions: "", interviewerEmails: many }).success).toBe(false);
    expect(interviewFormSchema.safeParse({ ...base, interviewers: "", instructions: "" }).success).toBe(true);
  });
});

describe("correo a entrevistadores", () => {
  const input = {
    candidateName: "Lucía <b>Ramos</b>\nX",
    vacancyTitle: "Analista",
    scheduledAt: "2026-12-01T15:00:00.000Z",
    durationMinutes: 45,
    modality: "virtual" as const,
    location: "https://meet.example/a",
    applicationUrl: "https://app.example/postulaciones/1",
  };

  it("escapa el nombre, lo deja en una línea en el asunto e incluye la ficha", () => {
    const email = buildInterviewerEmail("reminder", input);
    expect(email.subject).toBe("Recordatorio de entrevista: Lucía <b>Ramos</b> X");
    expect(email.html).toContain("Lucía &lt;b&gt;Ramos&lt;/b&gt;");
    expect(email.html).toContain('href="https://app.example/postulaciones/1"');
    expect(email.text).toContain("Ficha de la postulación");
  });

  it("la cancelación no lleva enlace y un enlace que no es http(s) se omite", () => {
    expect(buildInterviewerEmail("cancelled", input).html).not.toContain("postulaciones/1");
    expect(buildInterviewerEmail("invitation", { ...input, applicationUrl: "javascript:alert(1)" }).html).not.toContain("javascript:");
  });
});

describe("recordatorio enviado", () => {
  it("cuenta solo el de la persona candidata y para la fecha vigente", () => {
    const at = "2026-12-01T15:00:00+00:00";
    expect(reminderSentFor(at, [{ scheduled_at: "2026-12-01T15:00:00.000Z", recipient: "candidato", outcome: "enviado" }])).toBe(true);
    expect(reminderSentFor(at, [{ scheduled_at: at, recipient: "jefa@empresa.pe", outcome: "enviado" }])).toBe(false);
    expect(reminderSentFor(at, [{ scheduled_at: "2026-11-30T15:00:00Z", recipient: "candidato", outcome: "enviado" }])).toBe(false);
    expect(reminderSentFor(at, [{ scheduled_at: at, recipient: "candidato", outcome: "enviando" }])).toBe(false);
  });
});

describe("respaldo: filas por tabla del volcado", () => {
  it("cuenta las filas de cada bloque COPY", () => {
    const sql = [
      'COPY "public"."candidates" ("id", "full_name") FROM stdin;',
      "1\tAna",
      "2\tLuis",
      "\\.",
      'COPY "auth"."users" ("id") FROM stdin;',
      "\\.",
    ].join("\n");
    expect(countCopyRows(sql)).toEqual({ "public.candidates": 2, "auth.users": 0 });
  });
});

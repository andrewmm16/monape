import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { BOOKING_PUBLIC_MESSAGES, bookingDeadlineIso, bookingStateOf, inviteToBookSchema, MAX_BOOKING_SLOTS } from "@/modules/interviews/booking";
import { createBookingToken, hashBookingToken } from "@/modules/interviews/booking-token";
import { buildInterviewBookingEmail } from "@/modules/notifications/email/templates/interview-booking";

const APP = "1a2b3c4d-1111-4222-8333-444455556666";
const valid = {
  applicationId: APP,
  slots: [
    { date: "2026-12-01", time: "09:00" },
    { date: "2026-12-01", time: "11:30" },
  ],
  durationMinutes: "45",
  modality: "virtual" as const,
  location: "https://meet.example/abc",
  interviewers: "Ana Ficticia",
  interviewerEmails: "ana@ejemplo.test",
  instructions: "",
  deadlineDate: "",
  deadlineTime: "",
};

describe("enlace de la autoagenda", () => {
  it("el token es aleatorio (32 bytes en base64url) y se guarda solo su sha256", () => {
    const a = createBookingToken();
    const b = createBookingToken();
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.token).not.toBe(b.token);
    expect(a.hash).toBe(createHash("sha256").update(a.token).digest("hex"));
    expect(hashBookingToken(a.token)).toBe(a.hash);
  });
});

describe("formulario «Invitar a agendar»", () => {
  it("acepta de 1 a 6 horarios con los mismos datos que una entrevista", () => {
    expect(inviteToBookSchema.safeParse(valid).success).toBe(true);
    expect(inviteToBookSchema.safeParse({ ...valid, slots: [] }).success).toBe(false);
    const seven = Array.from({ length: MAX_BOOKING_SLOTS + 1 }, (_, i) => ({ date: "2026-12-02", time: `0${i + 1}:00` }));
    expect(inviteToBookSchema.safeParse({ ...valid, slots: seven }).success).toBe(false);
  });

  it("rechaza fechas inválidas, horarios repetidos, un enlace virtual que no es http(s) y correos inválidos", () => {
    expect(inviteToBookSchema.safeParse({ ...valid, slots: [{ date: "2026-13-40", time: "09:00" }] }).success).toBe(false);
    expect(inviteToBookSchema.safeParse({ ...valid, slots: [valid.slots[0], valid.slots[0]] }).success).toBe(false);
    expect(inviteToBookSchema.safeParse({ ...valid, location: "meet.example" }).success).toBe(false);
    expect(inviteToBookSchema.safeParse({ ...valid, interviewerEmails: "no-es-correo" }).success).toBe(false);
  });

  it("el plazo por defecto es 2 horas antes del primer horario; uno indicado se respeta", () => {
    const slots = ["2026-12-01T16:30:00.000Z", "2026-12-01T14:00:00.000Z"];
    expect(bookingDeadlineIso(slots, null)).toBe("2026-12-01T12:00:00.000Z");
    expect(bookingDeadlineIso(slots, "2026-11-30T20:00:00.000Z")).toBe("2026-11-30T20:00:00.000Z");
  });
});

describe("correo de la invitación", () => {
  it("lleva el puesto, cada horario en hora de Lima, el plazo y el enlace; sin datos de otras personas", () => {
    const email = buildInterviewBookingEmail({
      fullName: "Ana Pérez Ficticia",
      companyName: "Empresa Ficticia",
      vacancyTitle: "Asistente de Recursos Humanos",
      durationMinutes: 45,
      modality: "virtual",
      slots: ["2026-12-01T14:00:00.000Z", "2026-12-01T16:30:00.000Z"],
      expiresAt: "2026-12-01T12:00:00.000Z",
      url: "https://app.ejemplo.test/agendar/tok",
    });
    expect(email.subject).toMatch(/Elige el horario de tu entrevista/);
    for (const part of [email.text, email.html]) {
      expect(part).toContain("Asistente de Recursos Humanos");
      expect(part).toContain("https://app.ejemplo.test/agendar/tok");
      expect(part).toMatch(/09:00/); // 14:00 UTC = 09:00 en Lima
      expect(part).toMatch(/11:30/);
    }
    expect(email.text).toMatch(/Hola Ana Pérez Ficticia/);
  });
});

describe("estado de la invitación en la tarjeta «Entrevistas»", () => {
  const now = Date.parse("2026-12-01T12:00:00.000Z");
  it("pendiente mientras puede elegir; vencida sin entrevista; nada si eligió o RRHH la resolvió", () => {
    const b = (status: "pendiente" | "agendada" | "vencida" | "cancelada", expiresAt: string) => ({ status, expiresAt, createdAt: "2026-11-30T10:00:00.000Z" });
    const none = { programmed: false, latestInterviewCreatedAt: null };
    expect(bookingStateOf(b("pendiente", "2026-12-01T13:00:00.000Z"), none, now)).toBe("pendiente");
    expect(bookingStateOf(b("pendiente", "2026-12-01T11:00:00.000Z"), none, now)).toBe("vencida");
    expect(bookingStateOf(b("vencida", "2026-12-01T11:00:00.000Z"), { programmed: true, latestInterviewCreatedAt: null }, now)).toBeNull();
    expect(bookingStateOf(b("agendada", "2026-12-01T13:00:00.000Z"), { programmed: true, latestInterviewCreatedAt: null }, now)).toBeNull();
    expect(bookingStateOf(b("cancelada", "2026-12-01T13:00:00.000Z"), none, now)).toBeNull();
  });
});

describe("revisión final (20/11)", () => {
  it("el aviso «venció» no reaparece si después hubo una entrevista (realizada o cancelada)", () => {
    const now = Date.parse("2026-12-05T12:00:00.000Z");
    const expired = { status: "vencida" as const, expiresAt: "2026-12-01T11:00:00.000Z", createdAt: "2026-11-30T10:00:00.000Z" };
    expect(bookingStateOf(expired, { programmed: false, latestInterviewCreatedAt: "2026-12-02T09:00:00.000Z" }, now)).toBeNull();
    expect(bookingStateOf(expired, { programmed: false, latestInterviewCreatedAt: "2026-11-20T09:00:00.000Z" }, now)).toBe("vencida");
    expect(bookingStateOf(expired, { programmed: false, latestInterviewCreatedAt: null }, now)).toBe("vencida");
  });

  it("el plazo por defecto nunca queda en el pasado: con el primer horario cerca, 30 minutos antes de él", () => {
    const now = Date.parse("2026-12-01T12:00:00.000Z");
    expect(bookingDeadlineIso(["2026-12-01T13:30:00.000Z"], null, now)).toBe("2026-12-01T13:00:00.000Z");
    expect(bookingDeadlineIso(["2026-12-01T18:00:00.000Z"], null, now)).toBe("2026-12-01T16:00:00.000Z");
  });

  it("los mensajes de la página pública tutean, como el resto de la página", () => {
    for (const message of Object.values(BOOKING_PUBLIC_MESSAGES)) {
      expect(message).not.toMatch(/(Recargue|elija|Hizo|Espere|vuelva|Intente|escriba)/);
    }
  });
});

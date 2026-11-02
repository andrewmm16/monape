import { describe, expect, it } from "vitest";
import {
  dayLabel,
  formatDuration,
  groupByDay,
  isoToLima,
  limaDayKey,
  limaToIso,
  safeHttpUrl,
} from "@/modules/interviews/datetime";
import {
  canScheduleInterview,
  cancelInterviewSchema,
  interviewFormSchema,
  recordResultSchema,
} from "@/modules/interviews/schemas";

describe("limaToIso", () => {
  it("convierte fecha y hora de Lima a ISO con -05:00", () => {
    expect(limaToIso("2026-10-30", "15:00")).toBe("2026-10-30T15:00:00-05:00");
    expect(new Date(limaToIso("2026-10-30", "15:00")!).toISOString()).toBe("2026-10-30T20:00:00.000Z");
  });

  it("la medianoche de Lima cae en el día siguiente en UTC", () => {
    expect(new Date(limaToIso("2026-12-31", "23:30")!).toISOString()).toBe("2027-01-01T04:30:00.000Z");
  });

  it("rechaza fechas y horas inválidas", () => {
    expect(limaToIso("2026-02-30", "10:00")).toBeNull();
    expect(limaToIso("2026-13-01", "10:00")).toBeNull();
    expect(limaToIso("2026-10-30", "24:00")).toBeNull();
    expect(limaToIso("2026-10-30", "9:00")).toBeNull();
    expect(limaToIso("30/10/2026", "10:00")).toBeNull();
    expect(limaToIso("", "")).toBeNull();
  });

  it("acepta el 29 de febrero solo en año bisiesto", () => {
    expect(limaToIso("2028-02-29", "08:00")).not.toBeNull();
    expect(limaToIso("2027-02-29", "08:00")).toBeNull();
  });

  it("isoToLima es la operación inversa", () => {
    expect(isoToLima("2026-10-30T20:00:00.000Z")).toEqual({ date: "2026-10-30", time: "15:00" });
    expect(isoToLima("2027-01-01T04:30:00Z")).toEqual({ date: "2026-12-31", time: "23:30" });
    const iso = limaToIso("2026-11-05", "09:45")!;
    expect(isoToLima(iso)).toEqual({ date: "2026-11-05", time: "09:45" });
  });
});

describe("etiquetas de día y agrupación", () => {
  // Miércoles 28/10/2026, 10:00 en Lima.
  const now = new Date("2026-10-28T15:00:00Z");

  it("«Hoy» y «Mañana» según el día de Lima, no el de UTC", () => {
    expect(dayLabel("2026-10-28T23:00:00-05:00", now)).toBe("Hoy");
    // 22:00 en Lima del 28 ya es el 29 en UTC.
    expect(dayLabel("2026-10-29T03:00:00Z", now)).toBe("Hoy");
    expect(dayLabel("2026-10-29T09:00:00-05:00", now)).toBe("Mañana");
    expect(limaDayKey("2026-10-29T03:00:00Z")).toBe("2026-10-28");
  });

  it("otros días: día de la semana y dd/mm", () => {
    expect(dayLabel("2026-10-30T09:00:00-05:00", now)).toBe("viernes 30/10");
    expect(dayLabel("2026-11-02T09:00:00-05:00", now)).toBe("lunes 02/11");
  });

  it("agrupa por día conservando el orden", () => {
    const items = [
      { id: "a", scheduled_at: "2026-10-28T14:00:00-05:00" },
      { id: "b", scheduled_at: "2026-10-28T16:00:00-05:00" },
      { id: "c", scheduled_at: "2026-10-29T09:00:00-05:00" },
      { id: "d", scheduled_at: "2026-10-30T09:00:00-05:00" },
    ];
    const groups = groupByDay(items, now);
    expect(groups.map((g) => g.label)).toEqual(["Hoy", "Mañana", "viernes 30/10"]);
    expect(groups.map((g) => g.items.map((i) => i.id))).toEqual([["a", "b"], ["c"], ["d"]]);
    expect(groupByDay([], now)).toEqual([]);
  });
});

describe("formato y enlaces", () => {
  it("formatea la duración", () => {
    expect(formatDuration(45)).toBe("45 min");
    expect(formatDuration(60)).toBe("1 h");
    expect(formatDuration(90)).toBe("1 h 30 min");
  });

  it("solo los enlaces http(s) son enlaces", () => {
    expect(safeHttpUrl("https://meet.example.test/abc")).toBe("https://meet.example.test/abc");
    expect(safeHttpUrl("http://ejemplo.test")).toBe("http://ejemplo.test/");
    expect(safeHttpUrl("  https://meet.example.test/abc  ")).toBe("https://meet.example.test/abc");
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpUrl("data:text/html,<b>x</b>")).toBeNull();
    expect(safeHttpUrl("ftp://ejemplo.test")).toBeNull();
    expect(safeHttpUrl("Av. Larco 345, oficina 2")).toBeNull();
    expect(safeHttpUrl("https://a.test texto")).toBeNull();
    expect(safeHttpUrl("")).toBeNull();
    expect(safeHttpUrl(null)).toBeNull();
  });
});

describe("esquemas", () => {
  const valid = { date: "2026-10-30", time: "15:00", durationMinutes: "45", modality: "virtual", location: "", interviewers: "", instructions: "" };

  it("valida el formulario de la entrevista", () => {
    expect(interviewFormSchema.safeParse(valid).success).toBe(true);
    expect(interviewFormSchema.safeParse({ ...valid, durationMinutes: "10" }).success).toBe(false);
    expect(interviewFormSchema.safeParse({ ...valid, durationMinutes: "481" }).success).toBe(false);
    expect(interviewFormSchema.safeParse({ ...valid, date: "2026-02-30" }).success).toBe(false);
    expect(interviewFormSchema.safeParse({ ...valid, modality: "otra" }).success).toBe(false);
    expect(interviewFormSchema.safeParse({ ...valid, location: "x".repeat(501) }).success).toBe(false);
  });

  it("«No pasó» exige el motivo; «Pasó» y «No asistió», no", () => {
    const base = { interviewId: "00000000-0000-4000-8000-000000000001", notes: "", verifications: [] };
    expect(recordResultSchema.safeParse({ ...base, outcome: "no_paso" }).success).toBe(false);
    expect(recordResultSchema.safeParse({ ...base, outcome: "no_paso", notes: "ab" }).success).toBe(false);
    expect(recordResultSchema.safeParse({ ...base, outcome: "no_paso", notes: "No cumple" }).success).toBe(true);
    expect(recordResultSchema.safeParse({ ...base, outcome: "paso" }).success).toBe(true);
    expect(recordResultSchema.safeParse({ ...base, outcome: "no_asistio" }).success).toBe(true);
    expect(recordResultSchema.safeParse({ ...base, outcome: "otro" }).success).toBe(false);
  });

  it("limita las verificaciones a 30 y la nota a 3-1000 caracteres", () => {
    const item = (i: number, note = "") => ({
      requirementId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      result: "acreditado" as const,
      note,
    });
    const base = { interviewId: "00000000-0000-4000-8000-000000000001", outcome: "paso" as const, notes: "" };
    expect(recordResultSchema.safeParse({ ...base, verifications: Array.from({ length: 30 }, (_, i) => item(i + 1)) }).success).toBe(true);
    expect(recordResultSchema.safeParse({ ...base, verifications: Array.from({ length: 31 }, (_, i) => item(i + 1)) }).success).toBe(false);
    expect(recordResultSchema.safeParse({ ...base, verifications: [item(1, "ab")] }).success).toBe(false);
    expect(recordResultSchema.safeParse({ ...base, verifications: [item(1, "Lo explicó bien")] }).success).toBe(true);
  });

  it("cancelar exige motivo", () => {
    expect(cancelInterviewSchema.safeParse({ interviewId: "00000000-0000-4000-8000-000000000001", reason: " " }).success).toBe(false);
    expect(cancelInterviewSchema.safeParse({ interviewId: "00000000-0000-4000-8000-000000000001", reason: "Pidió otra fecha" }).success).toBe(true);
  });

  it("solo se programa en postulaciones abiertas de vacantes no archivadas", () => {
    expect(canScheduleInterview("preseleccionado", "publicada")).toBe(true);
    expect(canScheduleInterview("en_reserva", "publicada")).toBe(true);
    expect(canScheduleInterview("no_seleccionado", "publicada")).toBe(false);
    expect(canScheduleInterview("seleccionado", "publicada")).toBe(false);
    expect(canScheduleInterview("retirado", "cerrada")).toBe(false);
    expect(canScheduleInterview("nuevo", "archivada")).toBe(false);
  });
});

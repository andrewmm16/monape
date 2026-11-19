import { describe, expect, it } from "vitest";
import {
  AUTHORITY_NAME,
  addBusinessDays,
  compareIncidents,
  describeHours,
  easterSunday,
  incidentSteps,
  isPeruHoliday,
  notificationDeadline,
  reviewDeadline,
  type DeadlineIncident,
  type StepsIncident,
} from "@/modules/incidents/deadlines";
import { limaLocalToIso } from "@/modules/incidents/schemas";

const detectedAt = "2026-11-19T15:00:00Z";
const incident: DeadlineIncident = { severity: "alta", isDrill: false, affectedData: "", detectedAt };
const at = (hours: number) => new Date(new Date(detectedAt).getTime() + hours * 3_600_000);

describe("plazo de aviso a la Autoridad (48 h)", () => {
  it("vence 48 h después de detectado y cuenta las horas que quedan", () => {
    const deadline = notificationDeadline(incident, [], at(10));
    expect(deadline.applies).toBe(true);
    expect(deadline.dueAt.toISOString()).toBe("2026-11-21T15:00:00.000Z");
    expect(deadline.hoursRemaining).toBeCloseTo(38);
    expect(deadline.overdue).toBe(false);
    expect(deadline.urgent).toBe(false);
    expect(describeHours(deadline.hoursRemaining)).toBe("quedan 38 h 0 min");
  });

  it("se pone urgente con menos de 12 h y cuando vence", () => {
    expect(notificationDeadline(incident, [], at(37)).urgent).toBe(true);
    expect(notificationDeadline(incident, [], at(35)).urgent).toBe(false);
    const late = notificationDeadline(incident, [], at(50));
    expect(late.overdue).toBe(true);
    expect(late.urgent).toBe(true);
    expect(describeHours(late.hoursRemaining)).toBe("venció hace 2 h 0 min");
  });

  it("se cumple con una notificación a la Autoridad, no con otras", () => {
    const others = [
      { kind: "notificacion", recipient: "Personas afectadas" },
      { kind: "accion", recipient: null },
    ] as const;
    expect(notificationDeadline(incident, others, at(50)).fulfilled).toBe(false);
    const done = notificationDeadline(incident, [{ kind: "notificacion", recipient: AUTHORITY_NAME }], at(50));
    expect(done.fulfilled).toBe(true);
    expect(done.urgent).toBe(false);
  });

  it("aplica a gravedad alta o media, o si hay datos afectados; no a baja sin datos", () => {
    expect(notificationDeadline({ ...incident, severity: "media" }, [], at(1)).applies).toBe(true);
    expect(notificationDeadline({ ...incident, severity: "baja" }, [], at(1)).applies).toBe(false);
    expect(notificationDeadline({ ...incident, severity: "baja", affectedData: "Correos de candidatos" }, [], at(1)).applies).toBe(true);
  });

  it("un simulacro se calcula igual, marcado como práctica", () => {
    const drill = notificationDeadline({ ...incident, isDrill: true }, [], at(10));
    expect(drill.practice).toBe(true);
    expect(drill.applies).toBe(true);
    expect(drill.hoursRemaining).toBeCloseTo(38);
  });
});

describe("plazo de la revisión (5 días hábiles)", () => {
  it("salta el fin de semana", () => {
    // Jueves 19/11/2026 + 5 días hábiles = jueves 26/11.
    expect(addBusinessDays(new Date("2026-11-19T00:00:00Z"), 5).toISOString().slice(0, 10)).toBe("2026-11-26");
    // Viernes 20/11 + 5 = viernes 27/11 (cruza un fin de semana); sábado 21/11 + 1 = lunes 23/11.
    expect(addBusinessDays(new Date("2026-11-20T00:00:00Z"), 5).toISOString().slice(0, 10)).toBe("2026-11-27");
    expect(addBusinessDays(new Date("2026-11-21T00:00:00Z"), 1).toISOString().slice(0, 10)).toBe("2026-11-23");
  });

  it("salta los feriados nacionales de Perú", () => {
    // Lunes 27/07/2026: el 28 y el 29 son Fiestas Patrias → 30, 31, 3/8, 4/8 y 5/8.
    expect(addBusinessDays(new Date("2026-07-27T00:00:00Z"), 5).toISOString().slice(0, 10)).toBe("2026-08-05");
    // Miércoles 02/12/2026: el 8 y el 9 son feriados → 3, 4, 7, 10 y 11.
    expect(addBusinessDays(new Date("2026-12-02T00:00:00Z"), 5).toISOString().slice(0, 10)).toBe("2026-12-11");
    // Miércoles 01/04/2026: Jueves y Viernes Santo (2 y 3 de abril) → lunes 6.
    expect(addBusinessDays(new Date("2026-04-01T00:00:00Z"), 1).toISOString().slice(0, 10)).toBe("2026-04-06");
  });

  it("los 16 feriados de 2026, con Semana Santa calculada", () => {
    const holidays: string[] = [];
    for (let day = new Date("2026-01-01T00:00:00Z"); day.getUTCFullYear() === 2026; day.setUTCDate(day.getUTCDate() + 1)) {
      if (isPeruHoliday(day)) holidays.push(day.toISOString().slice(5, 10));
    }
    expect(holidays).toEqual([
      "01-01", "04-02", "04-03", "05-01", "06-07", "06-29", "07-23", "07-28",
      "07-29", "08-06", "08-30", "10-08", "11-01", "12-08", "12-09", "12-25",
    ]);
    // Pascua en otros años (gregoriano): 20/04/2025, 28/03/2027 y 16/04/2028.
    expect(["2025", "2027", "2028"].map((y) => easterSunday(Number(y)).toISOString().slice(0, 10))).toEqual([
      "2025-04-20",
      "2027-03-28",
      "2028-04-16",
    ]);
  });

  it("cuenta desde el cierre en hora de Lima y solo aplica a gravedad media o alta", () => {
    // 20/11 a las 21:00 en Lima ya es 21/11 en UTC: el día civil sigue siendo el 20 (viernes).
    const closedAt = "2026-11-21T02:00:00Z";
    const review = reviewDeadline({ severity: "alta", closedAt, reviewDoneAt: null }, new Date("2026-11-25T17:00:00Z"));
    expect(review).toMatchObject({ applies: true, dueDate: "2026-11-27", done: false, overdue: false, daysRemaining: 2 });
    expect(reviewDeadline({ severity: "baja", closedAt, reviewDoneAt: null }).applies).toBe(false);
    expect(reviewDeadline({ severity: "media", closedAt: null, reviewDoneAt: null }).applies).toBe(false);
  });

  it("vence al pasar el último día y deja de vencer si ya se hizo", () => {
    const closedAt = "2026-11-19T15:00:00Z";
    const late = new Date("2026-11-27T17:00:00Z");
    expect(reviewDeadline({ severity: "media", closedAt, reviewDoneAt: null }, late).overdue).toBe(true);
    expect(reviewDeadline({ severity: "media", closedAt, reviewDoneAt: "2026-11-24T15:00:00Z" }, late)).toMatchObject({ done: true, overdue: false });
  });
});

describe("los 6 pasos de la política", () => {
  const base: StepsIncident = { ...incident, status: "abierto", affectedPeople: null, closedAt: null, reviewDoneAt: null };
  const states = (data: StepsIncident, events: Parameters<typeof incidentSteps>[1] = []) =>
    Object.fromEntries(incidentSteps(data, events, at(5)).map((step) => [step.key, step.state]));

  it("son seis, en el orden de la política", () => {
    expect(incidentSteps(base, [], at(5)).map((step) => step.label)).toEqual([
      "Contener",
      "Preservar la evidencia",
      "Evaluar el alcance",
      "Notificar",
      "Recuperar",
      "Cerrar y aprender",
    ]);
  });

  it("al inicio todo está pendiente", () => {
    expect(states(base)).toEqual({ contener: "pendiente", preservar: "pendiente", evaluar: "pendiente", notificar: "pendiente", recuperar: "pendiente", cerrar: "pendiente" });
  });

  it("se derivan del estado y de la bitácora", () => {
    const events = [
      { kind: "accion", recipient: null },
      { kind: "notificacion", recipient: AUTHORITY_NAME },
    ] as const;
    expect(states({ ...base, status: "contenido", affectedData: "CV", affectedPeople: 3 }, events)).toEqual({
      contener: "hecho",
      preservar: "hecho",
      evaluar: "hecho",
      notificar: "hecho",
      recuperar: "pendiente",
      cerrar: "pendiente",
    });
  });

  it("cerrar y aprender exige la revisión en gravedad alta o media", () => {
    const closed: StepsIncident = { ...base, status: "cerrado", closedAt: "2026-11-19T20:00:00Z" };
    expect(states(closed)).toMatchObject({ recuperar: "hecho", cerrar: "pendiente" });
    expect(states({ ...closed, reviewDoneAt: "2026-11-20T15:00:00Z" }).cerrar).toBe("hecho");
    expect(states({ ...closed, severity: "baja" }).cerrar).toBe("hecho");
  });

  it("notificar no aplica en gravedad baja sin datos afectados", () => {
    expect(states({ ...base, severity: "baja" }).notificar).toBe("no_aplica");
  });
});

describe("orden y fechas", () => {
  it("los abiertos primero y, dentro de cada estado, lo más reciente", () => {
    const list = [
      { status: "cerrado", detectedAt: "2026-11-20T00:00:00Z" },
      { status: "abierto", detectedAt: "2026-11-01T00:00:00Z" },
      { status: "contenido", detectedAt: "2026-11-10T00:00:00Z" },
      { status: "abierto", detectedAt: "2026-11-15T00:00:00Z" },
    ] as const;
    expect([...list].sort(compareIncidents).map((item) => item.detectedAt.slice(0, 10))).toEqual([
      "2026-11-15",
      "2026-11-01",
      "2026-11-10",
      "2026-11-20",
    ]);
  });

  it("la hora que escribe la persona se toma como hora de Perú y no puede estar en el futuro", () => {
    const now = new Date("2026-11-19T20:00:00Z");
    expect(limaLocalToIso("2026-11-19T10:30", now)).toBe("2026-11-19T15:30:00.000Z");
    expect(limaLocalToIso("2026-11-19T16:00", now)).toBeNull();
    expect(limaLocalToIso("ayer", now)).toBeNull();
  });
});

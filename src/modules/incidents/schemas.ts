import { z } from "zod";
import { isoToLima } from "@/modules/interviews/datetime";
import { AUTHORITY_NAME } from "./deadlines";

export const SEVERITY_LABELS = { alta: "Alta", media: "Media", baja: "Baja" } as const;
export const STATUS_LABELS = { abierto: "Abierto", contenido: "Contenido", cerrado: "Cerrado" } as const;
export const EVENT_KIND_LABELS = { accion: "Acción", notificacion: "Notificación", nota: "Nota" } as const;

/** Destinatarios habituales de una notificación; «otro» pide el nombre. */
export const RECIPIENT_PRESETS = [
  AUTHORITY_NAME,
  "Personas afectadas",
  "Centro Nacional de Seguridad Digital",
] as const;

const localDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Indique la fecha y la hora");

/** Fecha y hora escritas en hora de Perú (UTC−5, sin horario de verano) → ISO; null si no es válida o está en el futuro. */
export function limaLocalToIso(value: string, now: Date = new Date()): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const date = new Date(`${value}:00-05:00`);
  if (Number.isNaN(date.getTime())) return null;
  // Margen de 5 minutos por diferencias entre relojes.
  if (date.getTime() > now.getTime() + 5 * 60_000) return null;
  return date.toISOString();
}

const optionalCount = z
  .string()
  .trim()
  .transform((value) => (value === "" ? null : Number(value)))
  .pipe(z.number().int("Indique un número entero").min(0, "No puede ser negativo").max(10_000_000, "Número demasiado grande").nullable());

export const incidentFormSchema = z.object({
  title: z.string().trim().min(1, "Indique el título").max(200, "Máximo 200 caracteres"),
  detectedAt: localDateTime,
  detectedBy: z.string().trim().max(200, "Máximo 200 caracteres"),
  severity: z.enum(["alta", "media", "baja"]),
  description: z.string().trim().max(5000, "Máximo 5000 caracteres"),
  affectedData: z.string().trim().max(2000, "Máximo 2000 caracteres"),
  affectedPeople: optionalCount,
  sensitiveData: z.boolean(),
});
export type IncidentFormInput = z.input<typeof incidentFormSchema>;
export type IncidentFormValues = z.output<typeof incidentFormSchema>;

export const eventFormSchema = z
  .object({
    kind: z.enum(["accion", "notificacion", "nota"]),
    description: z.string().trim().min(1, "Describa lo ocurrido").max(2000, "Máximo 2000 caracteres"),
    recipient: z.string().trim().max(200, "Máximo 200 caracteres"),
    occurredAt: localDateTime,
  })
  .superRefine((value, ctx) => {
    if (value.kind === "notificacion" && value.recipient === "") {
      ctx.addIssue({ code: "custom", path: ["recipient"], message: "Indique a quién se avisó" });
    }
  });
export type EventFormInput = z.input<typeof eventFormSchema>;

export const closeFormSchema = z.object({
  cause: z.string().trim().min(1, "Indique la causa").max(5000, "Máximo 5000 caracteres"),
  prevention: z.string().trim().min(1, "Indique qué se cambió para que no se repita").max(5000, "Máximo 5000 caracteres"),
});
export type CloseFormInput = z.input<typeof closeFormSchema>;

export const reviewFormSchema = z.object({
  notes: z.string().trim().min(1, "Resuma la revisión: qué pasó, qué funcionó y qué no").max(5000, "Máximo 5000 caracteres"),
});
export type ReviewFormInput = z.input<typeof reviewFormSchema>;

export const officerFormSchema = z.object({
  name: z.string().trim().min(1, "Indique el nombre").max(200, "Máximo 200 caracteres"),
  email: z.string().trim().max(254, "Máximo 254 caracteres").pipe(z.email("Indique un correo válido")),
});
export type OfficerFormInput = z.input<typeof officerFormSchema>;

/** El simulacro sugerido por la política (punto 8). Sin valores de secretos. */
export const DRILL_CASE = {
  title: "Simulacro: la clave del worker de IA apareció en un chat",
  description:
    "Caso de práctica de la política de incidentes: alguien pegó la clave del worker de IA en un chat. Recorra los pasos, rote la clave " +
    "(IA_WORKER_SECRET, en Vercel y en la PC del robot), cronometre cuánto tarda y anote lo que no estuvo claro.",
  affectedData: "Clave del worker de IA (IA_WORKER_SECRET). Sin datos de candidatos expuestos.",
  detectedBy: "Administración (simulacro)",
} as const;

/** Ahora, en hora de Perú, con el formato del campo «fecha y hora» (aaaa-mm-ddThh:mm). */
export function nowLimaInput(now: Date = new Date()): string {
  const { date, time } = isoToLima(now);
  return `${date}T${time}`;
}

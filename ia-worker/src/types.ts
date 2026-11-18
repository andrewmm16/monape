import { z } from "zod";

/** Trabajo que entrega la app (`POST /api/ia/trabajos/siguiente`): el prompt ya armado. */
export const jobSchema = z.object({
  id: z.uuid(),
  /** Identifica esta reserva; se devuelve con el resultado. */
  claimToken: z.uuid(),
  attempt: z.number().int().min(1),
  model: z.string().min(1).max(100),
  effort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
  system: z.string().min(1),
  prompt: z.string().min(1),
  schema: z.record(z.string(), z.unknown()),
});

export type Job = z.infer<typeof jobSchema>;

export const claimResponseSchema = z.object({
  job: jobSchema.nullable(),
  /** La app tiene la IA apagada o sin aprobación: no hay trabajo que hacer. */
  paused: z.boolean().optional(),
});

/** Lo que el worker informa a la app (`POST /api/ia/trabajos/[id]/resultado`). */
export type Report =
  | { outcome: "ok"; output: unknown; model?: string }
  | { outcome: "limite"; errorCode: "limite_plan" | "sin_sesion" | "worker_no_disponible"; retryAt?: string }
  | { outcome: "error"; errorCode: string; retryable: boolean };

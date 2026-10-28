import { AppError, toAppError, type AppErrorCode } from "@/lib/errors";

/** Error con el código HTTP que debe recibir Talent.com. */
export class TalentApplyError extends Error {
  readonly status: number;
  /** Código corto para la respuesta; nunca datos personales. */
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.name = "TalentApplyError";
    this.status = status;
    this.code = code;
  }
}

const STATUS_BY_APP_ERROR: Record<AppErrorCode, number> = {
  unauthenticated: 500,
  forbidden: 500,
  validation: 422,
  not_found: 404,
  // Un conflicto inesperado (unicidad, clave foránea) no es una vacante cerrada:
  // 410 podría hacer que Talent.com no reintente y se pierda la postulación.
  conflict: 500,
  rate_limited: 429,
  unavailable: 500,
  internal: 500,
};

/**
 * Código HTTP de cualquier error del flujo: errores propios, de la aplicación
 * o de PostgREST (RH404 → 404, RH409 → 410, RH422 → 422, 23514 → 422). Solo
 * RH409, que la función de registro usa para la vacante cerrada o vencida, da 410.
 */
export function mapTalentApplyError(error: unknown): number {
  if (error instanceof TalentApplyError) return error.status;
  if (error instanceof AppError) return STATUS_BY_APP_ERROR[error.code];
  if (typeof error === "object" && error !== null && "code" in error) {
    if ((error as { code?: unknown }).code === "RH409") return 410;
    return STATUS_BY_APP_ERROR[toAppError(error as { code?: string; message?: string }).code];
  }
  return 500;
}

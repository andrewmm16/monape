export type AppErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "validation"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "unavailable"
  | "internal";

/** Error con mensaje seguro para mostrar al usuario (sin detalles internos). */
export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly fieldErrors?: Record<string, string[]>;

  constructor(message: string, code: AppErrorCode = "internal", fieldErrors?: Record<string, string[]>) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

type DbErrorLike = { code?: string; message?: string } | null | undefined;

type DbErrorContext = {
  /** Mensaje para violaciones de unicidad (23505). */
  conflict?: string;
  /** Mensaje cuando el registro no existe o no es visible para el usuario. */
  notFound?: string;
};

/**
 * Traduce un error de PostgREST/PostgreSQL a un AppError con un mensaje en
 * español que no revela estructura interna, consultas ni datos.
 */
export function toAppError(error: DbErrorLike, context: DbErrorContext = {}): AppError {
  const code = error?.code ?? "";
  if (code === "42501") {
    return new AppError("No tiene permisos para realizar esta acción.", "forbidden");
  }
  if (code.startsWith("RH")) {
    // Mensajes redactados en las migraciones para mostrarse al usuario.
    const map: Record<string, AppErrorCode> = { RH404: "not_found", RH409: "conflict", RH422: "validation" };
    return new AppError(error?.message ?? "Operación no permitida.", map[code] ?? "validation");
  }
  switch (code) {
    case "23505":
      return new AppError(context.conflict ?? "El registro ya existe.", "conflict");
    case "23503":
      return new AppError("El registro está relacionado con otros datos.", "conflict");
    case "23514":
    case "22P02":
    case "22001":
      return new AppError("Los datos enviados no son válidos.", "validation");
    case "PGRST116":
      return new AppError(context.notFound ?? "El registro no existe o no tiene acceso.", "not_found");
    default:
      return new AppError("No se pudo completar la operación. Intente nuevamente.", "internal");
  }
}

/** Registra un error en el servidor sin volcar datos personales. */
export function logServerError(scope: string, error: unknown): void {
  if (error instanceof AppError) {
    console.warn(`[${scope}] ${error.code}: ${error.message}`);
    return;
  }
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "sin-codigo";
  const name = error instanceof Error ? error.name : typeof error;
  console.error(`[${scope}] error inesperado (${name}, código ${code})`);
}

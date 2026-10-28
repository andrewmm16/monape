import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { AppError, logServerError } from "@/lib/errors";

export type ActionResult<T = null> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

/**
 * Ejecuta la lógica de una Server Action y convierte los errores en un
 * resultado serializable. Los errores inesperados se registran sin detalles
 * sensibles y se muestran con un mensaje genérico.
 */
export async function runAction<T>(
  scope: string,
  fn: () => Promise<T>,
  successMessage?: string,
): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data, message: successMessage };
  } catch (error) {
    unstable_rethrow(error);
    logServerError(scope, error);
    if (error instanceof AppError) {
      return { ok: false, error: error.message, fieldErrors: error.fieldErrors };
    }
    return { ok: false, error: "Ocurrió un error inesperado. Intente nuevamente." };
  }
}

/** Valida la entrada con Zod y lanza un AppError con errores por campo. */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join(".") || "_";
      (fieldErrors[key] ??= []).push(issue.message);
    }
    throw new AppError("Revise los datos ingresados.", "validation", fieldErrors);
  }
  return parsed.data;
}

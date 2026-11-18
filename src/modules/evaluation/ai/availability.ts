export type AiSettings = {
  AI_PROVIDER: "none" | "anthropic" | "claude-cli";
  AI_API_KEY?: string;
  AI_MODEL: string;
  AI_EXTERNAL_PROCESSING_APPROVED: boolean;
  AI_WORKER_SECRET?: string;
};

export type AiAvailability =
  | {
      available: true;
      provider: "anthropic" | "claude-cli";
      model: string;
      /**
       * true: la evaluación se encola y la procesa el worker (`claude-cli`).
       * false: se consulta a la API dentro de la solicitud (`anthropic`).
       */
      queued: boolean;
    }
  | { available: false; reason: string };

/**
 * La evaluación con IA solo se habilita si hay proveedor configurado (clave de
 * la API o secreto del worker) Y la empresa aprobó expresamente el envío de CV
 * a ese proveedor.
 */
export function getAiAvailability(settings: AiSettings): AiAvailability {
  if (settings.AI_PROVIDER === "none") {
    return { available: false, reason: "La evaluación con IA está deshabilitada en esta instalación." };
  }
  if (!settings.AI_EXTERNAL_PROCESSING_APPROVED) {
    return {
      available: false,
      reason:
        "Pendiente de aprobación: la empresa aún no autorizó el envío de CV al proveedor de IA ni el tratamiento de datos correspondiente.",
    };
  }
  if (settings.AI_PROVIDER === "claude-cli") {
    if (!settings.AI_WORKER_SECRET) {
      return { available: false, reason: "Falta configurar el secreto del worker de IA." };
    }
    return { available: true, provider: "claude-cli", model: settings.AI_MODEL, queued: true };
  }
  if (!settings.AI_API_KEY) {
    return { available: false, reason: "Falta configurar la clave del proveedor de IA." };
  }
  return { available: true, provider: settings.AI_PROVIDER, model: settings.AI_MODEL, queued: false };
}

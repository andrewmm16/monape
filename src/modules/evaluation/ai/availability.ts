export type AiSettings = {
  AI_PROVIDER: "none" | "anthropic";
  AI_API_KEY?: string;
  AI_MODEL: string;
  AI_EXTERNAL_PROCESSING_APPROVED: boolean;
};

export type AiAvailability =
  | { available: true; provider: "anthropic"; model: string }
  | { available: false; reason: string };

/**
 * La evaluación con IA solo se habilita si hay proveedor y clave configurados
 * Y la empresa aprobó expresamente el envío de CV a ese proveedor.
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
  if (!settings.AI_API_KEY) {
    return { available: false, reason: "Falta configurar la clave del proveedor de IA." };
  }
  return { available: true, provider: settings.AI_PROVIDER, model: settings.AI_MODEL };
}

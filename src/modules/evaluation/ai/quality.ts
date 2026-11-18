import { z } from "zod";

/**
 * Vigilancia semanal de la IA: el resumen que manda el worker tras medir al
 * modelo contra la vara del banco (`npm run vigilar:ia` → `medir:ia --resumen`) y
 * las reglas que deciden si hay que avisar a administración.
 *
 * Umbrales (medido el 18/11/2026 con Haiku y el prompt v5: Motor+IA 97-98 %,
 * 1 acreditación de más, 0 fallos): dejan margen para la variación normal de
 * Haiku entre corridas (~8 casillas) y saltan ante una caída real, p. ej. cuando
 * Anthropic actualiza el modelo.
 */
export const QUALITY_THRESHOLDS = {
  /** Mínimo de Motor+IA contando «pendiente» = «sin evidencia» (la política real, en el puntaje). */
  relayLenientMin: 0.95,
  /** Máximo de casillas que la IA acredita de más (el error más caro). */
  overAccreditedMax: 2,
  /** Máximo de CV con fallo de la IA (respuesta inválida, límite…), como fracción. */
  failureRatioMax: 0.1,
} as const;

const fraction = z.number().min(0).max(1);
const count = z.number().int().min(0).max(100_000);

export const qualityReportSchema = z.object({
  fecha: z.iso.datetime({ offset: true }).optional(),
  modelo: z.string().regex(/^[A-Za-z0-9._:\-[\]]{1,100}$/),
  prompt: z.string().regex(/^[a-z0-9.-]{1,40}$/),
  cv: count,
  fallos: count,
  inversionesIa: count.default(0),
  segundosPorCv: z.number().min(0).max(100_000).optional(),
  vara: z
    .object({
      casillas: count,
      motor: fraction,
      ia: fraction,
      motorIa: fraction,
      motorIaLaxo: fraction,
      iaLaxo: fraction.optional(),
      iaAcreditoDeMas: count,
    })
    .nullable(),
});

export type QualityReport = z.infer<typeof qualityReportSchema>;

const pct = (value: number) => `${(100 * value).toFixed(1).replace(".", ",")} %`;

/** ¿Hay que avisar? Devuelve el estado y los motivos, en frases para administración. */
export function assessQuality(report: QualityReport): { status: "ok" | "alerta"; reasons: string[] } {
  const reasons: string[] = [];
  const t = QUALITY_THRESHOLDS;
  if (report.cv === 0) reasons.push("No se evaluó ningún CV.");
  else if (report.fallos / report.cv > t.failureRatioMax) reasons.push(`Fallaron ${report.fallos} de ${report.cv} CV (respuesta inválida o sin servicio).`);
  if (!report.vara || report.vara.casillas === 0) {
    reasons.push("No se pudo comparar con la vara (sin casillas).");
  } else {
    if (report.vara.motorIaLaxo < t.relayLenientMin) {
      reasons.push(`El acierto de motor + IA bajó a ${pct(report.vara.motorIaLaxo)} (mínimo ${pct(t.relayLenientMin)}).`);
    }
    if (report.vara.iaAcreditoDeMas > t.overAccreditedMax) {
      reasons.push(`La IA acreditó de más ${report.vara.iaAcreditoDeMas} requisitos (máximo ${t.overAccreditedMax}).`);
    }
  }
  return { status: reasons.length > 0 ? "alerta" : "ok", reasons };
}

import { formatDuration, formatInterviewDateTime, safeHttpUrl } from "@/modules/interviews/datetime";
import { escapeHtml } from "./html";

/** Datos de la entrevista que comparten las tres plantillas. Sin datos sensibles. */
export type InterviewEmailDetails = {
  fullName: string;
  companyName?: string;
  vacancyTitle?: string | null;
  /** Instante ISO de la entrevista; se muestra en hora de Lima. */
  scheduledAt: string;
  durationMinutes: number;
  modality: "presencial" | "virtual" | "telefonica";
  /** Dirección o enlace de la reunión, o indicación para la llamada. */
  location?: string | null;
  instructions?: string | null;
};

// Texto local de la modalidad (no se edita `src/lib/labels.ts`).
const MODALITY_TEXT: Record<InterviewEmailDetails["modality"], string> = {
  presencial: "Presencial",
  virtual: "Virtual",
  telefonica: "Telefónica",
};

export function companyOf(details: { companyName?: string }): string {
  return details.companyName?.trim() || "nuestro equipo de Recursos Humanos";
}

export function nameOf(details: { fullName: string }): string {
  return details.fullName.trim() || "postulante";
}

function locationLabel(modality: InterviewEmailDetails["modality"]): string {
  if (modality === "presencial") return "Lugar";
  if (modality === "virtual") return "Enlace o indicación";
  return "Indicación";
}

type Line = { label: string; value: string; href?: string };

function linesOf(details: InterviewEmailDetails): Line[] {
  const lines: Line[] = [];
  const vacancy = details.vacancyTitle?.trim();
  if (vacancy) lines.push({ label: "Puesto", value: vacancy });
  lines.push({ label: "Fecha y hora (hora de Lima)", value: formatInterviewDateTime(details.scheduledAt) });
  lines.push({ label: "Duración aproximada", value: formatDuration(details.durationMinutes) });
  lines.push({ label: "Modalidad", value: MODALITY_TEXT[details.modality] });
  const location = details.location?.trim();
  if (location) {
    const href = details.modality === "virtual" ? safeHttpUrl(location) : null;
    lines.push({ label: locationLabel(details.modality), value: location, ...(href ? { href } : {}) });
  }
  const instructions = details.instructions?.trim();
  if (instructions) lines.push({ label: "Indicaciones", value: instructions });
  return lines;
}

/** Datos de la entrevista en texto plano. */
export function detailsText(details: InterviewEmailDetails): string {
  return linesOf(details)
    .map((line) => `- ${line.label}: ${line.value}`)
    .join("\n");
}

/** Datos de la entrevista como lista HTML (todo escapado). */
export function detailsHtml(details: InterviewEmailDetails): string {
  const items = linesOf(details).map((line) => {
    const value = line.href
      ? `<a href="${escapeHtml(line.href)}">${escapeHtml(line.value)}</a>`
      : escapeHtml(line.value).replaceAll("\n", "<br>");
    return `<li><strong>${escapeHtml(line.label)}:</strong> ${value}</li>`;
  });
  return `<ul>${items.join("")}</ul>`;
}

export function wrapHtml(body: string): string {
  return `<!doctype html>
<html lang="es"><body style="font-family:Arial,Helvetica,sans-serif;color:#1f2937;line-height:1.5">
${body}
<p>Saludos cordiales,<br>Recursos Humanos</p>
</body></html>`;
}

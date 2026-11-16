import { CANDIDATE_SOURCE_LABELS, COMPATIBILITY_LEVEL_LABELS, APPLICATION_STATUS_LABELS } from "@/lib/labels";
import type { Enums } from "@/types/database";

export type ExportRow = {
  candidateName: string;
  email: string | null;
  phone: string | null;
  location: string | null;
  source: Enums<"candidate_source">;
  status: Enums<"application_status">;
  appliedAt: string | null;
  level: Enums<"compatibility_level"> | null;
  score: number | null;
  reviewStatus: Enums<"evaluation_review_status"> | null;
};

export const CSV_HEADERS = [
  "Candidato",
  "Correo",
  "Teléfono",
  "Ubicación",
  "Fuente",
  "Estado",
  "Fecha de postulación",
  "Nivel de compatibilidad",
  "Puntaje (%)",
  "Revisión de RRHH",
] as const;

/**
 * Escapa una celda: comillas dobles RFC 4180 y neutralización de inyección de
 * fórmulas (Excel/Sheets ejecutan celdas que empiezan por = + - @ o control).
 */
export function csvCell(value: string | number | null | undefined): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildApplicationsCsv(rows: ExportRow[]): string {
  const lines = [CSV_HEADERS.map(csvCell).join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.candidateName,
        row.email,
        row.phone,
        row.location,
        CANDIDATE_SOURCE_LABELS[row.source],
        APPLICATION_STATUS_LABELS[row.status],
        row.appliedAt ? row.appliedAt.slice(0, 10) : "",
        row.level ? COMPATIBILITY_LEVEL_LABELS[row.level] : "Sin evaluar",
        row.score === null ? "" : Number(row.score).toFixed(1),
        row.reviewStatus === null ? "" : row.reviewStatus === "revisada" ? "Revisada" : "Pendiente de revisión",
      ]
        .map(csvCell)
        .join(","),
    );
  }
  // BOM para que Excel interprete UTF-8; CRLF según RFC 4180.
  return `﻿${lines.join("\r\n")}\r\n`;
}

/** Nombre de archivo seguro (solo ASCII) a partir de un identificador. */
export function exportFilename(vacancyId: string, date = new Date()): string {
  return `postulaciones-${vacancyId.slice(0, 8)}-${date.toISOString().slice(0, 10)}.csv`;
}

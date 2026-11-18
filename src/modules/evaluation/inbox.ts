import type { Enums } from "@/types/database";
import type { GuideQuestion } from "./interview-guide";

/**
 * Bandeja «lo que necesita una persona» de una vacante: en vez de abrir CV por CV,
 * RRHH ve a los candidatos en proceso agrupados por lo que hace falta hacer.
 *
 * - Listos para entrevistar: el CV acredita todos los obligatorios (o RRHH ya
 *   los verificó). Por puntuación.
 * - Por confirmar: les falta algún obligatorio, pero ya tienen compatibilidad
 *   parcial (≥ 40 %) o el CV da un indicio de lo que falta (por confirmar, o
 *   acreditado con duda de la IA). Una llamada, un documento o la entrevista lo
 *   resuelven. Por puntuación.
 * - Sin evidencia de los obligatorios: menos de 40 % y el CV no menciona lo
 *   obligatorio que falta (ni un indicio). Solo se listan; nada se descarta.
 *
 * El máximo alcanzable no sirve para separarlos: con el motor, que casi nunca dice
 * «no cumple», es ~100 % para casi todos (medido en el set de demo).
 * Pura y determinista.
 */

/** Puntuación de «compatibilidad parcial» (LEVEL_RULES en scoring.ts). */
export const INBOX_PARTIAL_SCORE = 40;

export type InboxCandidate = {
  applicationId: string;
  candidateName: string;
  status: Enums<"application_status">;
  score: number;
  potential: number;
  guide: GuideQuestion[];
};

export type InboxEntry = InboxCandidate & {
  /** Obligatorios por confirmar (en el orden de la guía). */
  mandatory: GuideQuestion[];
  /** Deseables por confirmar. */
  optionalCount: number;
};

export type Inbox = {
  ready: InboxEntry[];
  toConfirm: InboxEntry[];
  noEvidence: InboxEntry[];
  /** En proceso, pero sin evaluación vigente. */
  notEvaluated: number;
};

/** ¿El CV da un indicio de este obligatorio? (por confirmar, o acreditado que la IA dejó en duda). */
const hasLead = (q: GuideQuestion) => q.assessment === "pendiente_verificacion" || q.kind === "duda_ia";

export function buildInbox(candidates: InboxCandidate[], notEvaluated = 0): Inbox {
  const entries: InboxEntry[] = candidates.map((candidate) => ({
    ...candidate,
    mandatory: candidate.guide.filter((q) => q.priority === "obligatorio"),
    optionalCount: candidate.guide.filter((q) => q.priority !== "obligatorio").length,
  }));
  const byScore = (a: InboxEntry, b: InboxEntry) =>
    b.score - a.score || a.mandatory.length - b.mandatory.length || a.candidateName.localeCompare(b.candidateName, "es");
  const pending = entries.filter((e) => e.mandatory.length > 0);
  const worthConfirming = (e: InboxEntry) => e.score >= INBOX_PARTIAL_SCORE || e.mandatory.some(hasLead);
  return {
    ready: entries.filter((e) => e.mandatory.length === 0).sort(byScore),
    toConfirm: pending.filter(worthConfirming).sort(byScore),
    noEvidence: pending.filter((e) => !worthConfirming(e)).sort(byScore),
    notEvaluated,
  };
}

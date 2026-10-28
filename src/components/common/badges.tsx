import { Badge } from "@/components/ui/badge";
import {
  APPLICATION_STATUS_LABELS,
  ASSESSMENT_LABELS,
  COMPATIBILITY_LEVEL_LABELS,
  DATA_ORIGIN_LABELS,
  VACANCY_STATUS_LABELS,
} from "@/lib/labels";
import type { Enums } from "@/types/database";
import { cn } from "@/lib/utils";

const tone = {
  neutral: "bg-muted text-foreground",
  info: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-100",
  success: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
  warning: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100",
  attention: "bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-100",
  muted: "bg-transparent text-muted-foreground border-border",
} as const;

type Tone = keyof typeof tone;

function ToneBadge({ label, toneName, className }: { label: string; toneName: Tone; className?: string }) {
  return (
    <Badge variant="outline" className={cn("border-transparent", tone[toneName], className)}>
      {label}
    </Badge>
  );
}

const VACANCY_TONES: Record<Enums<"vacancy_status">, Tone> = {
  borrador: "neutral",
  publicada: "success",
  cerrada: "warning",
  archivada: "muted",
};

export function VacancyStatusBadge({ status }: { status: Enums<"vacancy_status"> }) {
  return <ToneBadge label={VACANCY_STATUS_LABELS[status]} toneName={VACANCY_TONES[status]} />;
}

const APPLICATION_TONES: Record<Enums<"application_status">, Tone> = {
  nuevo: "info",
  en_revision: "neutral",
  preseleccionado: "success",
  entrevista_programada: "info",
  en_evaluacion: "neutral",
  seleccionado: "success",
  no_seleccionado: "muted",
  en_reserva: "warning",
  retirado: "muted",
};

export function ApplicationStatusBadge({ status }: { status: Enums<"application_status"> }) {
  return <ToneBadge label={APPLICATION_STATUS_LABELS[status]} toneName={APPLICATION_TONES[status]} />;
}

// Tonos neutrales: un nivel bajo no se presenta como "error" ni con rojo.
const LEVEL_TONES: Record<Enums<"compatibility_level">, Tone> = {
  alta: "success",
  parcial: "info",
  baja: "neutral",
  pendiente: "warning",
};

export function CompatibilityBadge({ level }: { level: Enums<"compatibility_level"> | null }) {
  if (!level) return <ToneBadge label="Sin evaluar" toneName="muted" />;
  return <ToneBadge label={COMPATIBILITY_LEVEL_LABELS[level]} toneName={LEVEL_TONES[level]} />;
}

const ASSESSMENT_TONES: Record<Enums<"requirement_assessment">, Tone> = {
  acreditado: "success",
  no_cumplido: "attention",
  sin_evidencia: "muted",
  pendiente_verificacion: "warning",
};

export function AssessmentBadge({ assessment }: { assessment: Enums<"requirement_assessment"> }) {
  return <ToneBadge label={ASSESSMENT_LABELS[assessment]} toneName={ASSESSMENT_TONES[assessment]} />;
}

const ORIGIN_TONES: Record<Enums<"data_origin">, Tone> = {
  declarado: "neutral",
  extraido: "info",
  verificado: "success",
};

export function OriginBadge({ origin }: { origin: Enums<"data_origin"> | undefined }) {
  if (!origin) return null;
  return <ToneBadge label={DATA_ORIGIN_LABELS[origin]} toneName={ORIGIN_TONES[origin]} className="text-[11px]" />;
}

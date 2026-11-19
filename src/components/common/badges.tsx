import { Badge } from "@/components/ui/badge";
import {
  APPLICATION_STATUS_LABELS,
  ASSESSMENT_LABELS,
  COMPATIBILITY_LEVEL_LABELS,
  DATA_ORIGIN_LABELS,
  PORTAL_PUBLICATION_STATUS_LABELS,
  VACANCY_STATUS_LABELS,
} from "@/lib/labels";
import type { Enums } from "@/types/database";
import { cn } from "@/lib/utils";

const tone = {
  neutral: "bg-muted text-foreground",
  info: "bg-info text-info-foreground",
  success: "bg-success text-success-foreground",
  warning: "bg-warning text-warning-foreground",
  attention: "bg-attention text-attention-foreground",
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

const PORTAL_PUBLICATION_TONES: Record<Enums<"portal_publication_status">, Tone> = {
  pendiente: "neutral",
  publicando: "info",
  publicada: "success",
  retirar: "warning",
  retirada: "muted",
  error: "attention",
};

export function PortalPublicationBadge({ status }: { status: Enums<"portal_publication_status"> }) {
  return <ToneBadge label={PORTAL_PUBLICATION_STATUS_LABELS[status]} toneName={PORTAL_PUBLICATION_TONES[status]} />;
}

// Las etapas van en una etiqueta neutra con un punto de color propio; el relleno
// de color queda reservado al cumplimiento (CompatibilityBadge).
const APPLICATION_DOTS: Record<Enums<"application_status">, string> = {
  nuevo: "bg-info-foreground",
  en_revision: "bg-chart-1",
  preseleccionado: "bg-chart-2",
  entrevista_programada: "bg-chart-3",
  en_evaluacion: "bg-chart-4",
  seleccionado: "bg-success-foreground",
  no_seleccionado: "bg-muted-foreground",
  en_reserva: "bg-warning-foreground",
  retirado: "bg-muted-foreground/40",
};

export function ApplicationStatusBadge({ status }: { status: Enums<"application_status"> }) {
  return (
    <Badge variant="outline" className="gap-1.5 border-border bg-muted text-foreground">
      <span aria-hidden className={cn("size-2 shrink-0 rounded-full", APPLICATION_DOTS[status])} />
      {APPLICATION_STATUS_LABELS[status]}
    </Badge>
  );
}

// Tonos neutrales: un nivel bajo no se presenta como "error" ni con rojo.
const LEVEL_TONES: Record<Enums<"compatibility_level">, Tone> = {
  alta: "success",
  parcial: "info",
  baja: "neutral",
  pendiente: "warning",
};

export function CompatibilityBadge({ level, className }: { level: Enums<"compatibility_level"> | null; className?: string }) {
  if (!level) return <ToneBadge label="Sin evaluar" toneName="muted" className={className} />;
  return <ToneBadge label={COMPATIBILITY_LEVEL_LABELS[level]} toneName={LEVEL_TONES[level]} className={className} />;
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

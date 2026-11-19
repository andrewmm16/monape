import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { describeHours, type IncidentSeverity, type IncidentStatus, type NotificationDeadline } from "@/modules/incidents/deadlines";
import { SEVERITY_LABELS, STATUS_LABELS } from "@/modules/incidents/schemas";

const SEVERITY_TONES: Record<IncidentSeverity, string> = {
  alta: "bg-danger text-danger-foreground",
  media: "bg-attention text-attention-foreground",
  baja: "bg-info text-info-foreground",
};

const STATUS_TONES: Record<IncidentStatus, string> = {
  abierto: "bg-warning text-warning-foreground",
  contenido: "bg-info text-info-foreground",
  cerrado: "bg-muted text-foreground",
};

export function SeverityBadge({ severity }: { severity: IncidentSeverity }) {
  return (
    <Badge variant="outline" className={cn("border-transparent", SEVERITY_TONES[severity])}>
      Gravedad {SEVERITY_LABELS[severity].toLowerCase()}
    </Badge>
  );
}

export function IncidentStatusBadge({ status }: { status: IncidentStatus }) {
  return (
    <Badge variant="outline" className={cn("border-transparent", STATUS_TONES[status])}>
      {STATUS_LABELS[status]}
    </Badge>
  );
}

export function DrillBadge() {
  return (
    <Badge variant="outline" className="border-border bg-transparent text-muted-foreground">
      SIMULACRO
    </Badge>
  );
}

/** Cuenta regresiva del plazo de 48 h para avisar a la Autoridad (en rojo si quedan menos de 12 h o venció). */
export function NotificationDeadlineText({ deadline, className }: { deadline: NotificationDeadline; className?: string }) {
  if (!deadline.applies) return <span className={cn("text-muted-foreground", className)}>No exige aviso a la Autoridad</span>;
  if (deadline.fulfilled) return <span className={cn("text-success-foreground", className)}>Autoridad avisada</span>;
  return (
    <span className={cn(deadline.urgent ? "font-medium text-destructive" : "text-foreground", className)}>
      Aviso a la Autoridad: {describeHours(deadline.hoursRemaining)}
    </span>
  );
}

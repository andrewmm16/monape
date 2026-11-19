import type { ReactNode } from "react";
import Link from "next/link";
import { BellRingIcon, CalendarClockIcon, MapPinIcon, MessageCircleQuestionIcon, PhoneIcon, UserRoundIcon } from "lucide-react";
import { INTERVIEW_GUIDE_ANCHOR } from "@/components/applications/interview-guide-card";
import { ApplicationStatusBadge } from "@/components/common/badges";
import { LocationMap } from "@/components/common/location-map";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { INTERVIEW_MODALITY_LABELS, INTERVIEW_RESULT_LABELS, INTERVIEW_STATUS_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { formatDuration, formatInterviewDateTime, safeHttpUrl } from "@/modules/interviews/datetime";
import type { Enums } from "@/types/database";
import { CancelInterviewDialog, InterviewFormDialog, RecordResultDialog } from "./interview-dialogs";

export type InterviewItemData = {
  id: string;
  scheduled_at: string;
  duration_minutes: number;
  modality: Enums<"interview_modality">;
  location: string | null;
  /** Punto de la dirección (solo presencial elegida con el autocompletado). */
  location_lat?: number | null;
  location_lng?: number | null;
  interviewers: string | null;
  /** Correos de los entrevistadores (reciben avisos y recordatorio). */
  interviewer_emails?: string[] | null;
  instructions: string | null;
  status: Enums<"interview_status">;
  result: Enums<"interview_result"> | null;
  result_notes: string | null;
  cancel_reason: string | null;
  /** Quién registró el resultado (ficha de la postulación). */
  recordedBy?: string | null;
  /** Se envió el recordatorio automático para la fecha vigente. */
  reminderSent?: boolean;
  application: {
    id: string;
    status: Enums<"application_status">;
    candidateName: string | null;
    vacancyId: string;
    vacancyTitle: string | null;
    vacancyStatus: Enums<"vacancy_status"> | null;
  };
};

const BADGE_TONES = {
  paso: "bg-success text-success-foreground",
  no_paso: "bg-danger text-danger-foreground",
  no_asistio: "bg-warning text-warning-foreground",
  cancelada: "bg-muted text-muted-foreground",
  programada: "bg-info text-info-foreground",
} as const;

/** Distintivo del estado o resultado de la entrevista: Pasó, No pasó, No asistió, Cancelada o Programada. */
export function InterviewOutcomeBadge({
  status,
  result,
}: {
  status: Enums<"interview_status">;
  result: Enums<"interview_result"> | null;
}) {
  const key = status === "realizada" ? (result ?? "paso") : status;
  const label = status === "realizada" && result ? INTERVIEW_RESULT_LABELS[result] : INTERVIEW_STATUS_LABELS[status];
  return (
    <Badge variant="outline" className={cn("border-transparent", BADGE_TONES[key])}>
      {label}
    </Badge>
  );
}

/** Lugar de la entrevista: un enlace http(s) se muestra como enlace; cualquier otro texto, como texto plano. */
export function LocationText({ location }: { location: string | null }) {
  if (!location) return null;
  const url = safeHttpUrl(location);
  if (!url) return <span className="break-words">{location}</span>;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="break-all text-brand underline underline-offset-2">
      {location}
    </a>
  );
}

/** Fila de una entrevista: datos y acciones (solo las programadas las tienen). */
export function InterviewItem({
  interview,
  showApplication = true,
  canManage = true,
  highlight = false,
  children,
}: {
  interview: InterviewItemData;
  showApplication?: boolean;
  canManage?: boolean;
  highlight?: boolean;
  /** Contenido extra al pie de la fila (p. ej. la evaluación del equipo). */
  children?: ReactNode;
}) {
  const { application } = interview;
  const scheduledLabel = formatInterviewDateTime(interview.scheduled_at);
  const programmed = interview.status === "programada";
  return (
    <li
      data-testid="interview-item"
      className={cn("space-y-2 rounded-lg border bg-card p-3 text-sm shadow-xs", highlight && "border-warning-foreground/40 bg-warning/60")}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <div className="flex flex-wrap items-center gap-2 font-medium">
            <CalendarClockIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span>{scheduledLabel}</span>
            <span className="font-normal text-muted-foreground">· {formatDuration(interview.duration_minutes)}</span>
            <InterviewOutcomeBadge status={interview.status} result={interview.result} />
          </div>
          {showApplication ? (
            <div>
              <Link href={`/postulaciones/${application.id}`} className="font-semibold hover:underline">
                {application.candidateName ?? "Candidato"}
              </Link>{" "}
              <span className="text-muted-foreground">
                ·{" "}
                <Link href={`/vacantes/${application.vacancyId}`} className="hover:underline">
                  {application.vacancyTitle ?? "Vacante"}
                </Link>
              </span>
            </div>
          ) : null}
        </div>
        {/* La etapa de la postulación, salvo que repita lo que ya dice la entrevista («Programada»). */}
        {showApplication && !(programmed && application.status === "entrevista_programada") ? (
          <ApplicationStatusBadge status={application.status} />
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground">
        <span>{INTERVIEW_MODALITY_LABELS[interview.modality]}</span>
        {programmed && interview.reminderSent ? (
          <span className="flex items-center gap-1">
            <BellRingIcon className="size-3.5 shrink-0" aria-hidden />
            Recordatorio enviado
          </span>
        ) : null}
        {interview.location ? (
          <span className="flex min-w-0 items-center gap-1">
            {interview.modality === "telefonica" ? (
              <PhoneIcon className="size-3.5 shrink-0" aria-hidden />
            ) : (
              <MapPinIcon className="size-3.5 shrink-0" aria-hidden />
            )}
            {interview.modality === "telefonica" && /^[+\d][\d\s-]{5,}$/.test(interview.location.trim()) ? (
              <a href={`tel:${interview.location.replace(/[\s-]/g, "")}`} className="text-brand underline underline-offset-2">
                {interview.location}
              </a>
            ) : (
              <LocationText location={interview.location} />
            )}
          </span>
        ) : null}
        {interview.interviewers ? (
          <span className="flex min-w-0 items-center gap-1">
            <UserRoundIcon className="size-3.5 shrink-0" aria-hidden />
            <span className="break-words">{interview.interviewers}</span>
          </span>
        ) : null}
        {programmed && interview.interviewer_emails?.length ? (
          <span title={interview.interviewer_emails.join(", ")}>
            Avisos a {interview.interviewer_emails.length}{" "}
            {interview.interviewer_emails.length === 1 ? "entrevistador" : "entrevistadores"}
          </span>
        ) : null}
      </div>

      {interview.modality === "presencial" && typeof interview.location_lat === "number" && typeof interview.location_lng === "number" ? (
        <div className="max-w-md">
          <LocationMap lat={interview.location_lat} lng={interview.location_lng} label={interview.location ?? undefined} />
        </div>
      ) : null}

      {interview.instructions ? <p className="text-xs whitespace-pre-wrap text-muted-foreground">{interview.instructions}</p> : null}
      {interview.result_notes ? (
        <p className="text-xs whitespace-pre-wrap">
          <span className="font-medium">Notas:</span> {interview.result_notes}
          {interview.recordedBy ? <span className="text-muted-foreground"> — {interview.recordedBy}</span> : null}
        </p>
      ) : null}
      {interview.cancel_reason ? (
        <p className="text-xs whitespace-pre-wrap">
          <span className="font-medium">Motivo de la cancelación:</span> {interview.cancel_reason}
        </p>
      ) : null}

      {programmed && canManage ? (
        <div className="flex flex-wrap gap-2 pt-1">
          {/* En la lista de Entrevistas: acceso directo a las preguntas recomendadas de la persona. */}
          {showApplication ? (
            <Button asChild size="sm" variant="outline" className="h-9 sm:h-8">
              <Link href={`/postulaciones/${application.id}?vista=preguntas#${INTERVIEW_GUIDE_ANCHOR}`}>
                <MessageCircleQuestionIcon aria-hidden /> Preguntas para la entrevista
              </Link>
            </Button>
          ) : null}
          <RecordResultDialog
            interviewId={interview.id}
            scheduledLabel={scheduledLabel}
            applicationStatus={application.status}
            vacancyArchived={application.vacancyStatus === "archivada"}
            trigger={
              <Button type="button" size="sm" className="h-9 sm:h-8">
                Registrar resultado
              </Button>
            }
          />
          <InterviewFormDialog
            interview={interview}
            trigger={
              <Button type="button" size="sm" variant="outline" className="h-9 sm:h-8">
                Reprogramar
              </Button>
            }
          />
          <CancelInterviewDialog
            interviewId={interview.id}
            applicationStatus={application.status}
            trigger={
              // Separado de las otras acciones y en rojo: anula la entrevista.
              <Button type="button" size="sm" variant="ghost" className="h-9 text-destructive hover:bg-destructive/10 hover:text-destructive sm:ml-auto sm:h-8">
                Cancelar entrevista
              </Button>
            }
          />
        </div>
      ) : null}

      {children ? <div className="pt-1">{children}</div> : null}
    </li>
  );
}

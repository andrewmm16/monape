import Link from "next/link";
import { MailIcon, RotateCcwIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/format";
import { TALENT_INVITATION_OUTCOME_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";
import type { ContactEvent, TalentInvitationOutcome } from "@/modules/talent-pool/queries";

const OUTCOME_TONES: Record<TalentInvitationOutcome, string> = {
  enviada: "bg-success text-success-foreground",
  sin_correo: "bg-muted text-muted-foreground",
  consentimiento_revocado: "bg-warning text-warning-foreground",
  error: "bg-danger text-danger-foreground",
};

/** Invitaciones y reactivaciones de un candidato desde la base de talentos, de la más reciente a la más antigua. */
export function ContactHistory({ events }: { events: ContactEvent[] }) {
  if (events.length === 0) {
    return <p className="text-sm text-muted-foreground">Aún no se ha contactado a este candidato desde la base de talentos.</p>;
  }
  return (
    <ul className="space-y-3" aria-label="Historial de contacto">
      {events.map((event) => {
        const Icon = event.kind === "invitacion" ? MailIcon : RotateCcwIcon;
        return (
          <li key={`${event.kind}:${event.id}`} className="flex gap-3">
            <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0 space-y-0.5 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">
                  {event.kind === "invitacion" ? "Invitación por correo" : "Reactivado desde la base"}
                </span>
                {event.kind === "invitacion" ? (
                  <Badge variant="outline" className={cn("border-transparent", OUTCOME_TONES[event.outcome])}>
                    {TALENT_INVITATION_OUTCOME_LABELS[event.outcome]}
                  </Badge>
                ) : null}
              </div>
              <div className="text-muted-foreground">
                <Link href={`/vacantes/${event.vacancyId}`} className="underline-offset-2 hover:underline">
                  {event.vacancyTitle ? `«${event.vacancyTitle}»` : "Vacante"}
                </Link>
                {" · "}
                {formatDateTime(event.at)}
                {event.byName ? ` · por ${event.byName}` : ""}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

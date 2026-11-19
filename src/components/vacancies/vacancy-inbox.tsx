import Link from "next/link";
import { CalendarPlusIcon, CheckIcon, ChevronRightIcon, XIcon } from "lucide-react";
import type { ReactNode } from "react";
import { VerifyRequirementDialog } from "@/components/applications/verification-dialog";
import { ApplicationStatusBadge, AssessmentBadge } from "@/components/common/badges";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { INBOX_PARTIAL_SCORE, type Inbox, type InboxEntry } from "@/modules/evaluation/inbox";

const pct = (value: number) => `${Math.round(value)} %`;

function CandidateLink({ entry }: { entry: InboxEntry }) {
  return (
    <Link
      href={`/postulaciones/${entry.applicationId}`}
      className="font-medium text-brand underline underline-offset-4 hover:text-brand/80"
    >
      {entry.candidateName}
    </Link>
  );
}

/** Plegado con chevron (nunca el triángulo nativo del `<details>`). */
function Fold({ summary, children, className }: { summary: ReactNode; children: ReactNode; className?: string }) {
  return (
    <details className={cn("group", className)}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-md text-sm marker:hidden focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden />
        {summary}
      </summary>
      {children}
    </details>
  );
}

/**
 * Bandeja «lo que necesita una persona»: quién está listo para entrevistar, a
 * quién le falta confirmar un obligatorio (con la pregunta y el botón para
 * registrarlo) y quién no llega aunque se confirme todo. No descarta a nadie.
 */
export function VacancyInbox({ inbox, canVerify }: { inbox: Inbox; canVerify: boolean }) {
  const total = inbox.ready.length + inbox.toConfirm.length + inbox.noEvidence.length;
  return (
    <div className="space-y-6" data-testid="vacancy-inbox">
      <p className="text-sm text-muted-foreground">
        {total} en proceso con evaluación: {inbox.ready.length} listos para entrevistar, {inbox.toConfirm.length} por confirmar y{" "}
        {inbox.noEvidence.length} sin evidencia de los obligatorios
        {inbox.notEvaluated > 0 ? ` · ${inbox.notEvaluated} sin evaluar` : ""}. Lo que confirme aquí recalcula la puntuación y le enseña al
        motor.
      </p>

      <Card data-testid="inbox-ready">
        <CardHeader>
          <CardTitle>Listos para entrevistar ({inbox.ready.length})</CardTitle>
          <CardDescription>El CV acredita todos los requisitos obligatorios (o RRHH ya los verificó).</CardDescription>
        </CardHeader>
        <CardContent>
          {inbox.ready.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nadie todavía.</p>
          ) : (
            <ul className="divide-y">
              {inbox.ready.map((entry) => (
                <li key={entry.applicationId} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2">
                  <CandidateLink entry={entry} />
                  <span className="text-sm tabular-nums">{pct(entry.score)}</span>
                  <ApplicationStatusBadge status={entry.status} />
                  {entry.optionalCount > 0 ? (
                    <span className="text-xs text-muted-foreground">
                      {entry.optionalCount} deseable
                      {entry.optionalCount === 1 ? "" : "s"} por confirmar en la entrevista
                    </span>
                  ) : null}
                  <Link
                    href={`/postulaciones/${entry.applicationId}?programar=1`}
                    className={cn(buttonVariants({ variant: "outline", size: "sm" }), "sm:ml-auto")}
                  >
                    <CalendarPlusIcon aria-hidden /> Programar entrevista
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card data-testid="inbox-to-confirm">
        <CardHeader>
          <CardTitle>Por confirmar ({inbox.toConfirm.length})</CardTitle>
          <CardDescription>
            Les falta confirmar algún obligatorio, pero ya cumplen al menos el {INBOX_PARTIAL_SCORE} % o el CV da un indicio de lo que
            falta. Una llamada, un documento o la entrevista lo resuelven.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {inbox.toConfirm.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nada por confirmar.</p>
          ) : (
            <ul className="space-y-2">
              {inbox.toConfirm.map((entry) => (
                <li key={entry.applicationId} className="rounded-md border px-3" data-testid="inbox-candidate">
                  <Fold
                    summary={
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="font-medium">{entry.candidateName}</span>
                        <span className="tabular-nums">{pct(entry.score)}</span>
                        <span className="text-xs text-muted-foreground">{entry.mandatory.length} por confirmar</span>
                      </span>
                    }
                  >
                    <div className="space-y-2 pb-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <CandidateLink entry={entry} />
                        <ApplicationStatusBadge status={entry.status} />
                      </div>
                      <ul className="space-y-2">
                        {entry.mandatory.map((q) => (
                          <li key={q.requirementId} className="space-y-1 rounded bg-muted/50 p-2 text-sm">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-medium">{q.description}</span>
                              {q.kind === "duda_ia" ? (
                                <Badge variant="outline" className="border-brand/40">
                                  Acreditado, con duda de la IA
                                </Badge>
                              ) : (
                                <AssessmentBadge assessment={q.assessment} />
                              )}
                            </div>
                            <p>
                              <span className="font-medium">Pregunte: </span>
                              {q.question}
                            </p>
                            <p className="text-muted-foreground">
                              <span className="font-medium text-foreground">Cumple si: </span>
                              {q.passIf}
                            </p>
                            {canVerify ? (
                              <div className="flex flex-wrap gap-2 pt-1">
                                <VerifyRequirementDialog
                                  applicationId={entry.applicationId}
                                  requirementId={q.requirementId}
                                  requirementDescription={q.description}
                                  initialValues={{
                                    result: "acreditado",
                                    source: "entrevista",
                                    note: "",
                                  }}
                                  trigger={
                                    <Button size="sm" variant="outline">
                                      <CheckIcon aria-hidden /> Cumple
                                    </Button>
                                  }
                                />
                                <VerifyRequirementDialog
                                  applicationId={entry.applicationId}
                                  requirementId={q.requirementId}
                                  requirementDescription={q.description}
                                  initialValues={{
                                    result: "no_cumplido",
                                    source: "entrevista",
                                    note: "",
                                  }}
                                  trigger={
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                    >
                                      <XIcon aria-hidden /> No cumple
                                    </Button>
                                  }
                                />
                              </div>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                      <p className="text-xs text-muted-foreground">
                        {entry.optionalCount > 0
                          ? `Y ${entry.optionalCount} deseable${entry.optionalCount === 1 ? "" : "s"} por confirmar. `
                          : ""}
                        <Link href={`/postulaciones/${entry.applicationId}`} className="underline underline-offset-4">
                          Ver la guía completa o programar la entrevista
                        </Link>
                      </p>
                    </div>
                  </Fold>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card data-testid="inbox-no-evidence">
        <CardHeader>
          <CardTitle>Sin evidencia de los obligatorios ({inbox.noEvidence.length})</CardTitle>
          <CardDescription>
            Cumplen menos del {INBOX_PARTIAL_SCORE} % y el CV no menciona lo obligatorio que falta. Que no lo mencione no significa que no
            lo tengan: no se descartan solos, la decisión es de RRHH.
          </CardDescription>
        </CardHeader>
        {inbox.noEvidence.length > 0 ? (
          <CardContent>
            <Fold summary={<span>Ver los {inbox.noEvidence.length}</span>}>
              <ul className="mt-2 divide-y">
                {inbox.noEvidence.map((entry) => (
                  <li key={entry.applicationId} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                    <CandidateLink entry={entry} />
                    <span className="tabular-nums">{pct(entry.score)}</span>
                    <span className="text-xs text-muted-foreground">Falta: {entry.mandatory.map((q) => q.description).join(", ")}</span>
                  </li>
                ))}
              </ul>
            </Fold>
          </CardContent>
        ) : null}
      </Card>
    </div>
  );
}

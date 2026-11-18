import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CalendarClockIcon, CheckCircle2Icon, CircleIcon } from "lucide-react";
import { BrandLogo } from "@/components/common/brand-logo";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getServerEnv } from "@/lib/env";
import { formatDate } from "@/lib/format";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { cn } from "@/lib/utils";
import { getPublicApplicationStatus, type PortalStage } from "@/modules/candidate-portal/queries";
import { formatDuration, formatInterviewDateTime, safeHttpUrl } from "@/modules/interviews/datetime";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Seguimiento de tu postulación", robots: { index: false, follow: false } };

/** Etapas que se muestran, en orden. «Finalizado» reemplaza a las dos últimas cuando no hubo selección. */
const STEPS: { stage: PortalStage; label: string; detail: string }[] = [
  { stage: "recibida", label: "Postulación recibida", detail: "Recibimos tu postulación y tu CV." },
  { stage: "en_revision", label: "En revisión", detail: "El equipo de Recursos Humanos está revisando tu perfil." },
  { stage: "entrevista", label: "Entrevista", detail: "Tienes una entrevista programada." },
  { stage: "evaluacion_final", label: "Evaluación final", detail: "Estamos tomando la decisión final." },
  { stage: "seleccionado", label: "Seleccionado", detail: "¡Felicitaciones! Recursos Humanos se pondrá en contacto contigo." },
];

const MODALITY: Record<string, string> = { presencial: "Presencial", virtual: "Virtual", telefonica: "Telefónica" };

/**
 * Página pública del portal del candidato (enlace privado, sin sesión). Solo
 * muestra la etapa, fechas y la próxima entrevista; nunca notas ni evaluación.
 * Con el portal apagado o un enlace inválido responde 404.
 */
export default async function TrackingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const status = await getPublicApplicationStatus(createSupabaseAdminClient(), token);
  if (!status) notFound();
  const company = getServerEnv().PUBLIC_COMPANY_NAME ?? "Recursos Humanos";
  const finished = status.stage === "finalizado";
  const currentIndex = finished ? -1 : STEPS.findIndex((step) => step.stage === status.stage);
  const interviewUrl = status.nextInterview?.modality === "virtual" ? safeHttpUrl(status.nextInterview.location ?? "") : null;

  return (
    <main className="flex min-h-screen justify-center bg-background px-4 py-10">
      <div className="w-full max-w-lg space-y-6">
        <div className="flex justify-center">
          <BrandLogo className="h-7" />
        </div>
        <Card>
          <CardHeader>
            <CardTitle>
              <h1>{status.vacancyTitle}</h1>
            </CardTitle>
            <CardDescription>
              Seguimiento de tu postulación en {company}
              {status.appliedAt ? ` · enviada el ${formatDate(status.appliedAt)}` : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {finished ? (
              <p className="rounded-md border bg-muted/40 p-3 text-sm">
                El proceso de selección para este puesto terminó. Gracias por tu interés: guardaremos tu perfil para
                futuras oportunidades si nos diste tu autorización.
              </p>
            ) : (
              <ol className="space-y-3" aria-label="Etapas del proceso">
                {STEPS.map((step, index) => {
                  const done = index < currentIndex;
                  const current = index === currentIndex;
                  return (
                    <li key={step.stage} className="flex gap-3" aria-current={current ? "step" : undefined}>
                      {done || current ? (
                        <CheckCircle2Icon className={cn("mt-0.5 size-5 shrink-0", current ? "text-brand" : "text-muted-foreground")} aria-hidden />
                      ) : (
                        <CircleIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground/40" aria-hidden />
                      )}
                      <div className={cn(!done && !current && "text-muted-foreground")}>
                        <p className={cn("text-sm", current && "font-semibold")}>{step.label}</p>
                        {current ? <p className="text-sm text-muted-foreground">{step.detail}</p> : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}

            {status.nextInterview ? (
              <div className="space-y-1 rounded-md border p-3 text-sm">
                <p className="flex items-center gap-2 font-medium">
                  <CalendarClockIcon className="size-4" aria-hidden /> Tu próxima entrevista
                </p>
                <p>
                  {formatInterviewDateTime(status.nextInterview.scheduledAt)} (hora de Lima) ·{" "}
                  {formatDuration(status.nextInterview.durationMinutes)}
                </p>
                <p>
                  {MODALITY[status.nextInterview.modality] ?? status.nextInterview.modality}
                  {status.nextInterview.location ? " · " : ""}
                  {interviewUrl ? (
                    <a href={interviewUrl} className="break-all text-brand underline" rel="noopener noreferrer">
                      {status.nextInterview.location}
                    </a>
                  ) : (
                    status.nextInterview.location
                  )}
                </p>
              </div>
            ) : null}

            {status.updatedAt ? (
              <p className="text-xs text-muted-foreground">Última actualización: {formatDate(status.updatedAt)}</p>
            ) : null}
          </CardContent>
        </Card>
        <p className="text-center text-xs text-muted-foreground">
          Este enlace es personal: no lo compartas. Si tienes dudas, responde al último correo que te enviamos.
        </p>
      </div>
    </main>
  );
}

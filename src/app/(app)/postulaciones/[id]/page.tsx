import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { EvaluationCard } from "@/components/applications/evaluation-card";
import { NoteForm } from "@/components/applications/note-form";
import { OpinionRequest, type OpinionState } from "@/components/applications/opinion-request";
import { StatusForm } from "@/components/applications/status-form";
import { ActionButton } from "@/components/common/action-button";
import { ApplicationStatusBadge } from "@/components/common/badges";
import { PageHeader } from "@/components/common/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { can } from "@/lib/auth/permissions";
import { requirePageUser } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { formatDate, formatDateTime } from "@/lib/format";
import { APPLICATION_EVENT_LABELS, APPLICATION_STATUS_LABELS, REVIEW_OUTCOME_LABELS, SYSTEM_ACTOR_LABEL } from "@/lib/labels";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { linkCurrentResume, runEvaluation } from "@/modules/applications/actions";
import {
  getApplicationDetail,
  getCurrentResume,
  listApplicationEvents,
  listEvaluationItems,
  listEvaluations,
} from "@/modules/applications/queries";
import { buildObservationDraft, type DraftInput } from "@/modules/evaluation/drafts";
import { getAiStatus } from "@/modules/evaluation/service";
import { listActiveProfiles } from "@/modules/users/queries";

export const metadata: Metadata = { title: "Postulación" };

export default async function ApplicationPage({ params, searchParams }: PageProps<"/postulaciones/[id]">) {
  const user = await requirePageUser();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const search = await searchParams;

  const supabase = await createSupabaseServerClient();
  const application = await getApplicationDetail(supabase, id).catch((error: unknown) => {
    if (error instanceof AppError && error.code === "not_found") notFound();
    throw error;
  });
  const canManage = can(user.role, "applications:manage");
  const canEvaluate = can(user.role, "evaluations:run");

  const [evaluations, events, profiles, currentResume] = await Promise.all([
    listEvaluations(supabase, application.id),
    listApplicationEvents(supabase, application.id),
    canManage ? listActiveProfiles(supabase) : Promise.resolve([]),
    getCurrentResume(supabase, application.candidate.id),
  ]);
  // A quién se puede pedir opinión: cualquier usuario activo salvo uno mismo.
  const people = profiles.filter((p) => p.id !== user.id);
  const opinion: OpinionState = {
    profileId: application.assigned_evaluator_id,
    name: application.opinion_from?.full_name ?? null,
    requestedBy: application.opinion_requester?.full_name ?? null,
    requestedAt: application.opinion_requested_at,
    answeredAt: application.opinion_answered_at,
  };
  const newerResume =
    currentResume && application.resume && currentResume.id !== application.resume.id ? currentResume : null;
  const requested = typeof search.evaluacion === "string" ? evaluations.find((e) => e.id === search.evaluacion) : undefined;
  const selected = requested ?? evaluations[0] ?? null;
  const items = selected ? await listEvaluationItems(supabase, selected.id) : [];

  // Los borradores de observación y de motivo usan siempre la evaluación más
  // reciente, aunque en el historial se esté consultando otra.
  const latest = evaluations[0] ?? null;
  const latestItems = !latest ? [] : latest.id === selected?.id ? items : await listEvaluationItems(supabase, latest.id);
  // Solo los campos que usan los borradores: el formulario de estado los
  // recibe en el navegador.
  const draftInput: DraftInput | null = latest
    ? {
        evaluation: {
          created_at: latest.created_at,
          method: latest.method,
          criteria_version: latest.criteria_version,
          score: latest.score,
          level: latest.level,
          review_outcome: latest.review_outcome,
          resume: latest.resume ? { version: latest.resume.version } : null,
        },
        items: latestItems.map(({ description, priority, assessment, is_essential }) => ({
          description,
          priority,
          assessment,
          is_essential,
        })),
        currentCriteriaVersion: application.vacancy.criteria_version,
      }
    : null;

  const criteriaApproved = Boolean(application.vacancy.criteria_approved_at);
  const ai = canEvaluate ? getAiStatus() : null;

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`/vacantes/${application.vacancy.id}`} className="hover:underline">
            {application.vacancy.title}
          </Link>
        }
        title={application.candidate.full_name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <ApplicationStatusBadge status={application.status} />
            <span>Postulación del {formatDate(application.applied_at)}</span>
            {application.public_reference ? <span>Referencia: {application.public_reference}</span> : null}
            <Link href={`/candidatos/${application.candidate.id}`} className="underline-offset-4 hover:underline">
              Ver ficha y CV
            </Link>
          </span>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          {canEvaluate ? (
            <Card>
              <CardHeader>
                <CardTitle>Generar evaluación</CardTitle>
                <CardDescription>
                  Compara el CV vigente con los criterios aprobados (versión {application.vacancy.criteria_version}). La
                  evaluación es orientativa, queda registrada y nunca cambia el estado del proceso.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm">
                  CV evaluado:{" "}
                  {application.resume
                    ? `versión ${application.resume.version} (${application.resume.original_filename})`
                    : currentResume
                      ? `versión vigente (${currentResume.version})`
                      : "el candidato aún no tiene CV"}
                </p>
                {newerResume && canManage ? (
                  <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-50">
                    <span>Existe una versión más reciente del CV (v{newerResume.version}).</span>
                    <ActionButton size="sm" variant="outline" action={linkCurrentResume.bind(null, application.id)}>
                      Usar versión {newerResume.version}
                    </ActionButton>
                  </div>
                ) : null}
                {!criteriaApproved ? (
                  <p className="text-sm text-amber-700 dark:text-amber-400">
                    Los criterios de la vacante no están aprobados.{" "}
                    <Link href={`/vacantes/${application.vacancy.id}?tab=criterios`} className="underline">
                      Revisarlos
                    </Link>
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <ActionButton
                    action={runEvaluation.bind(null, application.id, "reglas")}
                    disabled={!criteriaApproved}
                    pendingLabel="Evaluando…"
                  >
                    Evaluar con motor de reglas
                  </ActionButton>
                  <ActionButton
                    variant="outline"
                    action={runEvaluation.bind(null, application.id, "ia")}
                    disabled={!criteriaApproved || !ai?.available}
                    pendingLabel="Consultando al asistente de IA…"
                    confirm={{
                      title: "¿Evaluar con IA?",
                      description:
                        "Se enviará el texto del CV, sin datos de contacto, al proveedor de IA aprobado por la empresa. La propuesta del modelo se verificará contra el CV y deberá revisarla RRHH.",
                      confirmLabel: "Evaluar con IA",
                    }}
                  >
                    Evaluar con IA
                  </ActionButton>
                </div>
                {ai && !ai.available ? <p className="text-xs text-muted-foreground">IA no disponible: {ai.reason}</p> : null}
              </CardContent>
            </Card>
          ) : null}

          <EvaluationCard
            applicationId={application.id}
            evaluation={selected}
            items={items}
            history={evaluations}
            currentCriteriaVersion={application.vacancy.criteria_version}
            canReview={can(user.role, "evaluations:review")}
          />
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Estado del proceso</CardTitle>
              <CardDescription>
                Decisión humana, independiente de la compatibilidad. Último cambio: {formatDateTime(application.status_changed_at)}.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ApplicationStatusBadge status={application.status} />
              {canManage ? (
                <StatusForm
                  key={`${application.status}-${latest?.id ?? "sin-evaluacion"}`}
                  applicationId={application.id}
                  current={application.status}
                  draft={draftInput}
                />
              ) : null}
            </CardContent>
          </Card>

          {canManage ? (
            <Card>
              <CardHeader>
                <CardTitle>Opinión solicitada</CardTitle>
                <CardDescription>Pida a otra persona del proceso que revise esta postulación.</CardDescription>
              </CardHeader>
              <CardContent>
                <OpinionRequest
                  key={`${opinion.profileId}-${opinion.requestedAt}`}
                  applicationId={application.id}
                  opinion={opinion}
                  people={people}
                  isMe={opinion.profileId === user.id}
                />
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Observaciones e historial</CardTitle>
              <CardDescription>Cada cambio queda registrado con fecha y responsable.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {can(user.role, "applications:add_note") ? (
                <NoteForm applicationId={application.id} suggestion={draftInput ? buildObservationDraft(draftInput) : null} />
              ) : null}
              <ol className="space-y-3 border-l pl-4">
                {events.map((event) => (
                  <li key={event.id} className="text-sm">
                    <div className="font-medium">
                      {APPLICATION_EVENT_LABELS[event.event_type]}
                      {event.event_type === "cambio_estado" && event.from_status && event.to_status
                        ? `: ${APPLICATION_STATUS_LABELS[event.from_status]} → ${APPLICATION_STATUS_LABELS[event.to_status]}`
                        : ""}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {event.actor?.full_name ?? SYSTEM_ACTOR_LABEL} · {formatDateTime(event.created_at)}
                    </div>
                    {event.reason ? (
                      <p className="text-xs">
                        Motivo:{" "}
                        {event.event_type === "evaluacion_revisada"
                          ? (REVIEW_OUTCOME_LABELS[event.reason as keyof typeof REVIEW_OUTCOME_LABELS] ?? event.reason)
                          : event.reason}
                      </p>
                    ) : null}
                    {event.note ? <p className="mt-1 text-xs whitespace-pre-wrap text-muted-foreground">{event.note}</p> : null}
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

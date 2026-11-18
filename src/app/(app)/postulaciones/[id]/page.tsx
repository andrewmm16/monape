import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { CandidateMessageDialog } from "@/components/applications/candidate-message-dialog";
import {
  CandidateEvaluationSummary,
  InterviewEvaluation,
  type EvaluationRound,
} from "@/components/scorecards/interview-evaluation";
import { consolidateScorecards, type ScorecardEntry } from "@/modules/scorecards/consolidation";
import { listApplicationScorecards } from "@/modules/scorecards/queries";
import { EvaluationCard } from "@/components/applications/evaluation-card";
import { InterviewGuideCard } from "@/components/applications/interview-guide-card";
import { NoteForm } from "@/components/applications/note-form";
import { KillerAnswersCard } from "@/components/applications/killer-answers-card";
import { StatusForm } from "@/components/applications/status-form";
import { ActionButton } from "@/components/common/action-button";
import { ApplicationStatusBadge } from "@/components/common/badges";
import { InterviewFormDialog } from "@/components/interviews/interview-dialogs";
import { InterviewItem } from "@/components/interviews/interview-item";
import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/common/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { can } from "@/lib/auth/permissions";
import { requirePageUser } from "@/lib/auth/session";
import { AppError, logServerError } from "@/lib/errors";
import { formatDate, formatDateTime } from "@/lib/format";
import { APPLICATION_EVENT_LABELS, APPLICATION_STATUS_LABELS, REVIEW_OUTCOME_LABELS, SYSTEM_ACTOR_LABEL } from "@/lib/labels";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { linkCurrentResume, requestAiEvaluationAction, runEvaluation } from "@/modules/applications/actions";
import { AiJobStatus } from "@/components/applications/ai-job-status";
import { describeAiJob, describeAiWorker, getAiWorkerStatus, getLatestAiJob } from "@/modules/evaluation/ai-queue";
import {
  getApplicationDetail,
  getCurrentResume,
  listApplicationEvents,
  listEvaluationItems,
  listEvaluations,
  listKillerAnswers,
  listRequirementVerifications,
} from "@/modules/applications/queries";
import { listApplicationInterviews } from "@/modules/interviews/queries";
import { formatInterviewDateTime } from "@/modules/interviews/datetime";
import { canScheduleInterview } from "@/modules/interviews/schemas";
import { buildObservationDraft, type DraftInput } from "@/modules/evaluation/drafts";
import { getAiStatus } from "@/modules/evaluation/service";
import { loadInterviewGuide } from "@/modules/evaluation/interview-guide-data";

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

  const [evaluations, events, currentResume, verifications, interviews, killerAnswers, scorecards] = await Promise.all([
    listEvaluations(supabase, application.id),
    listApplicationEvents(supabase, application.id),
    getCurrentResume(supabase, application.candidate.id),
    listRequirementVerifications(supabase, application.id),
    listApplicationInterviews(supabase, application.id),
    listKillerAnswers(supabase, application.id),
    listApplicationScorecards(supabase, application.id),
  ]);
  // Evaluaciones agrupadas por entrevista (una tarjeta por evaluador y entrevista).
  const scorecardsByInterview = new Map<string, ScorecardEntry[]>();
  for (const entry of scorecards) {
    const list = scorecardsByInterview.get(entry.interviewId) ?? [];
    list.push(entry);
    scorecardsByInterview.set(entry.interviewId, list);
  }
  // Resumen por ronda (progresión): entrevistas de la más antigua a la más
  // reciente que ya tengan al menos una evaluación. `interviews` viene en orden
  // descendente, así que se recorre invertido.
  const evaluationRounds: EvaluationRound[] = [...interviews]
    .reverse()
    .filter((interview) => (scorecardsByInterview.get(interview.id)?.length ?? 0) > 0)
    .map((interview) => ({
      interviewId: interview.id,
      label: formatInterviewDateTime(interview.scheduled_at),
      consolidation: consolidateScorecards(scorecardsByInterview.get(interview.id) ?? []),
    }));
  const schedulable = canManage && canScheduleInterview(application.status, application.vacancy.status);
  const newerResume =
    currentResume && application.resume && currentResume.id !== application.resume.id ? currentResume : null;
  const requested = typeof search.evaluacion === "string" ? evaluations.find((e) => e.id === search.evaluacion) : undefined;
  // El motor de reglas es la evaluación principal; la de IA es una segunda opinión que
  // se muestra DENTRO de la del motor (llega minutos después y no debe reemplazarla).
  const main = evaluations.find((e) => e.method === "reglas") ?? evaluations[0] ?? null;
  const selected = requested ?? main;
  // La segunda opinión: la última evaluación con IA del mismo CV y los mismos criterios.
  const secondOpinionEvaluation =
    selected?.method === "reglas"
      ? (evaluations.find(
          (e) => e.method === "ia" && e.resume_id === selected.resume_id && e.criteria_version === selected.criteria_version,
        ) ?? null)
      : null;
  const [items, secondOpinionItems] = await Promise.all([
    selected ? listEvaluationItems(supabase, selected.id) : Promise.resolve([]),
    secondOpinionEvaluation ? listEvaluationItems(supabase, secondOpinionEvaluation.id) : Promise.resolve([]),
  ]);

  // Los borradores de observación y de motivo usan siempre la evaluación principal
  // más reciente, aunque en el historial se esté consultando otra.
  const latest = main;
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
        items: latestItems.map(({ description, priority, assessment, is_essential, verification_source }) => ({
          description,
          priority,
          assessment,
          is_essential,
          verification_source,
        })),
        currentCriteriaVersion: application.vacancy.criteria_version,
      }
    : null;

  const criteriaApproved = Boolean(application.vacancy.criteria_approved_at);
  const ai = canEvaluate ? getAiStatus() : null;
  const aiQueued = Boolean(ai?.available && ai.queued);
  const aiJob = aiQueued ? describeAiJob(await getLatestAiJob(supabase, application.id), formatDateTime) : null;
  // Con un trabajo abierto, avisa si el worker no está atendiendo la cola (caído o en pausa).
  const aiWorkerNotice = aiJob?.active ? describeAiWorker(await getAiWorkerStatus(supabase), formatDateTime) : null;
  // Guía de entrevista: lo que falta confirmar. Si falla, la página sigue sin ella.
  const interviewGuide = canManage
    ? await loadInterviewGuide(supabase, application.id).catch((error: unknown) => {
        logServerError("applications.interview_guide", error);
        return null;
      })
    : null;

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

      <div className="mx-auto max-w-3xl">
        <div className="space-y-6">
          {canEvaluate ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <ActionButton
                  action={runEvaluation.bind(null, application.id, "reglas")}
                  disabled={!criteriaApproved}
                  pendingLabel="Evaluando…"
                  variant={evaluations.length > 0 ? "outline" : "default"}
                >
                  {evaluations.length > 0 ? "Volver a evaluar" : "Evaluar con motor de reglas"}
                </ActionButton>
                {ai?.available && aiQueued ? (
                  <ActionButton
                    variant="outline"
                    action={requestAiEvaluationAction.bind(null, application.id)}
                    disabled={!criteriaApproved || Boolean(aiJob?.active)}
                    pendingLabel="Enviando a la cola…"
                    confirm={{
                      title: "¿Evaluar con IA?",
                      description:
                        "Se pondrá en cola el texto del CV, sin datos de contacto, para el proveedor de IA aprobado por la empresa. El resultado aparecerá en esta página en unos minutos; se verificará contra el CV y deberá revisarlo RRHH.",
                      confirmLabel: "Evaluar con IA",
                    }}
                  >
                    {aiJob?.active ? "IA en cola" : "Evaluar con IA"}
                  </ActionButton>
                ) : ai?.available ? (
                  <ActionButton
                    variant="outline"
                    action={runEvaluation.bind(null, application.id, "ia")}
                    disabled={!criteriaApproved}
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
                ) : null}
                <span className="text-xs text-muted-foreground">
                  CV evaluado:{" "}
                  {application.resume
                    ? `versión ${application.resume.version} (${application.resume.original_filename})`
                    : currentResume
                      ? `versión vigente (${currentResume.version})`
                      : "el candidato aún no tiene CV"}
                </span>
              </div>
              {aiJob ? <AiJobStatus message={aiJob.message} tone={aiJob.tone} active={aiJob.active} /> : null}
              {aiWorkerNotice ? (
                <p role="status" className="rounded-md border border-warning-foreground/40 bg-warning px-3 py-2 text-sm text-warning-foreground">
                  {aiWorkerNotice.message}
                </p>
              ) : null}
              {newerResume && canManage ? (
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-warning-foreground/40 bg-warning px-3 py-2 text-sm text-warning-foreground">
                  <span>Existe una versión más reciente del CV (v{newerResume.version}).</span>
                  <ActionButton size="sm" variant="outline" action={linkCurrentResume.bind(null, application.id)}>
                    Usar versión {newerResume.version}
                  </ActionButton>
                </div>
              ) : null}
              {!criteriaApproved ? (
                <p className="text-sm text-warning-foreground">
                  Los criterios de la vacante no están aprobados.{" "}
                  <Link href={`/vacantes/${application.vacancy.id}?tab=criterios`} className="underline">
                    Revisarlos
                  </Link>
                </p>
              ) : null}
            </div>
          ) : null}

          <KillerAnswersCard answers={killerAnswers} />
          <EvaluationCard
            applicationId={application.id}
            evaluation={selected}
            items={items}
            history={evaluations}
            isCurrent={selected?.id === main?.id}
            secondOpinion={secondOpinionEvaluation ? { evaluation: secondOpinionEvaluation, items: secondOpinionItems } : null}
            currentCriteriaVersion={application.vacancy.criteria_version}
            canReview={can(user.role, "evaluations:review")}
            verifications={verifications}
          />
          {interviewGuide ? <InterviewGuideCard guide={interviewGuide} /> : null}
          <Card>
            <CardHeader>
              <CardTitle>Estado del proceso</CardTitle>
              <CardDescription>Su decisión. Último cambio: {formatDateTime(application.status_changed_at)}.</CardDescription>
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
                <CardTitle>Comunicación con el candidato</CardTitle>
                <CardDescription>
                  Envíe un correo directo a la persona candidata. Queda registrado en el historial (solo el asunto).
                </CardDescription>
              </CardHeader>
              <CardContent>
                {application.candidate.email ? (
                  <CandidateMessageDialog applicationId={application.id} candidateName={application.candidate.full_name} />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    La persona candidata no tiene un correo registrado, por lo que no se le puede escribir desde aquí.
                  </p>
                )}
              </CardContent>
            </Card>
          ) : null}

          <Card id="entrevistas">
            <CardHeader>
              <CardTitle>Entrevistas</CardTitle>
              <CardDescription>Fechas y horas en hora de Perú (Lima).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {schedulable ? (
                <InterviewFormDialog
                  applicationId={application.id}
                  defaultOpen={search.programar === "1"}
                  trigger={<Button type="button">Programar entrevista</Button>}
                />
              ) : null}
              {interviews.length === 0 ? (
                <EmptyState
                  title="Sin entrevistas"
                  description={schedulable ? "Programe una entrevista para este candidato." : "Esta postulación no tiene entrevistas registradas."}
                />
              ) : (
                <ul className="space-y-2">
                  {interviews.map(({ result_recorder, ...interview }) => {
                    const entries = scorecardsByInterview.get(interview.id) ?? [];
                    const myEntry = entries.find((entry) => entry.evaluatorId === user.id) ?? null;
                    return (
                      <InterviewItem
                        key={interview.id}
                        showApplication={false}
                        canManage={canManage}
                        interview={{
                          ...interview,
                          recordedBy: result_recorder?.full_name ?? null,
                          application: {
                            id: application.id,
                            status: application.status,
                            candidateName: application.candidate.full_name,
                            vacancyId: application.vacancy.id,
                            vacancyTitle: application.vacancy.title,
                            vacancyStatus: application.vacancy.status,
                          },
                        }}
                      >
                        <InterviewEvaluation
                          interviewId={interview.id}
                          interviewStatus={interview.status}
                          entries={entries}
                          myEntry={myEntry}
                          canEvaluate={canManage}
                        />
                      </InterviewItem>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          {evaluationRounds.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Resumen de evaluaciones</CardTitle>
                <CardDescription>
                  Valoración del equipo por entrevista (promedio y recomendaciones). El detalle de cada ronda está en su
                  entrevista.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <CandidateEvaluationSummary rounds={evaluationRounds} />
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

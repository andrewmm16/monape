import Link from "next/link";
import { AssessmentBadge, CompatibilityBadge } from "@/components/common/badges";
import { EmptyState } from "@/components/common/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime, formatNumericDate, formatPercent } from "@/lib/format";
import {
  ASSESSMENT_DESCRIPTIONS,
  ASSESSMENT_LABELS,
  EVALUATION_METHOD_LABELS,
  REQUIREMENT_CATEGORY_LABELS,
  REQUIREMENT_PRIORITY_LABELS,
  REVIEW_OUTCOME_LABELS,
  SYSTEM_ACTOR_LABEL,
  VERIFICATION_SOURCE_LABELS,
  VERIFICATION_SOURCE_PHRASES,
} from "@/lib/labels";
import { cn } from "@/lib/utils";
import type { listEvaluationItems, listEvaluations, listRequirementVerifications } from "@/modules/applications/queries";
import { Constants } from "@/types/database";
import { ReviewForm } from "./review-form";
import { RemoveVerificationDialog, VerifyRequirementDialog } from "./verification-dialog";

type Evaluation = Awaited<ReturnType<typeof listEvaluations>>[number];
type Item = Awaited<ReturnType<typeof listEvaluationItems>>[number];
type Verification = Awaited<ReturnType<typeof listRequirementVerifications>>[number];

const VERIFIED_TONES = {
  acreditado: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
  no_cumplido: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-100",
} as const;

/** Origen de la valoración: lo que dice el CV o lo que RRHH comprobó después. */
function OriginBadge({ item }: { item: Item }) {
  if (!item.verification_source) {
    return (
      <Badge variant="outline" className="border-transparent bg-muted text-foreground">
        Según el CV
      </Badge>
    );
  }
  const tone = item.assessment === "no_cumplido" ? VERIFIED_TONES.no_cumplido : VERIFIED_TONES.acreditado;
  return (
    <Badge variant="outline" className={cn("border-transparent", tone)}>
      Verificado · {VERIFICATION_SOURCE_LABELS[item.verification_source]}
    </Badge>
  );
}

function ScoreMeter({ score, potential }: { score: number; potential: number }) {
  return (
    <div className="space-y-1.5">
      <div
        className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={`${Math.round(score)} % del peso acreditado; hasta ${Math.round(potential)} % si se confirman los requisitos sin evidencia o pendientes`}
      >
        <span className="h-full bg-primary" style={{ width: `${score}%` }} />
        <span className="ml-0.5 h-full bg-primary/30" style={{ width: `${Math.max(0, potential - score)}%` }} />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-primary" aria-hidden /> Acreditado {formatPercent(score)}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-primary/30" aria-hidden /> Sin evidencia o pendiente{" "}
          {formatPercent(potential - score)}
        </span>
        <span>Aparentemente no cumplido {formatPercent(100 - potential)}</span>
      </div>
    </div>
  );
}

type Evidence = { quote?: string };

export function EvaluationCard({
  applicationId,
  evaluation,
  items,
  history,
  currentCriteriaVersion,
  canReview,
  verifications = [],
}: {
  applicationId: string;
  evaluation: Evaluation | null;
  items: Item[];
  history: Evaluation[];
  currentCriteriaVersion: number;
  canReview: boolean;
  verifications?: Verification[];
}) {
  if (!evaluation) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Evaluación de compatibilidad</CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyState
            title="Evaluación pendiente"
            description="Aún no se ha evaluado esta postulación. La evaluación es orientativa y no modifica el estado del proceso."
          />
        </CardContent>
      </Card>
    );
  }

  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
  const outdated = evaluation.criteria_version < currentCriteriaVersion;
  const verifiedCount = items.filter((item) => item.verification_source).length;
  // Solo se verifica sobre la evaluación más reciente y con criterios vigentes.
  const canVerify = canReview && !outdated && history[0]?.id === evaluation.id;
  const currentVerification = new Map(verifications.map((v) => [v.requirement_id, v]));

  return (
    <Card>
      <CardHeader className="gap-2">
        <CardTitle className="flex flex-wrap items-center gap-2">
          Evaluación de compatibilidad <CompatibilityBadge level={evaluation.level} />
        </CardTitle>
        <CardDescription>
          {EVALUATION_METHOD_LABELS[evaluation.method]} · {evaluation.method_version}
          {evaluation.model ? ` · modelo ${evaluation.model}` : ""} · metodología de puntuación {evaluation.scoring_version} ·
          criterios v{evaluation.criteria_version}
          {evaluation.resume ? ` · CV v${evaluation.resume.version}` : ""} · {formatDateTime(evaluation.created_at)}
          {` · ${evaluation.author?.full_name ?? SYSTEM_ACTOR_LABEL}`}
        </CardDescription>
        {outdated ? (
          <p className="text-sm text-amber-700 dark:text-amber-400">
            Los criterios de la vacante cambiaron después de esta evaluación (vigente: v{currentCriteriaVersion}). Genere una nueva
            evaluación.
          </p>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-6">
        <ScoreMeter score={evaluation.score} potential={evaluation.score_potential} />
        <p className="text-sm">{evaluation.summary}</p>
        <p className="text-sm font-medium">
          Requisitos verificados: {verifiedCount} de {items.length}
        </p>

        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Detalle por requisito</h3>
          <ul className="space-y-3">
            {items.map((item) => {
              const evidence = (Array.isArray(item.evidence) ? item.evidence : []) as Evidence[];
              const verified = Boolean(item.verification_source);
              const verification = item.requirement_id ? currentVerification.get(item.requirement_id) : undefined;
              const hasVerification = verified || Boolean(verification);
              return (
                <li key={item.id} className="rounded-md border p-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="font-medium">{item.description}</div>
                      <div className="mt-1 flex flex-wrap gap-1 text-xs text-muted-foreground">
                        <span>{REQUIREMENT_CATEGORY_LABELS[item.category]}</span>·
                        <span>{REQUIREMENT_PRIORITY_LABELS[item.priority]}</span>·
                        <span>
                          peso {item.weight} ({totalWeight ? Math.round((item.weight / totalWeight) * 100) : 0} %)
                        </span>
                        {item.is_essential ? <Badge variant="outline">Legal o esencial</Badge> : null}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
                      <OriginBadge item={item} />
                      {verified ? (
                        <span
                          className={cn(
                            "inline-flex h-5 items-center rounded-4xl px-2 text-xs font-medium",
                            VERIFIED_TONES[item.assessment === "no_cumplido" ? "no_cumplido" : "acreditado"],
                          )}
                        >
                          {item.assessment === "no_cumplido" ? "No cumple" : "Cumple"}
                        </span>
                      ) : (
                        <span title={ASSESSMENT_DESCRIPTIONS[item.assessment]}>
                          <AssessmentBadge assessment={item.assessment} />
                        </span>
                      )}
                    </div>
                  </div>
                  {verified && item.verification_source ? (
                    <div className="mt-2 space-y-1 text-sm">
                      <p>
                        Verificado en {VERIFICATION_SOURCE_PHRASES[item.verification_source]} el{" "}
                        {formatNumericDate(item.verified_at)} por {item.verifier?.full_name ?? "RRHH"}:{" "}
                        <span className="whitespace-pre-wrap">«{item.verification_note}»</span>
                      </p>
                      {item.cv_assessment ? (
                        <p className="text-xs text-muted-foreground">
                          Según el CV: {ASSESSMENT_LABELS[item.cv_assessment].toLowerCase()}
                        </p>
                      ) : null}
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-muted-foreground">{item.rationale}</p>
                  )}
                  {evidence.length > 0 ? (
                    <div className="mt-2 space-y-1">
                      <p className="text-xs font-medium">Evidencia en el CV:</p>
                      {evidence.map((e, index) => (
                        <blockquote key={index} className="border-l-2 border-primary/40 pl-2 text-xs italic">
                          {e.quote}
                        </blockquote>
                      ))}
                    </div>
                  ) : null}
                  {canVerify && item.requirement_id ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <VerifyRequirementDialog
                        applicationId={applicationId}
                        requirementId={item.requirement_id}
                        requirementDescription={item.description}
                        initialValues={
                          verification
                            ? {
                                result: verification.result as "acreditado" | "no_cumplido",
                                source: verification.source,
                                note: verification.note,
                              }
                            : undefined
                        }
                        trigger={
                          <Button type="button" size="sm" variant="outline" className="h-9 sm:h-7">
                            {hasVerification ? "Cambiar" : "Verificar"}
                          </Button>
                        }
                      />
                      {hasVerification ? (
                        <RemoveVerificationDialog
                          applicationId={applicationId}
                          requirementId={item.requirement_id}
                          requirementDescription={item.description}
                          trigger={
                            <Button type="button" size="sm" variant="ghost" className="h-9 sm:h-7">
                              Quitar verificación
                            </Button>
                          }
                        />
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>

        <div className="space-y-1 rounded-md bg-muted/50 p-3">
          <h3 className="text-sm font-semibold">Limitaciones de esta evaluación</h3>
          <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
            {evaluation.limitations.map((limitation) => (
              <li key={limitation}>{limitation}</li>
            ))}
          </ul>
          <p className="pt-1 text-xs text-muted-foreground">
            Valoraciones posibles:{" "}
            {Constants.public.Enums.requirement_assessment.map((a) => ASSESSMENT_DESCRIPTIONS[a]).join(" ")}
          </p>
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Revisión de RRHH</h3>
          {evaluation.review_status === "revisada" && evaluation.review_outcome ? (
            <div className="text-sm">
              <p>
                <span className="font-medium">{REVIEW_OUTCOME_LABELS[evaluation.review_outcome]}</span>
                {evaluation.reviewer ? ` · ${evaluation.reviewer.full_name}` : ""} · {formatDateTime(evaluation.reviewed_at)}
              </p>
              {evaluation.review_notes ? <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{evaluation.review_notes}</p> : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Pendiente de revisión.</p>
          )}
          {canReview && evaluation.review_status === "pendiente_revision" ? (
            <ReviewForm applicationId={applicationId} evaluationId={evaluation.id} />
          ) : null}
        </div>

        {history.length > 1 ? (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Historial de evaluaciones</h3>
            <ul className="divide-y rounded-md border text-sm">
              {history.map((entry) => (
                <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <Link
                    href={`/postulaciones/${applicationId}?evaluacion=${entry.id}`}
                    className={entry.id === evaluation.id ? "font-semibold" : "hover:underline"}
                  >
                    {formatDateTime(entry.created_at)} · {EVALUATION_METHOD_LABELS[entry.method]} · criterios v{entry.criteria_version}
                  </Link>
                  <span className="flex items-center gap-2">
                    <CompatibilityBadge level={entry.level} />
                    <span className="text-xs text-muted-foreground">{formatPercent(entry.score)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

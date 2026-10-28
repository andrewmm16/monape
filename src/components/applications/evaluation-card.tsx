import Link from "next/link";
import { AssessmentBadge, CompatibilityBadge } from "@/components/common/badges";
import { EmptyState } from "@/components/common/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime, formatPercent } from "@/lib/format";
import {
  ASSESSMENT_DESCRIPTIONS,
  EVALUATION_METHOD_LABELS,
  REQUIREMENT_CATEGORY_LABELS,
  REQUIREMENT_PRIORITY_LABELS,
  REVIEW_OUTCOME_LABELS,
  SYSTEM_ACTOR_LABEL,
} from "@/lib/labels";
import type { listEvaluationItems, listEvaluations } from "@/modules/applications/queries";
import { Constants } from "@/types/database";
import { ReviewForm } from "./review-form";

type Evaluation = Awaited<ReturnType<typeof listEvaluations>>[number];
type Item = Awaited<ReturnType<typeof listEvaluationItems>>[number];

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
}: {
  applicationId: string;
  evaluation: Evaluation | null;
  items: Item[];
  history: Evaluation[];
  currentCriteriaVersion: number;
  canReview: boolean;
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

        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Detalle por requisito</h3>
          <ul className="space-y-3">
            {items.map((item) => {
              const evidence = (Array.isArray(item.evidence) ? item.evidence : []) as Evidence[];
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
                    <span title={ASSESSMENT_DESCRIPTIONS[item.assessment]}>
                      <AssessmentBadge assessment={item.assessment} />
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">{item.rationale}</p>
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

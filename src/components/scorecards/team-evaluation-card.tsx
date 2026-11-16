import { ActionButton } from "@/components/common/action-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { deleteScorecard } from "@/modules/scorecards/actions";
import type { Consolidation, ScorecardEntry } from "@/modules/scorecards/consolidation";
import { COMPETENCY_LABELS, RECOMMENDATION_LABELS, SCORE_MAX } from "@/modules/scorecards/defaults";
import { ScorecardDialog } from "./scorecard-dialog";

const RECOMMENDATION_CLASS: Record<keyof Consolidation["recommendations"], string> = {
  avanza: "bg-success text-success-foreground",
  duda: "bg-warning text-warning-foreground",
  no_avanza: "bg-destructive/15 text-destructive",
};

function fmt(value: number | null): string {
  return value === null ? "—" : value.toFixed(1);
}

function RecommendationBadge({ value }: { value: keyof typeof RECOMMENDATION_LABELS }) {
  return (
    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", RECOMMENDATION_CLASS[value])}>
      {RECOMMENDATION_LABELS[value]}
    </span>
  );
}

/**
 * Evaluación colaborativa de una postulación: consolidado del equipo (promedios,
 * desacuerdos, recomendaciones) y la tarjeta de cada evaluador. Cada persona
 * crea/edita solo la suya. Es un insumo; no cambia el estado del proceso.
 */
export function TeamEvaluationCard({
  applicationId,
  entries,
  consolidation,
  myEntry,
  canEvaluate,
}: {
  applicationId: string;
  entries: ScorecardEntry[];
  consolidation: Consolidation;
  myEntry: ScorecardEntry | null;
  canEvaluate: boolean;
}) {
  const hasEntries = entries.length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Evaluación del equipo</CardTitle>
        <CardDescription>
          Varias personas puntúan al candidato con la misma rúbrica (1–5) tras la entrevista. Es un insumo para la
          decisión; no cambia el estado del proceso.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {hasEntries ? (
          <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm">
                <span className="text-2xl font-semibold tabular-nums">{fmt(consolidation.overall)}</span>
                <span className="text-muted-foreground"> / {SCORE_MAX} · promedio general</span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-muted-foreground">{consolidation.evaluators} evaluador(es):</span>
                {(["avanza", "duda", "no_avanza"] as const).map((key) =>
                  consolidation.recommendations[key] > 0 ? (
                    <span key={key} className="inline-flex items-center gap-1">
                      <RecommendationBadge value={key} /> {consolidation.recommendations[key]}
                    </span>
                  ) : null,
                )}
              </div>
            </div>
            <ul className="space-y-1.5">
              {consolidation.perCompetency.map((item) => (
                <li key={item.competency} className="flex items-center gap-3 text-sm">
                  <span className="w-40 shrink-0 truncate">{item.label}</span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <span
                      className="block h-full rounded-full bg-brand"
                      style={{ width: item.average === null ? "0%" : `${(item.average / SCORE_MAX) * 100}%` }}
                    />
                  </span>
                  <span className="w-8 shrink-0 text-right tabular-nums">{fmt(item.average)}</span>
                  {item.disagreement ? (
                    <span className="shrink-0 text-xs font-medium text-warning-foreground" title={`Rango ${item.min}–${item.max}`}>
                      ⚠ desacuerdo
                    </span>
                  ) : (
                    <span className="w-[72px] shrink-0" aria-hidden />
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Aún no hay evaluaciones del equipo.{canEvaluate ? " Sé el primero en evaluar a este candidato." : ""}
          </p>
        )}

        {hasEntries ? (
          <ul className="divide-y">
            {entries.map((entry) => (
              <li key={entry.id} className="space-y-1.5 py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium">
                    {entry.evaluatorName ?? "Evaluador"}
                    {myEntry && entry.id === myEntry.id ? <span className="text-muted-foreground"> · tú</span> : null}
                  </span>
                  <RecommendationBadge value={entry.recommendation} />
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  {entry.scores.map((score) => (
                    <span key={score.competency} className="tabular-nums">
                      {COMPETENCY_LABELS[score.competency as keyof typeof COMPETENCY_LABELS] ?? score.competency}:{" "}
                      <span className="font-medium text-foreground">{score.score}</span>
                    </span>
                  ))}
                </div>
                {entry.comment ? <p className="text-sm">{entry.comment}</p> : null}
              </li>
            ))}
          </ul>
        ) : null}

        {canEvaluate ? (
          <div className="flex flex-wrap items-center gap-2">
            <ScorecardDialog applicationId={applicationId} existing={myEntry} />
            {myEntry ? (
              <ActionButton
                variant="outline"
                action={deleteScorecard.bind(null, applicationId)}
                confirm={{
                  title: "¿Eliminar tu evaluación?",
                  description: "Se quitará tu tarjeta de este candidato. Puedes volver a evaluar después.",
                  confirmLabel: "Eliminar",
                }}
              >
                Eliminar mi evaluación
              </ActionButton>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

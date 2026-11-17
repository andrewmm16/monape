import { ActionButton } from "@/components/common/action-button";
import { cn } from "@/lib/utils";
import { deleteScorecard } from "@/modules/scorecards/actions";
import { consolidateScorecards, type Consolidation, type ScorecardEntry } from "@/modules/scorecards/consolidation";
import { COMPETENCY_LABELS, RECOMMENDATION_LABELS, SCORE_MAX } from "@/modules/scorecards/defaults";
import type { Enums } from "@/types/database";
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

function RecommendationTally({ consolidation }: { consolidation: Consolidation }) {
  return (
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
  );
}

/**
 * Evaluación del equipo para UNA entrevista. Se habilita cuando la entrevista ya
 * tiene resultado registrado (estado «realizada»): se valora lo observado en la
 * entrevista, no el CV. Cada persona crea/edita solo su tarjeta; es un insumo y
 * no cambia el estado del proceso ni la puntuación del motor.
 */
export function InterviewEvaluation({
  interviewId,
  interviewStatus,
  entries,
  myEntry,
  canEvaluate,
}: {
  interviewId: string;
  interviewStatus: Enums<"interview_status">;
  entries: ScorecardEntry[];
  myEntry: ScorecardEntry | null;
  canEvaluate: boolean;
}) {
  // Solo las entrevistas realizadas son evaluables. En las programadas, un aviso;
  // en «no asistió» o «cancelada», nada.
  if (interviewStatus !== "realizada") {
    if (interviewStatus === "programada" && canEvaluate) {
      return (
        <p className="rounded-md border border-dashed bg-muted/20 p-2 text-xs text-muted-foreground">
          La evaluación del equipo se habilita cuando registres el resultado de esta entrevista.
        </p>
      );
    }
    return null;
  }

  const consolidation = consolidateScorecards(entries);
  const hasEntries = entries.length > 0;

  return (
    <div className="space-y-3 rounded-md border bg-muted/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">Evaluación del equipo</span>
        {hasEntries ? <RecommendationTally consolidation={consolidation} /> : null}
      </div>

      {hasEntries ? (
        <>
          <div className="flex items-baseline gap-1">
            <span className="text-xl font-semibold tabular-nums">{fmt(consolidation.overall)}</span>
            <span className="text-xs text-muted-foreground">/ {SCORE_MAX} · promedio general</span>
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
                  <span
                    className="shrink-0 text-xs font-medium text-warning-foreground"
                    title={`Rango ${item.min}–${item.max}`}
                  >
                    ⚠ desacuerdo
                  </span>
                ) : (
                  <span className="w-[72px] shrink-0" aria-hidden />
                )}
              </li>
            ))}
          </ul>
          <ul className="divide-y">
            {entries.map((entry) => (
              <li key={entry.id} className="space-y-1.5 py-2.5 first:pt-0 last:pb-0">
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
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          Aún no hay evaluaciones de esta entrevista.{canEvaluate ? " Sé el primero en evaluarla." : ""}
        </p>
      )}

      {canEvaluate ? (
        <div className="flex flex-wrap items-center gap-2">
          <ScorecardDialog interviewId={interviewId} existing={myEntry} />
          {myEntry ? (
            <ActionButton
              variant="outline"
              action={deleteScorecard.bind(null, interviewId)}
              confirm={{
                title: "¿Eliminar tu evaluación?",
                description: "Se quitará tu tarjeta de esta entrevista. Puedes volver a evaluar después.",
                confirmLabel: "Eliminar",
              }}
            >
              Eliminar mi evaluación
            </ActionButton>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export type EvaluationRound = {
  interviewId: string;
  label: string;
  consolidation: Consolidation;
};

/**
 * Resumen de las evaluaciones del candidato por ronda: deja ver la progresión
 * entre entrevistas (y lo que quedó por corroborar en la siguiente). Solo
 * aparecen las entrevistas que ya tienen al menos una evaluación.
 */
export function CandidateEvaluationSummary({ rounds }: { rounds: EvaluationRound[] }) {
  if (rounds.length === 0) return null;
  return (
    <ul className="space-y-2">
      {rounds.map((round) => (
        <li key={round.interviewId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="min-w-0">
            <span className="font-medium">{round.label}</span>
            <span className="text-muted-foreground">
              {" "}
              · {fmt(round.consolidation.overall)}/{SCORE_MAX}
            </span>
          </span>
          <RecommendationTally consolidation={round.consolidation} />
        </li>
      ))}
    </ul>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  RECOMMENDATION_LABELS,
  SCORECARD_COMPETENCIES,
  SCORECARD_RECOMMENDATIONS,
  SCORE_MAX,
  SCORE_MIN,
} from "@/modules/scorecards/defaults";
import type { ScorecardEntry } from "@/modules/scorecards/consolidation";
import { saveScorecard } from "@/modules/scorecards/actions";
import type { Enums } from "@/types/database";

const SCORE_VALUES = Array.from({ length: SCORE_MAX - SCORE_MIN + 1 }, (_, i) => SCORE_MIN + i);

type Recommendation = Enums<"scorecard_recommendation">;

/** Formulario para crear o editar la propia evaluación (scorecard) de una postulación. */
export function ScorecardDialog({
  interviewId,
  existing,
}: {
  interviewId: string;
  existing: ScorecardEntry | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const initialScores = () =>
    Object.fromEntries(
      SCORECARD_COMPETENCIES.map((competency) => [
        competency.key,
        existing?.scores.find((score) => score.competency === competency.key)?.score ?? null,
      ]),
    ) as Record<string, number | null>;

  const [scores, setScores] = useState<Record<string, number | null>>(initialScores);
  const [recommendation, setRecommendation] = useState<Recommendation | null>(existing?.recommendation ?? null);
  const [comment, setComment] = useState(existing?.comment ?? "");

  const reset = () => {
    setScores(initialScores());
    setRecommendation(existing?.recommendation ?? null);
    setComment(existing?.comment ?? "");
  };

  const complete = recommendation !== null && SCORECARD_COMPETENCIES.every((c) => scores[c.key] != null);

  const submit = () =>
    startTransition(async () => {
      if (!complete || recommendation === null) return;
      const result = await saveScorecard({
        interviewId,
        recommendation,
        comment,
        scores: SCORECARD_COMPETENCIES.map((competency) => ({
          competency: competency.key,
          score: scores[competency.key] as number,
          comment: "",
        })),
      });
      if (result.ok) {
        toast.success(existing ? "Evaluación actualizada." : "Evaluación registrada.");
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant={existing ? "outline" : "default"}>
          {existing ? "Editar mi evaluación" : "Evaluar"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{existing ? "Editar mi evaluación" : "Evaluar al candidato"}</DialogTitle>
          <DialogDescription>
            Puntúa cada competencia del 1 al 5 y da tu recomendación. Es tu valoración; no cambia el estado del proceso.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {SCORECARD_COMPETENCIES.map((competency) => (
            <div key={competency.key} className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">{competency.label}</span>
              <div className="flex gap-1.5" role="group" aria-label={competency.label}>
                {SCORE_VALUES.map((value) => (
                  <Button
                    key={value}
                    type="button"
                    size="sm"
                    variant={scores[competency.key] === value ? "default" : "outline"}
                    aria-pressed={scores[competency.key] === value}
                    className="w-9 px-0 tabular-nums"
                    onClick={() => setScores((prev) => ({ ...prev, [competency.key]: value }))}
                  >
                    {value}
                  </Button>
                ))}
              </div>
            </div>
          ))}

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Recomendación</span>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Recomendación">
              {SCORECARD_RECOMMENDATIONS.map((option) => (
                <Button
                  key={option.key}
                  type="button"
                  size="sm"
                  variant={recommendation === option.key ? "default" : "outline"}
                  aria-pressed={recommendation === option.key}
                  onClick={() => setRecommendation(option.key)}
                >
                  {RECOMMENDATION_LABELS[option.key]}
                </Button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="scorecard-comment">Comentario (opcional)</Label>
            <Textarea
              id="scorecard-comment"
              rows={4}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              placeholder="Qué observaste en la entrevista, fortalezas, dudas…"
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button type="button" onClick={submit} disabled={!complete || pending}>
            {pending ? "Guardando…" : "Guardar evaluación"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { CircleAlertIcon, CircleCheckIcon } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { killerAnswerText } from "@/modules/evaluation/interview-topics";
import type { Enums } from "@/types/database";

export type KillerAnswerRow = {
  id: string;
  meets: boolean;
  answer_boolean: boolean | null;
  answer_number: number | null;
  answer_text: string | null;
  question: { question: string; question_type: Enums<"killer_question_type"> } | null;
};

/**
 * Respuestas del candidato a las preguntas eliminatorias. Es solo una marca para
 * RRHH: no cambia el estado ni oculta a nadie, la decisión sigue siendo de una persona.
 */
export function KillerAnswersCard({ answers }: { answers: KillerAnswerRow[] }) {
  if (answers.length === 0) return null;
  const failed = answers.filter((a) => !a.meets);
  return (
    <Card id="preguntas-eliminatorias">
      <CardHeader>
        <CardTitle>Preguntas eliminatorias</CardTitle>
        <CardDescription>
          Respuestas declaradas por el candidato al postular. Son informativas: la postulación sigue su curso hasta que
          usted decida.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {failed.length > 0 ? (
          <ul className="space-y-1 rounded-md border border-warning-foreground/40 bg-warning px-3 py-2 text-sm text-warning-foreground">
            {failed.map((a) => (
              <li key={a.id} className="flex items-start gap-1.5">
                <CircleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>No cumple la condición indicada: {a.question?.question ?? "pregunta eliminada"}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <ul className="space-y-2 text-sm">
          {answers.map((a) => (
            <li key={a.id} className="flex items-start gap-2">
              {a.meets ? (
                <CircleCheckIcon className="mt-0.5 size-4 shrink-0 text-success-foreground" aria-label="Cumple" />
              ) : (
                <CircleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning-foreground" aria-label="No cumple" />
              )}
              <span>
                {a.question?.question ?? "Pregunta eliminada"}
                <span className="block text-muted-foreground">Respuesta: {killerAnswerText(a)}</span>
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

import { CircleAlertIcon, CircleCheckIcon } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
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
 * Cada pregunta aparece una sola vez; las que no cumplen van primero y resaltadas.
 */
export function KillerAnswersCard({ answers }: { answers: KillerAnswerRow[] }) {
  if (answers.length === 0) return null;
  const failed = answers.filter((a) => !a.meets).length;
  return (
    <Card id="preguntas-eliminatorias">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Preguntas eliminatorias
          <span className={cn("text-sm font-normal", failed > 0 ? "text-warning-foreground" : "text-muted-foreground")}>
            {failed > 0 ? `${failed} de ${answers.length} no cumplen` : "Todas cumplen"}
          </span>
        </CardTitle>
        <CardDescription>
          Respuestas declaradas por el candidato al postular. Son informativas: la postulación sigue su curso hasta que
          usted decida.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2 text-sm">
          {answers.map((a) => (
            <li
              key={a.id}
              className={cn(
                "flex items-start gap-2 rounded-md px-3 py-2",
                a.meets ? "border" : "border border-warning-foreground/40 bg-warning text-warning-foreground",
              )}
            >
              {a.meets ? (
                <CircleCheckIcon className="mt-0.5 size-4 shrink-0 text-success-foreground" aria-label="Cumple" />
              ) : (
                <CircleAlertIcon className="mt-0.5 size-4 shrink-0" aria-label="No cumple" />
              )}
              <span className="min-w-0">
                {a.question?.question ?? "Pregunta eliminada"}
                <span className={cn("block", a.meets ? "text-muted-foreground" : "font-medium")}>
                  Respuesta: {killerAnswerText(a)}
                  {a.meets ? "" : " · no cumple la condición indicada"}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

import { PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { ActionButton } from "@/components/common/action-button";
import { EmptyState } from "@/components/common/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { KILLER_COMPARATOR_LABELS, KILLER_QUESTION_TYPE_LABELS } from "@/lib/labels";
import { deleteKillerQuestion } from "@/modules/vacancies/actions";
import type { Tables } from "@/types/database";
import { KillerQuestionDialog } from "./killer-question-dialog";

type Question = Tables<"vacancy_killer_questions">;

/** Texto legible de la condición que "cumple" (solo lo ve RRHH). */
function conditionLabel(q: Question): string {
  if (q.question_type === "si_no") return `Cumple con: ${q.expected_boolean ? "Sí" : "No"}`;
  if (q.question_type === "numero") {
    return `Cumple si es ${(q.comparator ? KILLER_COMPARATOR_LABELS[q.comparator] : "").toLowerCase()} ${q.threshold}`;
  }
  return `Cumple con: ${(q.accepted_options ?? []).join(", ")} (de ${(q.options ?? []).join(", ")})`;
}

export function KillerQuestionsPanel({
  vacancyId,
  questions,
  canManage,
}: {
  vacancyId: string;
  questions: Question[];
  canManage: boolean;
}) {
  if (!canManage) return null;

  return (
    <Card>
      <CardHeader className="gap-3 sm:flex sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <CardTitle>Preguntas eliminatorias</CardTitle>
          <CardDescription>
            Preguntas de respuesta cerrada que el candidato contesta al postular. Si una respuesta no cumple, la
            postulación se marca como «no cumple la condición indicada»: nunca se descarta ni cambia de estado por sí sola,
            y RRHH ve a todos los candidatos.
          </CardDescription>
        </div>
        <KillerQuestionDialog
          vacancyId={vacancyId}
          trigger={
            <Button variant="outline">
              <PlusIcon /> Agregar pregunta
            </Button>
          }
        />
      </CardHeader>
      <CardContent>
        {questions.length === 0 ? (
          <EmptyState
            title="Sin preguntas eliminatorias"
            description="Úselas para requisitos objetivos que no se leen en el CV: residencia, licencias, disponibilidad o pretensión salarial."
          />
        ) : (
          <Table stacked>
            <TableHeader>
              <TableRow>
                <TableHead>Pregunta</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Condición</TableHead>
                <TableHead className="w-24 text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {questions.map((question) => (
                <TableRow key={question.id}>
                  <TableCell className="max-w-md whitespace-normal">
                    <div className="font-medium">{question.question}</div>
                    {question.is_required ? <Badge variant="outline" className="mt-1">Obligatoria</Badge> : null}
                  </TableCell>
                  <TableCell data-label="Tipo">{KILLER_QUESTION_TYPE_LABELS[question.question_type]}</TableCell>
                  <TableCell data-label="Condición" className="max-w-xs whitespace-normal text-sm text-muted-foreground">
                    {conditionLabel(question)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1 max-sm:gap-3">
                      <KillerQuestionDialog
                        vacancyId={vacancyId}
                        questionId={question.id}
                        initialValues={{
                          question: question.question,
                          questionType: question.question_type,
                          helpText: question.help_text ?? "",
                          isRequired: question.is_required,
                          expectedBoolean: question.expected_boolean === null ? "" : question.expected_boolean ? "si" : "no",
                          comparator: question.comparator ?? "",
                          threshold: question.threshold === null ? "" : String(question.threshold),
                          options: (question.options ?? []).join("\n"),
                          acceptedOptions: (question.accepted_options ?? []).join("\n"),
                        }}
                        trigger={
                          <Button variant="ghost" size="icon-sm" aria-label="Editar pregunta">
                            <PencilIcon />
                          </Button>
                        }
                      />
                      <ActionButton
                        variant="ghost"
                        size="icon-sm"
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        action={deleteKillerQuestion.bind(null, vacancyId, question.id)}
                        confirm={{
                          title: "¿Eliminar pregunta?",
                          description: "Se eliminarán también las respuestas que los candidatos ya dieron a esta pregunta.",
                          confirmLabel: "Eliminar",
                        }}
                      >
                        <Trash2Icon aria-label="Eliminar pregunta" />
                      </ActionButton>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

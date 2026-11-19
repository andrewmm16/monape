import { MessageCircleQuestionIcon } from "lucide-react";
import { AssessmentBadge } from "@/components/common/badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { GuideQuestion } from "@/modules/evaluation/interview-guide";
import type { InterviewTopic } from "@/modules/evaluation/interview-topics";

/** Ancla de la tarjeta: el aviso de arriba, la tarjeta de Entrevistas y la página Entrevistas enlazan aquí. */
export const INTERVIEW_GUIDE_ANCHOR = "preguntas-entrevista";

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * Aviso bajo el encabezado de la postulación: se ve sin desplazarse y lleva a
 * la tarjeta de preguntas. Solo aparece si hay algo que preguntar.
 */
export function InterviewQuestionsCallout({ pending, topics }: { pending: number; topics: number }) {
  const total = pending + topics;
  if (total === 0) return null;
  const detail = [
    pending > 0 ? plural(pending, "requisito por confirmar", "requisitos por confirmar") : null,
    topics > 0 ? plural(topics, "punto por aclarar", "puntos por aclarar") : null,
  ]
    .filter(Boolean)
    .join(" y ");
  return (
    <div
      role="note"
      data-testid="interview-questions-callout"
      className="mx-auto mb-6 flex max-w-3xl flex-col gap-3 rounded-lg border border-brand/30 bg-brand/5 p-4 sm:flex-row sm:items-center sm:justify-between xl:max-w-none"
    >
      <div className="flex items-start gap-3">
        <MessageCircleQuestionIcon className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden />
        <div className="space-y-0.5">
          <p className="font-medium">
            {total === 1 ? "1 pregunta recomendada" : `${total} preguntas recomendadas`} para la entrevista
          </p>
          <p className="text-sm text-muted-foreground">Según su CV y lo que respondió al postular: {detail}.</p>
        </div>
      </div>
      <Button asChild variant="outline" className="w-full sm:w-auto">
        <a href={`#${INTERVIEW_GUIDE_ANCHOR}`}>Ver preguntas</a>
      </Button>
    </div>
  );
}

/**
 * Preguntas recomendadas para la entrevista de esta persona.
 *
 * - Requisitos: solo lo que el CV no acredita, con la pregunta, el porqué y qué
 *   respuesta cuenta como «cumple». Lo que se confirme se registra con el
 *   resultado de la entrevista (o «Verificar») y recalcula la puntuación.
 * - Otros puntos: respuestas eliminatorias que no cumplen y fechas del CV que no
 *   cuadran. Solo se aclaran; no cambian la puntuación.
 *
 * `guide` es null si el CV aún no tiene evaluación.
 */
export function InterviewGuideCard({ guide, topics }: { guide: GuideQuestion[] | null; topics: InterviewTopic[] }) {
  const pending = guide?.length ?? 0;
  const counts = [
    pending > 0 ? plural(pending, "requisito por confirmar", "requisitos por confirmar") : null,
    topics.length > 0 ? plural(topics.length, "punto por aclarar", "puntos por aclarar") : null,
  ].filter(Boolean);
  return (
    <Card id={INTERVIEW_GUIDE_ANCHOR} data-testid="interview-guide" className="scroll-mt-20 border-t-4 border-t-brand">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <MessageCircleQuestionIcon className="size-5 shrink-0 text-brand" aria-hidden />
          Preguntas para la entrevista
          <Badge variant="outline" className="font-normal">
            {counts.length > 0 ? counts.join(" · ") : guide === null ? "Falta evaluar el CV" : "Nada por confirmar"}
          </Badge>
        </CardTitle>
        <CardDescription>
          Recomendadas para esta persona según su CV y lo que respondió al postular. Lo que confirme en la entrevista se
          registra con «Registrar resultado».
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <section className="space-y-2" aria-labelledby="guia-requisitos">
          <h3 id="guia-requisitos" className="text-sm font-medium">
            Requisitos por confirmar
          </h3>
          {guide === null ? (
            <p className="text-sm text-muted-foreground">
              Aún no hay evaluación del CV. Al evaluarlo aparecerán aquí las preguntas sobre los requisitos que no acredita.
            </p>
          ) : guide.length === 0 ? (
            <p className="text-sm text-muted-foreground">El CV acredita todos los requisitos (o RRHH ya los verificó).</p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                En orden de importancia. Lo que confirme recalcula la puntuación y le enseña al motor.
              </p>
              <ol className="space-y-3">
                {guide.map((q, index) => (
                  <li key={q.requirementId} className="space-y-1.5 rounded-md border p-3" data-testid="interview-guide-item">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium">
                        {index + 1}. {q.description}
                      </span>
                      <Badge variant="outline">{q.priority === "obligatorio" ? "Obligatorio" : "Deseable"}</Badge>
                      {q.kind === "duda_ia" ? (
                        <Badge variant="outline" className="border-brand/40">
                          Acreditado, con duda de la IA
                        </Badge>
                      ) : (
                        <AssessmentBadge assessment={q.assessment} />
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">Por qué: </span>
                      {q.reason}
                    </p>
                    <p className="text-sm">
                      <span className="font-medium">Pregunte: </span>
                      {q.question}
                      {q.source === "ia" ? <span className="ml-1 text-xs text-muted-foreground">(redactada por la IA)</span> : null}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">Cumple si: </span>
                      {q.passIf}
                    </p>
                  </li>
                ))}
              </ol>
            </>
          )}
        </section>

        {topics.length > 0 ? (
          <section className="space-y-2" aria-labelledby="guia-otros">
            <h3 id="guia-otros" className="text-sm font-medium">
              Otros puntos para aclarar
            </h3>
            <p className="text-sm text-muted-foreground">
              No cambian la puntuación ni son motivo de descarte por sí solos: sirven para entender bien su postulación.
            </p>
            <ul className="space-y-3">
              {topics.map((topic) => (
                <li key={topic.id} className="space-y-1.5 rounded-md border p-3" data-testid="interview-topic">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium">{topic.title}</span>
                    <Badge variant="outline">{topic.kind === "eliminatoria" ? "Pregunta eliminatoria" : topic.kind === "copia_aviso" ? "Texto del CV" : "Historial laboral"}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">Por qué: </span>
                    {topic.reason}
                  </p>
                  <p className="text-sm">
                    <span className="font-medium">Pregunte: </span>
                    {topic.question}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </CardContent>
    </Card>
  );
}

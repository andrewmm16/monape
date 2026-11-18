import { AssessmentBadge } from "@/components/common/badges";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { GuideQuestion } from "@/modules/evaluation/interview-guide";

/**
 * Guía de entrevista: solo lo que el CV no acredita, con la pregunta, el porqué y
 * qué respuesta cuenta como «cumple». Lo que se confirme se registra con el
 * resultado de la entrevista (o «Verificar») y recalcula la puntuación.
 */
export function InterviewGuideCard({ guide }: { guide: GuideQuestion[] }) {
  return (
    <Card data-testid="interview-guide">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Guía de entrevista
          <Badge variant="outline" className="font-normal">
            {guide.length === 0 ? "Nada por confirmar" : `${guide.length} por confirmar`}
          </Badge>
        </CardTitle>
        <CardDescription>
          {guide.length === 0
            ? "El CV acredita todos los requisitos (o RRHH ya los verificó)."
            : "Solo lo que el CV no acredita, en orden de importancia. Lo que confirme en la entrevista se registra con «Registrar resultado» y recalcula la puntuación; también le enseña al motor."}
        </CardDescription>
      </CardHeader>
      {guide.length > 0 ? (
        <CardContent>
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
        </CardContent>
      ) : null}
    </Card>
  );
}

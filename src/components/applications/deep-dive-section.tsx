import { AiJobStatus } from "@/components/applications/ai-job-status";
import { ActionButton } from "@/components/common/action-button";
import { Badge } from "@/components/ui/badge";
import { requestDeepDiveAction } from "@/modules/applications/actions";
import type { DeepDiveQuestion } from "@/modules/evaluation/deep-dive";

/**
 * - «completa»: la persona va a entrevista (o alguien pidió las preguntas): una por requisito acreditado.
 * - «resumida»: en otros estados solo se anuncian, con el botón para pedirlas antes.
 */
export type DeepDiveSectionProps = {
  mode: "completa" | "resumida";
  questions: DeepDiveQuestion[];
  /** Trabajo de la IA en cola (refresca la página) o el último error. */
  status: { message: string; tone: "info" | "warning"; active: boolean } | null;
  /** IA disponible y sin preguntas vigentes ni trabajo abierto. */
  canRequest: boolean;
  applicationId: string;
};

/** «Para profundizar»: lo que el CV ya acredita, para conocer en detalle la experiencia y cómo la respalda. */
export function DeepDiveSection({ mode, questions, status, canRequest, applicationId }: DeepDiveSectionProps) {
  const request = canRequest ? (
    <ActionButton variant="outline" className="w-full sm:w-auto" action={requestDeepDiveAction.bind(null, applicationId)} pendingLabel="Pidiendo…">
      {status?.tone === "warning" ? "Intentar de nuevo" : "Generar preguntas con IA"}
    </ActionButton>
  ) : null;

  return (
    <section className="space-y-2" aria-labelledby="guia-profundizar" data-testid="deep-dive">
      <h3 id="guia-profundizar" className="text-sm font-medium">
        Para profundizar
      </h3>
      {mode === "resumida" ? (
        <>
          <p className="text-sm text-muted-foreground">
            Preguntas sobre lo que su CV ya acredita, para conocer en detalle su experiencia.{" "}
            <span>Se preparan al programar la entrevista.</span>
          </p>
          {request}
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Lo que su CV ya acredita: para conocer en detalle su experiencia y cómo la respalda. No cambian la puntuación.
          </p>
          {status ? <AiJobStatus message={status.message} tone={status.tone} active={status.active} /> : null}
          {questions.length === 0 ? (
            <p className="text-sm text-muted-foreground">El CV todavía no acredita ningún requisito: no hay nada que profundizar.</p>
          ) : (
            <ol className="space-y-3">
              {questions.map((q, index) => (
                <li key={q.requirementId} className="space-y-1.5 rounded-md border p-3" data-testid="deep-dive-item">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium">
                      {index + 1}. {q.description}
                    </span>
                    <Badge variant="outline">{q.priority === "obligatorio" ? "Obligatorio" : "Deseable"}</Badge>
                  </div>
                  {q.quote ? (
                    <p className="text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">Su CV dice: </span>«{q.quote}»
                    </p>
                  ) : null}
                  <p className="text-sm">
                    <span className="font-medium">Pregunte: </span>
                    {q.question}
                    <span className="ml-1 text-xs text-muted-foreground">{q.source === "ia" ? "(redactada por la IA)" : "(pregunta base)"}</span>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">Qué escuchar: </span>
                    {q.listenFor}
                  </p>
                </li>
              ))}
            </ol>
          )}
          {request}
        </>
      )}
    </section>
  );
}

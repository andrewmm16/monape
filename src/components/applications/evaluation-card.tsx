import type { ReactNode } from "react";
import Link from "next/link";
import { AssessmentBadge, CompatibilityBadge } from "@/components/common/badges";
import { EmptyState } from "@/components/common/empty-state";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime, formatNumericDate } from "@/lib/format";
import {
  ASSESSMENT_DESCRIPTIONS,
  VERIFICATION_SOURCE_LABELS,
  VERIFICATION_SOURCE_PHRASES,
} from "@/lib/labels";
import { cn } from "@/lib/utils";
import type { listEvaluationItems, listEvaluations, listRequirementVerifications } from "@/modules/applications/queries";
import { RemoveVerificationDialog, VerifyRequirementDialog } from "./verification-dialog";

type Evaluation = Awaited<ReturnType<typeof listEvaluations>>[number];
type Item = Awaited<ReturnType<typeof listEvaluationItems>>[number];
type Verification = Awaited<ReturnType<typeof listRequirementVerifications>>[number];

const VERIFIED_TONES = {
  acreditado: "bg-success text-success-foreground",
  no_cumplido: "bg-danger text-danger-foreground",
} as const;

/** Origen de la valoración: lo que dice el CV o lo que RRHH comprobó después. */
function OriginBadge({ item }: { item: Item }) {
  if (!item.verification_source) {
    return (
      <Badge variant="outline" className="border-transparent bg-muted text-foreground">
        Según el CV
      </Badge>
    );
  }
  const tone = item.assessment === "no_cumplido" ? VERIFIED_TONES.no_cumplido : VERIFIED_TONES.acreditado;
  return (
    <Badge variant="outline" className={cn("border-transparent", tone)}>
      Verificado · {VERIFICATION_SOURCE_LABELS[item.verification_source]}
    </Badge>
  );
}

function ScoreMeter({ score, potential }: { score: number; potential: number }) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline gap-2">
        <span className="shrink-0 text-4xl font-semibold whitespace-nowrap tabular-nums">{Math.round(score)} %</span>
        <span className="text-sm text-muted-foreground">de los requisitos del puesto, acreditado en el CV</span>
      </div>
      <div
        className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={`${Math.round(score)} % acreditado en el CV; hasta ${Math.round(potential)} % si se confirman los requisitos sin evidencia`}
      >
        <span className="h-full bg-brand" style={{ width: `${score}%` }} />
        <span className="ml-0.5 h-full bg-brand/30" style={{ width: `${Math.max(0, potential - score)}%` }} />
      </div>
      <p className="text-xs text-muted-foreground">
        Mide cuánto del puesto aparece en el CV. Si algo «no aparece», puede que la persona lo cumpla y no lo haya escrito.
      </p>
    </div>
  );
}

type Evidence = { quote?: string; matched?: string[] };

/** Términos que el motor encontró en el CV («El CV menciona: a, b, c.»). */
function mentionedTerms(rationale: string | null): string[] {
  const match = rationale?.match(/El CV menciona: ([^.]*)\./);
  return match?.[1] ? match[1].split(",").map((t) => t.trim()).filter(Boolean) : [];
}

/** Términos que se buscaron y no estaban («…términos configurados (a, b, c).»). */
function searchedTerms(rationale: string | null): string[] {
  const match = rationale?.match(/configurados \(([^)]*)\)/);
  return match?.[1] ? match[1].split(",").map((t) => t.trim()).filter(Boolean) : [];
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, (char) => `\\${char}`);

/** La frase del CV con lo encontrado resaltado. */
function Quote({ text, terms }: { text: string; terms: string[] }) {
  const ordered = [...terms].sort((a, b) => b.length - a.length);
  if (ordered.length === 0) return <>{text}</>;
  const parts = text.split(new RegExp(`(${ordered.map(escapeRegExp).join("|")})`, "gi"));
  return (
    <>
      {parts.map((part, index) =>
        ordered.some((t) => t.toLowerCase() === part.toLowerCase()) ? (
          <mark key={index} className="rounded-sm bg-brand/20 px-0.5 font-medium not-italic text-foreground">
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}

type Assessment = Item["assessment"];
const isToConfirm = (a: Assessment) => a === "pendiente_verificacion" || a === "sin_evidencia";

const ENGINE_LABELS: Record<Assessment, string> = {
  acreditado: "acreditado",
  no_cumplido: "no cumplido",
  pendiente_verificacion: "por confirmar",
  sin_evidencia: "sin evidencia",
};

/**
 * Cómo se relaciona la opinión de la IA con la del motor en un requisito:
 * - «distinta»: otro veredicto que cambia el puntaje (acredita, no cumple…);
 * - «indicio»: el motor no encontró nada y la IA ve un indicio (paráfrasis): no cambia el puntaje;
 * - null: coinciden, o solo cambia «pendiente» ↔ «sin evidencia» sin indicio nuevo.
 */
function secondOpinionKind(engine: Assessment, ai: Assessment): "distinta" | "indicio" | null {
  if (engine === ai) return null;
  if (isToConfirm(engine) && isToConfirm(ai)) return engine === "sin_evidencia" ? "indicio" : null;
  return "distinta";
}

/** Lo que opina la IA de un requisito cuando no coincide con el motor. */
function SecondOpinionNote({ item, kind }: { item: Item; kind: "distinta" | "indicio" }) {
  const evidence = (Array.isArray(item.evidence) ? item.evidence : []) as Evidence[];
  return (
    <div
      className={cn(
        "space-y-1.5 rounded-md border border-dashed p-2",
        kind === "distinta" ? "border-brand/50 bg-brand/5" : "border-muted-foreground/30",
      )}
    >
      <p className="flex flex-wrap items-center gap-1.5 text-xs font-medium">
        {kind === "distinta" ? (
          <>
            La IA opina distinto: <AssessmentBadge assessment={item.assessment} />
          </>
        ) : (
          "La IA ve un indicio (no cambia el puntaje):"
        )}
      </p>
      {evidence.map((e, index) =>
        e.quote ? (
          <blockquote key={index} className="border-l-2 border-brand/40 pl-2 text-xs italic">
            {e.quote}
          </blockquote>
        ) : null,
      )}
      {item.rationale ? <p className="text-xs text-muted-foreground">{item.rationale}</p> : null}
    </div>
  );
}

export function EvaluationCard({
  applicationId,
  evaluation,
  items,
  history,
  isCurrent,
  secondOpinion = null,
  currentCriteriaVersion,
  canReview,
  verifications = [],
  actions = null,
}: {
  applicationId: string;
  evaluation: Evaluation | null;
  items: Item[];
  history: Evaluation[];
  /** ¿Es la evaluación vigente (la principal, del motor)? Por defecto, la más reciente. */
  isCurrent?: boolean;
  /** Segunda opinión con IA del mismo CV y criterios (solo sobre la evaluación del motor). */
  secondOpinion?: { evaluation: Evaluation; items: Item[] } | null;
  currentCriteriaVersion: number;
  canReview: boolean;
  verifications?: Verification[];
  /** Botones para (volver a) evaluar y sus avisos: van dentro de la tarjeta, junto a lo que evalúan. */
  actions?: ReactNode;
}) {
  if (!evaluation) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Cumplimiento del puesto</CardTitle>
          {actions}
        </CardHeader>
        <CardContent>
          <EmptyState
            title="Evaluación pendiente"
            description="Aún no se ha evaluado esta postulación. Pulse «Evaluar con motor de reglas» para ver cuánto se parece su CV al puesto."
          />
        </CardContent>
      </Card>
    );
  }

  const outdated = evaluation.criteria_version < currentCriteriaVersion;
  // Solo se verifica sobre la evaluación vigente (la del motor) y con criterios vigentes.
  const canVerify = canReview && !outdated && (isCurrent ?? history[0]?.id === evaluation.id);
  const currentVerification = new Map(verifications.map((v) => [v.requirement_id, v]));
  // Avisos de la lectura del CV evaluado (texto oculto, relleno de palabras clave, OCR…).
  const resumeWarnings = evaluation.resume?.resume_extractions?.warnings ?? [];
  // Segunda opinión de la IA, requisito por requisito. Lo verificado por RRHH ya no se compara.
  const aiByRequirement = new Map(
    (secondOpinion?.items ?? []).flatMap((i) => (i.requirement_id ? [[i.requirement_id, i] as const] : [])),
  );
  const compared = items.filter((i) => !i.verification_source && i.requirement_id && aiByRequirement.has(i.requirement_id));
  const kindOf = (i: Item) => secondOpinionKind(i.assessment, aiByRequirement.get(i.requirement_id!)!.assessment);
  const differing = compared.filter((i) => kindOf(i) === "distinta");
  const hints = compared.filter((i) => kindOf(i) === "indicio");
  const isAiEvaluation = evaluation.method === "ia";
  const resolvedByAi = items.filter((i) => !i.verification_source && i.resolved_by === "ia").length;
  const resolvedByRules = items.filter((i) => !i.verification_source && i.resolved_by === "regla_aprendida").length;

  return (
    <Card>
      <CardHeader className="gap-2">
        <CardTitle className="flex flex-wrap items-center gap-2">
          Cumplimiento del puesto <CompatibilityBadge level={evaluation.level} />
          {isAiEvaluation ? <Badge variant="outline">Segunda opinión con IA</Badge> : null}
        </CardTitle>
        <CardDescription>
          {isAiEvaluation ? (
            <>
              Evaluación con IA: segunda opinión sobre la del motor de reglas.{" "}
              <Link href={`/postulaciones/${applicationId}`} className="font-medium text-brand underline underline-offset-4">
                Volver a la evaluación del motor
              </Link>
            </>
          ) : (
            "Referencia para RRHH: la decisión final es de una persona."
          )}
        </CardDescription>
        {outdated ? (
          <p className="text-sm text-warning-foreground">
            Los criterios de la vacante cambiaron después de esta evaluación. Vuelva a evaluar.
          </p>
        ) : null}
        {actions}
      </CardHeader>
      <CardContent className="space-y-6">
        <ScoreMeter score={evaluation.score} potential={evaluation.score_potential} />
        <p className="text-sm">{evaluation.summary}</p>
        {resolvedByAi + resolvedByRules > 0 ? (
          <p className="text-sm text-muted-foreground">
            {resolvedByAi > 0
              ? `La IA resolvió ${resolvedByAi} duda${resolvedByAi === 1 ? "" : "s"} del motor y ya cuenta${resolvedByAi === 1 ? "" : "n"} en el puntaje.`
              : ""}
            {resolvedByAi > 0 && resolvedByRules > 0 ? " " : ""}
            {resolvedByRules > 0
              ? `${resolvedByRules} requisito${resolvedByRules === 1 ? " se resolvió" : "s se resolvieron"} con reglas que el motor aprendió de la IA.`
              : ""}
          </p>
        ) : null}
        {secondOpinion && compared.length > 0 ? (
          <div className="rounded-md border border-dashed border-brand/50 bg-brand/5 px-3 py-2 text-sm">
            <p>
              <span className="font-medium">Segunda opinión de la IA</span> ({formatDateTime(secondOpinion.evaluation.created_at)}):{" "}
              {differing.length === 0
                ? hints.length === 0
                  ? `coincide con el motor en los ${compared.length} requisitos sin verificar.`
                  : `no contradice al motor en ninguno de los ${compared.length} requisitos sin verificar.`
                : `opina distinto en ${differing.length} requisito${differing.length === 1 ? "" : "s"} que el motor resolvió sin dudas (marcado${differing.length === 1 ? "" : "s"} abajo). No cambia${differing.length === 1 ? "" : "n"} el puntaje: verifíquelo${differing.length === 1 ? "" : "s"} para decidir.`}
              {hints.length > 0
                ? ` Además ve indicios en ${hints.length} requisito${hints.length === 1 ? "" : "s"} que el CV no menciona con esas palabras.`
                : ""}
            </p>
            <Link
              href={`/postulaciones/${applicationId}?evaluacion=${secondOpinion.evaluation.id}`}
              className="text-xs font-medium text-brand underline underline-offset-4"
            >
              Ver la evaluación completa de la IA
            </Link>
          </div>
        ) : null}
        {resumeWarnings.length > 0 ? (
          <Alert>
            <AlertTitle>Avisos sobre el CV evaluado</AlertTitle>
            <AlertDescription>
              <ul className="list-disc space-y-1 pl-4">
                {resumeWarnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Detalle por requisito</h3>
          <ul className="space-y-2">
            {items.map((item) => {
              const evidence = (Array.isArray(item.evidence) ? item.evidence : []) as Evidence[];
              const verified = Boolean(item.verification_source);
              const verification = item.requirement_id ? currentVerification.get(item.requirement_id) : undefined;
              const hasVerification = verified || Boolean(verification);
              const found = mentionedTerms(item.rationale);
              const searched = searchedTerms(item.rationale);
              const resolved = !verified && Boolean(item.resolved_by);
              const aiItem = item.requirement_id ? aiByRequirement.get(item.requirement_id) : undefined;
              const aiKind = aiItem ? secondOpinionKind(item.assessment, aiItem.assessment) : null;
              return (
                <li key={item.id} className="overflow-hidden rounded-md border">
                  {/* Cabecera a todo el ancho: lo que busca el puesto y su resultado. Debajo, lo que dice el CV. */}
                  <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5 border-b bg-muted/40 px-3 py-2">
                    <div className="min-w-0 space-y-1">
                      <p className="font-medium">{item.description}</p>
                      <div className="flex flex-wrap gap-1.5">
                        <Badge variant="outline">{item.priority === "obligatorio" ? "Obligatorio" : "Deseable"}</Badge>
                        {item.is_essential ? <Badge variant="outline">Legal o esencial</Badge> : null}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                        {verified ? <OriginBadge item={item} /> : null}
                        {verified ? (
                          <span
                            className={cn(
                              "inline-flex h-5 items-center rounded-4xl px-2 text-xs font-medium",
                              VERIFIED_TONES[item.assessment === "no_cumplido" ? "no_cumplido" : "acreditado"],
                            )}
                          >
                            {item.assessment === "no_cumplido" ? "No cumple" : "Cumple"}
                          </span>
                        ) : (
                          <span title={ASSESSMENT_DESCRIPTIONS[item.assessment]}>
                            <AssessmentBadge assessment={item.assessment} />
                          </span>
                        )}
                        {resolved ? (
                          <Badge variant="outline" className="border-brand/40 text-xs">
                            {item.resolved_by === "ia" ? "Resuelto por la IA" : "Regla aprendida"}
                          </Badge>
                        ) : null}
                    </div>
                  </div>
                  <div className="space-y-2 p-3">
                      {verified && item.verification_source ? (
                        <p className="text-sm">
                          Verificado en {VERIFICATION_SOURCE_PHRASES[item.verification_source]} el {formatNumericDate(item.verified_at)} por{" "}
                          {item.verifier?.full_name ?? "RRHH"}: <span className="whitespace-pre-wrap">«{item.verification_note}»</span>
                        </p>
                      ) : null}
                      {resolved ? (
                        // La IA o una regla aprendida resolvió una duda del motor: se muestra por qué.
                        <div className="space-y-1.5">
                          {evidence.map((e, index) => (
                            <blockquote key={index} className="border-l-2 border-brand/40 pl-2 text-xs italic">
                              <Quote text={e.quote ?? ""} terms={[...(e.matched ?? []), ...found]} />
                            </blockquote>
                          ))}
                          {/* La insignia y la línea de abajo ya dicen quién lo resolvió y qué dijo el motor. */}
                          <p className="text-sm text-muted-foreground">{item.rationale.replace(/^Resuelto por la IA \([^)]*\): /, "")}</p>
                          {item.engine_assessment && item.engine_assessment !== item.assessment ? (
                            <p className="text-xs text-muted-foreground">
                              El motor solo lo había dejado como «{ENGINE_LABELS[item.engine_assessment]}».
                            </p>
                          ) : null}
                        </div>
                      ) : evidence.length > 0 ? (
                        <div className="space-y-1.5">
                          {evidence.map((e, index) => (
                            <blockquote key={index} className="border-l-2 border-brand/40 pl-2 text-xs italic">
                              <Quote text={e.quote ?? ""} terms={[...(e.matched ?? []), ...found]} />
                            </blockquote>
                          ))}
                          {/* «Por confirmar» con cita: la cita sola no dice QUÉ falta confirmar
                              (cargo parecido, nivel por debajo, fechas que no cuadran…). */}
                          {!verified && item.assessment === "pendiente_verificacion" && item.rationale ? (
                            <p className="text-sm text-muted-foreground">{item.rationale}</p>
                          ) : null}
                        </div>
                      ) : item.assessment === "sin_evidencia" ? (
                        <p className="text-sm text-muted-foreground">
                          El CV no menciona este requisito.
                          {searched.length > 0 ? ` Se buscó: ${searched.join(", ")}.` : ""}
                        </p>
                      ) : !verified && item.rationale ? (
                        <p className="text-sm text-muted-foreground">{item.rationale}</p>
                      ) : null}
                      {!verified && aiKind && aiItem ? <SecondOpinionNote item={aiItem} kind={aiKind} /> : null}
                      {canVerify && item.requirement_id ? (
                        <div className="flex flex-wrap gap-2 pt-1">
                          <VerifyRequirementDialog
                            applicationId={applicationId}
                            requirementId={item.requirement_id}
                            requirementDescription={item.description}
                            initialValues={
                              verification
                                ? {
                                    result: verification.result as "acreditado" | "no_cumplido",
                                    source: verification.source,
                                    note: verification.note,
                                  }
                                : undefined
                            }
                            trigger={
                              <Button type="button" size="sm" variant="outline" className="h-9 sm:h-7">
                                {hasVerification ? "Cambiar" : "Verificar"}
                              </Button>
                            }
                          />
                          {hasVerification ? (
                            <RemoveVerificationDialog
                              applicationId={applicationId}
                              requirementId={item.requirement_id}
                              requirementDescription={item.description}
                              trigger={
                                <Button type="button" size="sm" variant="ghost" className="h-9 sm:h-7">
                                  Quitar verificación
                                </Button>
                              }
                            />
                          ) : null}
                        </div>
                      ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <p className="text-xs text-muted-foreground">
          Evaluado el {formatDateTime(evaluation.created_at)}
          {evaluation.resume ? ` · CV versión ${evaluation.resume.version}` : ""}.
        </p>
      </CardContent>
    </Card>
  );
}

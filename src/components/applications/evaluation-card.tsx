import { AssessmentBadge, CompatibilityBadge } from "@/components/common/badges";
import { EmptyState } from "@/components/common/empty-state";
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
        <span className="text-4xl font-semibold tabular-nums">{Math.round(score)} %</span>
        <span className="text-sm text-muted-foreground">de afinidad con el puesto</span>
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

export function EvaluationCard({
  applicationId,
  evaluation,
  items,
  history,
  currentCriteriaVersion,
  canReview,
  verifications = [],
}: {
  applicationId: string;
  evaluation: Evaluation | null;
  items: Item[];
  history: Evaluation[];
  currentCriteriaVersion: number;
  canReview: boolean;
  verifications?: Verification[];
}) {
  if (!evaluation) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Afinidad con el puesto</CardTitle>
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
  // Solo se verifica sobre la evaluación más reciente y con criterios vigentes.
  const canVerify = canReview && !outdated && history[0]?.id === evaluation.id;
  const currentVerification = new Map(verifications.map((v) => [v.requirement_id, v]));

  return (
    <Card>
      <CardHeader className="gap-2">
        <CardTitle className="flex flex-wrap items-center gap-2">
          Afinidad con el puesto <CompatibilityBadge level={evaluation.level} />
        </CardTitle>
        <CardDescription>Referencia para RRHH: la decisión final es de una persona.</CardDescription>
        {outdated ? (
          <p className="text-sm text-warning-foreground">
            Los criterios de la vacante cambiaron después de esta evaluación. Vuelva a evaluar.
          </p>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-6">
        <ScoreMeter score={evaluation.score} potential={evaluation.score_potential} />
        <p className="text-sm">{evaluation.summary}</p>

        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Detalle por requisito</h3>
          <div className="hidden grid-cols-2 gap-0 px-3 text-xs font-medium tracking-wide text-muted-foreground uppercase sm:grid">
            <span>Lo que busca el puesto</span>
            <span className="pl-4">Lo que dice el CV</span>
          </div>
          <ul className="space-y-2">
            {items.map((item) => {
              const evidence = (Array.isArray(item.evidence) ? item.evidence : []) as Evidence[];
              const verified = Boolean(item.verification_source);
              const verification = item.requirement_id ? currentVerification.get(item.requirement_id) : undefined;
              const hasVerification = verified || Boolean(verification);
              const found = mentionedTerms(item.rationale);
              const searched = searchedTerms(item.rationale);
              return (
                <li key={item.id} className="overflow-hidden rounded-md border">
                  <div className="grid sm:grid-cols-2 sm:divide-x">
                    <div className="space-y-1.5 p-3">
                      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase sm:hidden">Lo que busca el puesto</p>
                      <p className="font-medium">{item.description}</p>
                      <div className="flex flex-wrap gap-1.5">
                        <Badge variant="outline">{item.priority === "obligatorio" ? "Obligatorio" : "Deseable"}</Badge>
                        {item.is_essential ? <Badge variant="outline">Legal o esencial</Badge> : null}
                      </div>
                    </div>
                    <div className="space-y-2 border-t p-3 sm:border-t-0">
                      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase sm:hidden">Lo que dice el CV</p>
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
                      </div>
                      {verified && item.verification_source ? (
                        <p className="text-sm">
                          Verificado en {VERIFICATION_SOURCE_PHRASES[item.verification_source]} el {formatNumericDate(item.verified_at)} por{" "}
                          {item.verifier?.full_name ?? "RRHH"}: <span className="whitespace-pre-wrap">«{item.verification_note}»</span>
                        </p>
                      ) : null}
                      {evidence.length > 0 ? (
                        <div className="space-y-1.5">
                          {evidence.map((e, index) => (
                            <blockquote key={index} className="border-l-2 border-brand/40 pl-2 text-xs italic">
                              <Quote text={e.quote ?? ""} terms={[...(e.matched ?? []), ...found]} />
                            </blockquote>
                          ))}
                        </div>
                      ) : item.assessment === "sin_evidencia" ? (
                        <p className="text-sm text-muted-foreground">
                          El CV no menciona este requisito.
                          {searched.length > 0 ? ` Se buscó: ${searched.join(", ")}.` : ""}
                        </p>
                      ) : !verified && item.rationale ? (
                        <p className="text-sm text-muted-foreground">{item.rationale}</p>
                      ) : null}
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

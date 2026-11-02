import Link from "next/link";
import { CircleCheckIcon, CircleMinusIcon, CircleXIcon, ClockIcon, XIcon } from "lucide-react";
import type { ReactNode } from "react";
import { ApplicationStatusBadge, CompatibilityBadge } from "@/components/common/badges";
import { InterviewOutcomeBadge } from "@/components/interviews/interview-item";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { formatInterviewDateTime } from "@/modules/interviews/datetime";
import { formatPercent } from "@/lib/format";
import { REQUIREMENT_PRIORITY_LABELS, VERIFICATION_SOURCE_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";
import type { CompareCandidate, CompareItem } from "@/modules/applications/compare";
import type { Tables } from "@/types/database";

type Requirement = Pick<Tables<"vacancy_requirements">, "id" | "description" | "priority" | "weight">;

const ASSESSMENT_CELL = {
  acreditado: { label: "Cumple", Icon: CircleCheckIcon, className: "text-emerald-700 dark:text-emerald-300" },
  no_cumplido: { label: "No cumple", Icon: CircleXIcon, className: "text-red-700 dark:text-red-300" },
  sin_evidencia: { label: "Sin evidencia", Icon: CircleMinusIcon, className: "text-muted-foreground" },
  pendiente_verificacion: { label: "Pendiente", Icon: ClockIcon, className: "text-amber-700 dark:text-amber-300" },
} as const;

function Origin({ item }: { item: CompareItem }) {
  if (!item.verification_source) {
    return (
      <Badge variant="outline" className="border-transparent bg-muted text-[11px] text-muted-foreground">
        CV
      </Badge>
    );
  }
  const tone =
    item.assessment === "no_cumplido"
      ? "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-100"
      : "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100";
  return (
    <Badge variant="outline" className={cn("border-transparent text-[11px]", tone)}>
      Verificado · {VERIFICATION_SOURCE_LABELS[item.verification_source]}
    </Badge>
  );
}

const stickyCell = "sticky left-0 z-10 border-r bg-card";

/**
 * Candidatos lado a lado: una columna por postulación y una fila por requisito
 * vigente. `candidates` ya viene en el orden en que se muestran las columnas;
 * `rankOf` da el puesto de «mejor opción» de cada una. La tabla tiene su propio
 * desplazamiento horizontal y la primera columna fija.
 */
export function ComparisonTable({
  candidates,
  requirements,
  rankOf,
  removeHref,
  canSchedule = false,
}: {
  candidates: CompareCandidate[];
  requirements: Requirement[];
  rankOf: Map<string, number>;
  /** Enlace que quita a un candidato de la comparación; nulo si ya no se puede quitar. */
  removeHref: (id: string) => string | null;
  /** Muestra el enlace «Programar entrevista» en cada columna. */
  canSchedule?: boolean;
}) {
  const mandatoryIds = new Set(requirements.filter((r) => r.priority === "obligatorio").map((r) => r.id));
  const requirementIds = new Set(requirements.map((r) => r.id));
  const itemOf = (candidate: CompareCandidate, requirementId: string) =>
    candidate.items.find((item) => item.requirement_id === requirementId);

  const summaryRow = (label: string, render: (candidate: CompareCandidate) => ReactNode) => (
    <tr className="border-t bg-muted/30">
      <th scope="row" className={cn(stickyCell, "px-3 py-2 text-left align-top text-xs font-medium whitespace-normal")}>
        {label}
      </th>
      {candidates.map((candidate) => (
        <td key={candidate.id} className={cn("px-3 py-2 align-top", rankOf.get(candidate.id) === 1 && "bg-primary/5")}>
          {render(candidate)}
        </td>
      ))}
    </tr>
  );

  return (
    <div data-testid="comparison-scroll" className="max-w-full overflow-x-auto rounded-md border bg-card shadow-xs">
      <table className="w-full border-collapse text-sm" style={{ minWidth: `${12 + candidates.length * 12}rem` }}>
        <thead>
          <tr>
            <th scope="col" className={cn(stickyCell, "w-44 min-w-44 px-3 py-3 text-left align-bottom text-xs font-medium text-muted-foreground")}>
              Requisito
            </th>
            {candidates.map((candidate) => {
              const rank = rankOf.get(candidate.id) ?? 0;
              const remove = removeHref(candidate.id);
              return (
                <th
                  key={candidate.id}
                  scope="col"
                  data-testid="compare-column"
                  className={cn("min-w-48 px-3 py-3 text-left align-top font-normal", rank === 1 && "bg-primary/5")}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs font-semibold text-muted-foreground">{rank}.º</span>
                    {remove ? (
                      <Link
                        href={remove}
                        aria-label={`Quitar a ${candidate.name} de la comparación`}
                        title="Quitar de la comparación"
                        className="-mt-1 -mr-1 inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
                      >
                        <XIcon className="size-4" aria-hidden />
                      </Link>
                    ) : null}
                  </div>
                  <Link href={`/postulaciones/${candidate.id}`} className="block font-semibold break-words hover:underline">
                    {candidate.name}
                  </Link>
                  <div className="mt-1 space-y-1">
                    <CompatibilityBadge level={candidate.level} />
                    <div className="text-xs text-muted-foreground">
                      {formatPercent(candidate.score)} acreditado · hasta {formatPercent(candidate.scorePotential)}
                    </div>
                    {candidate.evaluationOutdated ? (
                      <div className="text-xs text-amber-700 dark:text-amber-400">Evaluación desactualizada: reevaluar</div>
                    ) : null}
                  </div>
                  {canSchedule ? (
                    <Link
                      href={`/postulaciones/${candidate.id}?programar=1`}
                      className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-2 h-8")}
                    >
                      Programar entrevista
                    </Link>
                  ) : null}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {requirements.map((requirement) => (
            <tr key={requirement.id} className="border-t">
              <th scope="row" className={cn(stickyCell, "px-3 py-2 text-left align-top font-normal whitespace-normal")}>
                <span className="block font-medium">{requirement.description}</span>
                <span className="text-xs text-muted-foreground">
                  {REQUIREMENT_PRIORITY_LABELS[requirement.priority]} · peso {requirement.weight}
                </span>
              </th>
              {candidates.map((candidate) => {
                const item = itemOf(candidate, requirement.id);
                const cell = item ? ASSESSMENT_CELL[item.assessment] : null;
                return (
                  <td
                    key={candidate.id}
                    className={cn(
                      "px-3 py-2 align-top",
                      rankOf.get(candidate.id) === 1 && "bg-primary/5",
                      item?.assessment === "acreditado" && "bg-emerald-50 dark:bg-emerald-950/30",
                    )}
                  >
                    {item && cell ? (
                      <div className="space-y-1">
                        <span className={cn("flex items-center gap-1.5 font-medium", cell.className)}>
                          <cell.Icon className="size-4 shrink-0" aria-hidden />
                          {cell.label}
                        </span>
                        <Origin item={item} />
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground" title="La evaluación no incluye este requisito">
                        —
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        <tfoot>
          {summaryRow("Obligatorios acreditados", (candidate) => {
            const met = candidate.items.filter(
              (item) => item.assessment === "acreditado" && item.requirement_id && mandatoryIds.has(item.requirement_id),
            ).length;
            return `${met} de ${mandatoryIds.size}`;
          })}
          {summaryRow("Requisitos verificados", (candidate) => {
            const verified = candidate.items.filter(
              (item) => item.verification_source && item.requirement_id && requirementIds.has(item.requirement_id),
            ).length;
            return `${verified} de ${requirements.length}`;
          })}
          {summaryRow("Estado del proceso", (candidate) => <ApplicationStatusBadge status={candidate.status} />)}
          {summaryRow("Entrevista", (candidate) => {
            const { lastResult, lastScheduledAt, nextScheduledAt } = candidate.interview;
            if (!lastResult && !nextScheduledAt) return <span className="text-xs text-muted-foreground">Sin entrevista</span>;
            return (
              <div className="space-y-1">
                {lastResult && lastScheduledAt ? (
                  <div>
                    <InterviewOutcomeBadge status="realizada" result={lastResult} />
                    <div className="text-xs text-muted-foreground">{formatInterviewDateTime(lastScheduledAt)}</div>
                  </div>
                ) : null}
                {nextScheduledAt ? (
                  <div className="text-xs">
                    <InterviewOutcomeBadge status="programada" result={null} />
                    <div className="text-muted-foreground">{formatInterviewDateTime(nextScheduledAt)}</div>
                  </div>
                ) : null}
              </div>
            );
          })}
          {summaryRow("Puntuación", (candidate) => (
            <span className="font-semibold">{formatPercent(candidate.score)}</span>
          ))}
        </tfoot>
      </table>
    </div>
  );
}

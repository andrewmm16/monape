import { formatPercent } from "@/lib/format";
import { APPLICATION_STATUS_LABELS } from "@/lib/labels";
import type { FunnelStep } from "@/modules/reports/metrics";

/**
 * Embudo del proceso: barras centradas de ancho decreciente (una sola tonalidad,
 * el color de marca). El texto va en tinta normal, fuera del relleno; la barra
 * solo codifica la magnitud. Entre etapas se muestra la conversión.
 */
export function FunnelChart({ steps }: { steps: FunnelStep[] }) {
  const max = Math.max(1, ...steps.map((step) => step.reached));
  return (
    <div className="space-y-1">
      {steps.map((step, index) => {
        const width = step.reached === 0 ? 6 : Math.max(6, (step.reached / max) * 100);
        return (
          <div key={step.status}>
            {index > 0 && step.conversion !== null ? (
              <div className="py-0.5 text-center text-[11px] text-muted-foreground tabular-nums">
                ↓ {formatPercent(step.conversion * 100)} de conversión
              </div>
            ) : null}
            <div className="text-center text-sm">
              <span className="font-medium">{APPLICATION_STATUS_LABELS[step.status]}</span>{" "}
              <span className="tabular-nums text-muted-foreground">· {step.reached} llegaron</span>
            </div>
            <div className="flex justify-center">
              <div
                className="h-6 rounded-md bg-brand"
                style={{ width: `${width}%` }}
                title={`${APPLICATION_STATUS_LABELS[step.status]}: ${step.reached} llegaron a esta etapa o a una posterior · ${step.current} hoy en esta etapa`}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

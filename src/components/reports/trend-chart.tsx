import type { Trend } from "@/modules/reports/metrics";

/**
 * Postulaciones recibidas a lo largo del tiempo (barras, una sola tonalidad de
 * marca). Las etiquetas del eje se muestran espaciadas para no amontonarse.
 */
export function TrendChart({ trend }: { trend: Trend }) {
  const { points, granularity } = trend;
  if (points.length === 0) return null;
  const max = Math.max(1, ...points.map((point) => point.count));
  const labelEvery = Math.max(1, Math.ceil(points.length / 8));

  return (
    <div>
      <div className="flex h-40 items-end gap-1" role="img" aria-label={`Postulaciones por ${granularity}`}>
        {points.map((point) => (
          <div key={point.key} className="flex h-full flex-1 items-end" title={`${point.label}: ${point.count}`}>
            <div
              className="w-full rounded-t bg-brand"
              style={{ height: `${point.count === 0 ? 0 : Math.max(4, (point.count / max) * 100)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1">
        {points.map((point, index) => (
          <div key={point.key} className="min-w-0 flex-1 truncate text-center text-[10px] text-muted-foreground">
            {index % labelEvery === 0 ? point.label : ""}
          </div>
        ))}
      </div>
    </div>
  );
}

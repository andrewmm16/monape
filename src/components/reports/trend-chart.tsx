import type { Trend } from "@/modules/reports/metrics";

/**
 * Postulaciones recibidas a lo largo del tiempo (barras, una sola tonalidad de
 * marca). Las etiquetas del eje se muestran espaciadas para no amontonarse.
 */
export function TrendChart({ trend }: { trend: Trend }) {
  const { points, granularity } = trend;
  if (points.length === 0) return null;
  const max = Math.max(1, ...points.map((point) => point.count));
  // Menos etiquetas y sin recorte: en pantallas angostas se leen enteras
  // («16 nov») en lugar de cortarse («1..»), desbordando en las columnas vacías.
  const labelEvery = Math.max(1, Math.ceil(points.length / 5));

  return (
    <div>
      <div className="flex h-40 items-end gap-1" role="img" aria-label={`Postulaciones por ${granularity}`}>
        {points.map((point) => (
          <div
            key={point.key}
            className="group relative flex h-full flex-1 items-end"
            title={`${point.label}: ${point.count}`}
          >
            <div
              className="w-full rounded-t bg-brand/70 transition-colors group-hover:bg-brand"
              style={{ height: `${point.count === 0 ? 0 : Math.max(4, (point.count / max) * 100)}%` }}
            />
            {/* Tooltip propio al pasar el mouse (CSS, sin JS de cliente). */}
            <div
              className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground opacity-0 shadow-md transition-opacity group-hover:opacity-100"
              role="tooltip"
            >
              <span className="font-medium">{point.count}</span> · {point.label}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1">
        {points.map((point, index) => (
          <div
            key={point.key}
            className="min-w-0 flex-1 overflow-visible whitespace-nowrap text-center text-[10px] text-muted-foreground"
          >
            {index % labelEvery === 0 ? point.label : ""}
          </div>
        ))}
      </div>
    </div>
  );
}

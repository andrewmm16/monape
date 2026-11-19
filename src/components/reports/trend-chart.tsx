import type { Trend } from "@/modules/reports/metrics";

/**
 * Postulaciones recibidas a lo largo del tiempo (barras, una sola tonalidad de
 * marca) con eje de valores (máximo y cero), línea base y el valor de cada barra
 * (de todas si son pocas; si no, del máximo y del último periodo). Las etiquetas
 * del eje se muestran espaciadas y la primera y la última no se cortan.
 */
export function TrendChart({ trend }: { trend: Trend }) {
  const { points, granularity } = trend;
  if (points.length === 0) return null;
  const max = Math.max(1, ...points.map((point) => point.count));
  const last = points.length - 1;
  const maxIndex = points.reduce((best, point, index) => (point.count > points[best].count ? index : best), 0);
  const showAllValues = points.length <= 12;
  // Menos etiquetas y sin recorte: en pantallas angostas se leen enteras.
  const labelEvery = Math.max(1, Math.ceil(points.length / 5));
  const heightOf = (count: number) => (count === 0 ? 0 : Math.max(4, (count / max) * 100));

  return (
    <div className="flex gap-2">
      <div className="flex h-[11.25rem] w-6 shrink-0 flex-col justify-between pt-5text-right text-[10px] leading-none text-muted-foreground tabular-nums" aria-hidden>
        <span>{max}</span>
        <span>0</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="pt-5">
          <div
            className="flex h-40 items-end gap-1 border-b border-border"
            role="img"
            aria-label={`Postulaciones por ${granularity}: máximo ${max}, último periodo ${points[last].count}`}
          >
            {points.map((point, index) => {
              const showValue = showAllValues || index === last || index === maxIndex;
              return (
                <div
                  key={point.key}
                  className="group relative h-full flex-1"
                  title={`${point.label}: ${point.count}`}
                >
                  <div
                    className="absolute inset-x-0 bottom-0 rounded-t bg-brand/70 transition-colors group-hover:bg-brand"
                    style={{ height: `${heightOf(point.count)}%` }}
                  />
                  {showValue ? (
                    <span
                      className="absolute inset-x-0 mb-0.5 text-center text-[10px] leading-none font-medium tabular-nums"
                      style={{ bottom: `${heightOf(point.count)}%` }}
                    >
                      {point.count}
                    </span>
                  ) : null}
                  {/* Tooltip propio al pasar el mouse (CSS, sin JS de cliente). */}
                  <div
                    className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-5 -translate-x-1/2 whitespace-nowrap rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground opacity-0 shadow-md transition-opacity group-hover:opacity-100"
                    role="tooltip"
                  >
                    <span className="font-medium">{point.count}</span> · {point.label}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="mt-1 flex gap-1">
          {points.map((point, index) => (
            <div key={point.key} className="relative h-4 min-w-0 flex-1 text-[10px] text-muted-foreground">
              {index % labelEvery === 0 ? (
                <span
                  className={
                    "absolute top-0 whitespace-nowrap " +
                    (index === 0
                      ? "left-0"
                      : index === last
                        ? "right-0"
                        : "left-1/2 -translate-x-1/2")
                  }
                >
                  {point.label}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

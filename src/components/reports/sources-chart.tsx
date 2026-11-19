import { formatPercent } from "@/lib/format";
import { CANDIDATE_SOURCE_LABELS } from "@/lib/labels";
import type { SourceRow } from "@/modules/reports/metrics";
import type { Enums } from "@/types/database";

/** Color fijo por fuente (no por ranking): el color sigue a la entidad. */
const SOURCE_COLOR: Record<Enums<"candidate_source">, string> = {
  linkedin: "var(--src-linkedin)",
  bolsa_empleo: "var(--src-bolsa-empleo)",
  web_empresa: "var(--src-web-empresa)",
  referido: "var(--src-referido)",
  manual: "var(--src-manual)",
  otro: "var(--src-otro)",
};

/**
 * Fuentes de candidatos como dona (categórica, paleta CVD-segura validada) más
 * una leyenda que da la identidad por texto —no solo por color— con el volumen y
 * cuántos llegaron a «seleccionado» (calidad de la fuente, no solo cantidad).
 */
export function SourcesChart({ sources }: { sources: SourceRow[] }) {
  const rows = sources.filter((source) => source.candidates > 0);
  const total = rows.reduce((sum, source) => sum + source.candidates, 0);
  const size = 180;
  const stroke = 26;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const gap = rows.length > 1 ? 2 : 0;

  const arcs = rows.map((source, index) => {
    const before = rows.slice(0, index).reduce((sum, row) => sum + (row.candidates / total) * circumference, 0);
    const length = (source.candidates / total) * circumference;
    const dash = Math.max(0, length - gap);
    return { source: source.source, dash, rest: circumference - dash, offset: before };
  });

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
      <svg
        viewBox={`0 0 ${size} ${size}`}
        width={size}
        height={size}
        role="img"
        aria-label="Distribución de candidatos por fuente"
        className="shrink-0"
      >
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          {arcs.map((arc) => (
            <circle
              key={arc.source}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={SOURCE_COLOR[arc.source]}
              strokeWidth={stroke}
              strokeDasharray={`${arc.dash} ${arc.rest}`}
              strokeDashoffset={-arc.offset}
            >
              {/* Un solo texto: React 19 exige que <title> tenga un único hijo de texto (si no, falla la hidratación). */}
              <title>{`${CANDIDATE_SOURCE_LABELS[arc.source]}: ${rows.find((row) => row.source === arc.source)?.candidates ?? 0}`}</title>
            </circle>
          ))}
        </g>
        <text x={size / 2} y={size / 2 - 2} textAnchor="middle" style={{ fill: "var(--foreground)" }} className="text-2xl font-semibold">
          {total}
        </text>
        <text x={size / 2} y={size / 2 + 16} textAnchor="middle" style={{ fill: "var(--muted-foreground)" }} className="text-[11px]">
          candidatos
        </text>
      </svg>

      <ul className="w-full space-y-2 text-sm">
        {rows.map((source) => (
          <li key={source.source} className="flex items-center gap-2">
            <span className="size-3 shrink-0 rounded-sm" style={{ backgroundColor: SOURCE_COLOR[source.source] }} aria-hidden />
            <span className="min-w-0 flex-1 leading-tight">{CANDIDATE_SOURCE_LABELS[source.source]}</span>
            <span className="tabular-nums text-muted-foreground">
              {source.candidates} · {formatPercent(source.share * 100)}
            </span>
            <span className="w-32 text-right text-xs tabular-nums text-muted-foreground">
              {source.selected} a seleccionado
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

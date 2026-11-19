import { ArrowDownRightIcon, ArrowUpRightIcon, MinusIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Sparkline } from "@/components/reports/sparkline";

/**
 * Variación respecto al periodo anterior. `direction` es la flecha (sube/baja);
 * `tone` es el color (positivo/negativo/neutro), decidido por quien crea la
 * tarjeta, no por la flecha: subir no siempre es «bueno». El dato va en texto
 * además del color y el icono, nunca solo en color.
 */
export type StatDelta = { text: string; direction: "up" | "down" | "flat"; tone: "positive" | "negative" | "neutral" };

/** Fila de tarjetas KPI (resumen ejecutivo). Números grandes en tinta normal. */
export type StatTile = { label: string; value: string; hint?: string; delta?: StatDelta; spark?: number[] };

const TONE_CLASS: Record<StatDelta["tone"], string> = {
  positive: "text-success-foreground",
  negative: "text-danger-foreground",
  neutral: "text-muted-foreground",
};

function DeltaBadge({ delta }: { delta: StatDelta }) {
  const Icon = delta.direction === "up" ? ArrowUpRightIcon : delta.direction === "down" ? ArrowDownRightIcon : MinusIcon;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-xs font-medium tabular-nums", TONE_CLASS[delta.tone])}>
      <Icon className="size-3.5" aria-hidden />
      {delta.text}
    </span>
  );
}

export function StatTiles({ tiles }: { tiles: StatTile[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {tiles.map((tile) => (
        <div key={tile.label} className="rounded-lg border bg-card p-3 shadow-xs">
          <div className="text-xs text-muted-foreground">{tile.label}</div>
          <div className="mt-1 flex items-end justify-between gap-2">
            <div className="text-2xl font-semibold">{tile.value}</div>
            {tile.spark ? <Sparkline values={tile.spark} className="h-7 w-16 shrink-0" /> : null}
          </div>
          {tile.delta || tile.hint ? (
            <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
              {tile.delta ? <DeltaBadge delta={tile.delta} /> : null}
              {tile.hint ? <span className="text-xs text-muted-foreground">{tile.hint}</span> : null}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

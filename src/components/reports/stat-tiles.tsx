/** Fila de tarjetas KPI (resumen ejecutivo). Números grandes en tinta normal. */
export type StatTile = { label: string; value: string; hint?: string };

export function StatTiles({ tiles }: { tiles: StatTile[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {tiles.map((tile) => (
        <div key={tile.label} className="rounded-lg border bg-card p-3 shadow-xs">
          <div className="text-xs text-muted-foreground">{tile.label}</div>
          <div className="mt-1 text-2xl font-semibold">{tile.value}</div>
          {tile.hint ? <div className="mt-0.5 text-xs text-muted-foreground">{tile.hint}</div> : null}
        </div>
      ))}
    </div>
  );
}

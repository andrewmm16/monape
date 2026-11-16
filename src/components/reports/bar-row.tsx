/** Fila con barra horizontal simple (CSS). El valor también va en texto: la barra es decorativa. */
export function BarRow({
  label,
  value,
  max,
  suffix,
}: {
  label: string;
  value: number;
  max: number;
  suffix?: string;
}) {
  const width = value === 0 || max <= 0 ? 0 : Math.max(3, (value / max) * 100);
  return (
    <li className="grid grid-cols-[minmax(0,7.5rem)_1fr_auto] items-center gap-3 text-sm sm:grid-cols-[10rem_1fr_auto]">
      <span className="truncate text-muted-foreground">{label}</span>
      <span className="h-2 rounded-full bg-muted" aria-hidden>
        <span className="block h-2 rounded-full bg-brand" style={{ width: `${width}%` }} />
      </span>
      <span className="min-w-12 text-right tabular-nums">
        {value}
        {suffix ? <span className="ml-1 text-xs text-muted-foreground">{suffix}</span> : null}
      </span>
    </li>
  );
}

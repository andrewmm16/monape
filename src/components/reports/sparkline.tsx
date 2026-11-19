/**
 * Mini gráfico de línea (sparkline) para una serie corta dentro de una tarjeta
 * KPI. Es decorativo: el número grande de la tarjeta ya da el valor, así que va
 * marcado como `aria-hidden` y la forma solo sugiere la evolución reciente.
 */
export function Sparkline({ values, className }: { values: number[]; className?: string }) {
  if (values.length < 2) return null;
  const width = 100;
  const height = 28;
  const max = Math.max(1, ...values);
  const min = Math.min(...values);
  const span = Math.max(1, max - min);
  const step = width / (values.length - 1);
  const coords = values.map((value, index) => {
    const x = index * step;
    const y = height - 3 - ((value - min) / span) * (height - 6); // margen de 3px arriba y abajo
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const line = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c}`).join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={className}
      aria-hidden
      focusable="false"
    >
      <path d={area} fill="var(--brand)" opacity={0.12} />
      <path
        d={line}
        fill="none"
        stroke="var(--brand)"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

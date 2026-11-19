/**
 * Orden de lectura de un PDF: devuelve a su línea los fragmentos que el PDF
 * guarda FUERA de orden (19/11/2026, banco ciego 2).
 *
 * El caso típico es la fecha alineada a la derecha del cargo («Operador de
 * montacargas | Distribuidora…        Mar 2019 – a la fecha»). En un CV hecho en
 * HTML (generadores web, Computrabajo, Bumeran, «Imprimir a PDF» de Chrome) esa
 * fecha es un elemento flotante, y el navegador dibuja los flotantes ANTES que el
 * texto normal: en el PDF todas las fechas quedan al principio de la página,
 * separadas de sus cargos, y el motor no puede sumar los años de experiencia.
 *
 * La corrección es conservadora. Una línea se lleva al final de otra solo si:
 *  - es CORTA y está alineada al margen DERECHO (una fecha, un lugar);
 *  - la otra está a su misma altura, entera a su izquierda y viene DESPUÉS en el
 *    PDF (si no, el orden ya era el bueno);
 *  - entre las dos no empieza una columna: dos o más líneas cercanas alineadas en
 *    un mismo borde izquierdo dentro del hueco. Así, en un CV a dos columnas, una
 *    fecha de la columna derecha nunca se pega a una línea de la barra lateral.
 * Sin el ancho de los fragmentos (`width`) no se mueve nada.
 *
 * Módulo PURO: recibe los fragmentos visibles de una página en el orden del PDF y
 * devuelve el texto de la página (`str` + salto en cada `hasEOL`). Si no hay nada
 * fuera de orden, el resultado es idéntico al ensamblado de siempre.
 */

export type OrderItem = { str: string; x: number; y: number; fontSize: number; hasEOL: boolean; width?: number };

/** Largo máximo de la línea que se puede mover (una fecha, un lugar, un teléfono). */
const MAX_MOVED_CHARS = 60;
const MAX_MOVED_ITEMS = 6;
/** Misma altura: diferencia de línea base por debajo de esta fracción del tamaño de letra. */
const SAME_LINE = 0.5;
/** Alineado a la derecha: termina a menos de un tamaño de letra del borde derecho del texto. */
const RIGHT_ALIGNED = 1;
/** Ventana vertical (en tamaños de letra, unas 20 líneas) donde se buscan bordes de columna. */
const COLUMN_WINDOW = 25;
/** Tolerancia (pt) para considerar que dos líneas empiezan en el mismo borde. */
const SAME_EDGE = 2;

type StreamLine = {
  items: OrderItem[];
  eol: boolean;
  text: string;
  y: number;
  fontSize: number;
  x0: number;
  x1: number;
  /** Todos sus fragmentos con texto tienen ancho y están a la misma altura. */
  measurable: boolean;
};

function toStreamLines(items: readonly OrderItem[]): StreamLine[] {
  const lines: StreamLine[] = [];
  let current: OrderItem[] = [];
  const close = (eol: boolean) => {
    const ink = current.filter((item) => item.str.trim() !== "");
    const first = ink[0];
    const fontSize = Math.max(0, ...ink.map((item) => item.fontSize));
    const measurable =
      first !== undefined &&
      fontSize > 0 &&
      ink.every((item) => (item.width ?? 0) > 0 && Math.abs(item.y - first.y) <= SAME_LINE * fontSize);
    lines.push({
      items: current,
      eol,
      text: current.map((item) => item.str).join(""),
      y: first?.y ?? 0,
      fontSize,
      x0: Math.min(...ink.map((item) => item.x)),
      x1: Math.max(...ink.map((item) => item.x + (item.width ?? 0))),
      measurable,
    });
    current = [];
  };
  for (const item of items) {
    current.push(item);
    if (item.hasEOL) close(true);
  }
  if (current.length > 0) close(false);
  return lines;
}

const plain = (items: readonly OrderItem[]) => items.map((item) => item.str + (item.hasEOL ? "\n" : "")).join("");

/** Texto de la página en orden de lectura (ver la explicación del módulo). */
export function readingOrderText(items: readonly OrderItem[]): string {
  const lines = toStreamLines(items);
  const measurable = lines.filter((line) => line.measurable);
  // Borde derecho del texto de la página: un flotante a la derecha termina ahí.
  const rightEdge = Math.max(0, ...measurable.map((line) => line.x1));
  const isShort = (line: StreamLine) =>
    line.text.trim().length <= MAX_MOVED_CHARS && line.items.filter((item) => item.str.trim() !== "").length <= MAX_MOVED_ITEMS;
  const isRightFloat = (line: StreamLine) => line.measurable && isShort(line) && rightEdge - line.x1 <= RIGHT_ALIGNED * line.fontSize;

  const moved = new Set<number>();
  const attached = new Map<number, number[]>();
  lines.forEach((line, i) => {
    if (!isRightFloat(line) || attached.has(i)) return;

    // La línea de destino: después en el PDF, a la misma altura y entera a la izquierda; la más cercana.
    let target = -1;
    for (let j = i + 1; j < lines.length; j++) {
      const other = lines[j]!;
      if (!other.measurable || moved.has(j)) continue;
      if (Math.abs(other.y - line.y) > SAME_LINE * Math.max(line.fontSize, other.fontSize)) continue;
      if (other.x1 > line.x0 + 1) continue;
      if (target === -1 || other.x1 > lines[target]!.x1) target = j;
    }
    if (target === -1) return;

    // ¿Empieza una columna en el hueco? Dos o más líneas cercanas con el mismo borde
    // izquierdo entre el final del destino y el inicio de la línea (sin contar otros flotantes).
    const from = lines[target]!.x1 + SAME_EDGE;
    const to = line.x0 - SAME_EDGE;
    const edges = lines
      .filter(
        (other, k) =>
          k !== i &&
          k !== target &&
          other.measurable &&
          !isRightFloat(other) &&
          Math.abs(other.y - line.y) <= COLUMN_WINDOW * line.fontSize &&
          other.x0 > from &&
          other.x0 < to,
      )
      .map((other) => other.x0);
    if (edges.some((x, a) => edges.some((y, b) => a !== b && Math.abs(x - y) <= SAME_EDGE))) return;

    moved.add(i);
    attached.set(target, [...(attached.get(target) ?? []), i]);
  });

  if (moved.size === 0) return plain(items);
  let out = "";
  lines.forEach((line, i) => {
    if (moved.has(i)) return;
    const extra = (attached.get(i) ?? [])
      .map((k) => lines[k]!)
      .sort((a, b) => a.x0 - b.x0)
      .map((l) => ` ${l.text.trim()}`)
      .join("");
    out += line.text + extra + (line.eol ? "\n" : "");
  });
  return out;
}

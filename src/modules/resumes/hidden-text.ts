/**
 * Detección de texto OCULTO en un PDF: fragmentos que el extractor lee pero que
 * una persona no ve. Es la base de la señal "CV con trampas para el filtro":
 * keywords metidos con tamaño ~0 o fuera de la página para inflar las
 * coincidencias con los términos de la vacante.
 *
 * Módulo PURO y determinista (sin red, sin pdf.js): recibe fragmentos ya
 * extraídos y el tamaño de la página, para poder probarlo de forma aislada. El
 * mapeo desde los `items` reales de pdf.js (su `transform`) vive en la capa de
 * extracción. En PDF cubre tres trucos: tamaño minúsculo, fuera de página y sin
 * contraste con el fondo (este último lo marca la extracción tras renderizar la
 * página, ver pdf-contrast.ts). El DOCX tiene su propia detección
 * (docx-hidden.ts) y comparte con el PDF el tipo de fragmento y el aviso a RRHH.
 */

/**
 * Un fragmento de texto con su tamaño de fuente (pt) y su origen en el espacio de
 * la página (pt). `lowContrast` lo marca la capa de extracción cuando, en la página
 * renderizada, el texto no se distingue del fondo (ver pdf-contrast.ts).
 */
export type TextFragment = { str: string; fontSize: number; x: number; y: number; lowContrast?: boolean };

/** Área visible de la página, en puntos PDF. */
export type PageBox = { width: number; height: number };

/**
 * Motivo por el que el texto no se ve: fuente minúscula; en PDF, fuera de la página
 * o sin contraste con el fondo; en DOCX, marcado como oculto o blanco sin fondo.
 */
export type HiddenReason = "tiny" | "offpage" | "nocontrast" | "vanish" | "white";

/** Texto oculto detectado. En PDF lleva tamaño y posición; en DOCX, el tamaño solo si es minúsculo. */
export type HiddenText = { str: string; fontSize?: number; x?: number; y?: number };

export type HiddenFragment = { fragment: HiddenText; reason: HiddenReason };

const REASON_LABELS: Record<HiddenReason, string> = {
  tiny: "fuente diminuta",
  offpage: "fuera de la página",
  nocontrast: "del mismo color que el fondo o tapado por otro elemento",
  vanish: "marcado como oculto en Word",
  white: "en blanco sobre fondo blanco",
};

/** Por debajo de este tamaño de fuente (pt) el texto es ilegible: truco de ocultamiento. */
export const DEFAULT_MIN_FONT_SIZE = 3;

/** Tolerancia (pt) para no marcar como "fuera de página" un texto pegado al borde. */
const OFFPAGE_MARGIN = 2;

/**
 * Devuelve los fragmentos que parecen ocultos, con el motivo. No decide nada
 * sobre el candidato: solo señala qué excluir del texto evaluado y qué mostrar
 * a RRHH para que lo revise.
 */
export function findHiddenFragments(
  fragments: TextFragment[],
  page: PageBox,
  opts: { minFontSize?: number } = {},
): HiddenFragment[] {
  const minFontSize = opts.minFontSize ?? DEFAULT_MIN_FONT_SIZE;
  const hidden: HiddenFragment[] = [];
  for (const fragment of fragments) {
    if (fragment.str.trim() === "") continue;
    if (fragment.fontSize < minFontSize) {
      hidden.push({ fragment, reason: "tiny" });
      continue;
    }
    const offpage =
      fragment.x < -OFFPAGE_MARGIN ||
      fragment.y < -OFFPAGE_MARGIN ||
      fragment.x > page.width + OFFPAGE_MARGIN ||
      fragment.y > page.height + OFFPAGE_MARGIN;
    if (offpage) {
      hidden.push({ fragment, reason: "offpage" });
      continue;
    }
    if (fragment.lowContrast === true) hidden.push({ fragment, reason: "nocontrast" });
  }
  return hidden;
}

/**
 * Redacta el aviso para RRHH cuando se detectó texto oculto. Devuelve null si
 * no hay nada que avisar. No juzga al candidato: informa el hecho (texto no
 * visible excluido de la evaluación) y muestra el contenido para que una
 * persona lo revise en el archivo original.
 */
export function summarizeHidden(hidden: HiddenFragment[], maxChars = 300): string | null {
  const contenido = hidden
    .map((h) => h.fragment.str.trim())
    .filter((s) => s !== "")
    .join(" · ");
  if (contenido === "") return null;
  const recortado = contenido.length > maxChars ? `${contenido.slice(0, maxChars)}…` : contenido;
  const motivos = [...new Set(hidden.map((h) => REASON_LABELS[h.reason]))]
    .join(", ")
    .replace(/, ([^,]*)$/, " y $1");
  return `Se detectó texto no visible en el documento (${motivos}), que no ve una persona al abrirlo; se excluyó de la evaluación para que no altere las coincidencias. Contenido oculto: «${recortado}». Revise el archivo original antes de decidir.`;
}

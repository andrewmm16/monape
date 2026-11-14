/**
 * Detección de texto OCULTO en un PDF: fragmentos que el extractor lee pero que
 * una persona no ve. Es la base de la señal "CV con trampas para el filtro":
 * keywords metidos con tamaño ~0 o fuera de la página para inflar las
 * coincidencias con los términos de la vacante.
 *
 * Módulo PURO y determinista (sin red, sin pdf.js): recibe fragmentos ya
 * extraídos y el tamaño de la página, para poder probarlo de forma aislada. El
 * mapeo desde los `items` reales de pdf.js (su `transform`) vive en la capa de
 * extracción. Esta versión cubre dos trucos (tamaño minúsculo y fuera de
 * página); el blanco-sobre-blanco (color) y el keyword-stuffing son fases
 * aparte.
 */

/** Un fragmento de texto con su tamaño de fuente (pt) y su origen en el espacio de la página (pt). */
export type TextFragment = { str: string; fontSize: number; x: number; y: number };

/** Área visible de la página, en puntos PDF. */
export type PageBox = { width: number; height: number };

export type HiddenReason = "tiny" | "offpage";

export type HiddenFragment = { fragment: TextFragment; reason: HiddenReason };

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
    if (offpage) hidden.push({ fragment, reason: "offpage" });
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
  return `Se detectó texto no visible en el documento (fuente diminuta o fuera de la página), que no ve una persona al abrirlo; se excluyó de la evaluación para que no altere las coincidencias. Contenido oculto: «${recortado}». Revise el archivo original antes de decidir.`;
}

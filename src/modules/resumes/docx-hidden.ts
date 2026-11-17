import { strFromU8, strToU8 } from "fflate";
import { decodeXmlText } from "./docx.ts";
import type { HiddenFragment, HiddenReason } from "./hidden-text.ts";

/**
 * Texto OCULTO en un DOCX: ejecuciones (runs) que Word guarda pero que una persona
 * no ve al abrir el documento. mammoth las extrae como si fueran texto normal, así
 * que se quitan del XML ANTES de extraer y se devuelven aparte para avisar a RRHH.
 * Es el mismo contrato que en PDF (ver hidden-text.ts): el motor evalúa solo lo
 * visible y el texto oculto no infla las coincidencias.
 *
 * Tres trucos, con criterio conservador (ante la duda, el texto se trata como
 * visible, porque excluir texto legítimo le quitaría evidencia al candidato):
 *  - «vanish»: la propiedad «Oculto» de Word (w:vanish), directa o por estilo;
 *  - «tiny»: fuente de menos de 3 pt (w:sz va en medios puntos);
 *  - «white»: color blanco o casi blanco SIN ningún fondo detrás. Si hay sombreado
 *    de la ejecución, del párrafo, de la celda o del estilo de tabla, resaltado,
 *    color de página, cuadros de texto o formas en cualquier parte del documento
 *    (las barras laterales oscuras de las plantillas), el blanco no se marca.
 *
 * Módulo puro y determinista: recibe XML y devuelve XML, sin mammoth ni E/S.
 */

/** Medios puntos: por debajo de 6 (3 pt), igual que el umbral del PDF. */
const MIN_HALF_POINTS = 6;

/** Partes del DOCX con texto que se extrae: cuerpo, encabezados, pies y notas. */
const SCANNED_PARTS = /^word\/(?:document|header\d*|footer\d*|footnotes|endnotes)\.xml$/;

/**
 * Elementos que pueden quedar DETRÁS del texto y hacer legible el blanco: color de
 * página, imágenes o formas ancladas detrás, formas VML y de DrawingML.
 */
const BACKDROP = /<w:background\b|behindDoc="(?:1|true)"|<v:(?:rect|roundrect|shape|oval|polyline)\b|<wps:wsp\b/;

/**
 * Tokenizador mínimo de XML: comentarios, instrucciones, CDATA, etiquetas y texto.
 * Cubre TODOS los caracteres de la entrada (el último «<» atrapa uno suelto), de
 * modo que concatenar los tokens reproduce el XML original exacto.
 */
const TOKEN =
  /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<!DOCTYPE[^>]*>|<(\/?)([A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?)([^>]*?)(\/?)>|[^<]+|</g;

const ATTR_RE = new Map<string, RegExp>();
function attr(attrs: string, name: string): string | undefined {
  let re = ATTR_RE.get(name);
  if (!re) {
    re = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`);
    ATTR_RE.set(name, re);
  }
  const m = re.exec(attrs);
  return m ? (m[1] ?? m[2]) : undefined;
}

/** Propiedad booleana de WordprocessingML: sin w:val es verdadera; «0/false/off», falsa. */
function onOff(attrs: string): boolean {
  const value = attr(attrs, "w:val");
  return value === undefined || !/^(?:0|false|off)$/i.test(value);
}

const HEX = /^[0-9a-f]{6}$/i;

/** Blanco o casi blanco: cada canal ≥ 0xF0. «auto» y los colores de tema no lo son. */
function isNearWhite(hex: string | undefined): boolean {
  if (hex === undefined || !HEX.test(hex)) return false;
  return [0, 2, 4].every((i) => Number.parseInt(hex.slice(i, i + 2), 16) >= 0xf0);
}

/** Un color de fondo que se ve: hexadecimal y no casi blanco. */
function isVisibleFill(hex: string | undefined): boolean {
  return hex !== undefined && HEX.test(hex) && !isNearWhite(hex);
}

/** El sombreado (w:shd) pinta un fondo: relleno de color, de tema o un patrón con color. */
function shadingPaints(attrs: string): boolean {
  const fill = attr(attrs, "w:fill");
  if (isVisibleFill(fill)) return true;
  if (fill === undefined && attr(attrs, "w:themeFill") !== undefined) return true;
  const pattern = attr(attrs, "w:val");
  return pattern !== undefined && !/^(?:clear|nil)$/i.test(pattern) && isVisibleFill(attr(attrs, "w:color"));
}

/** Propiedades de ejecución que importan aquí. `undefined` = no definida en este nivel. */
type RunProps = { vanish?: boolean; halfPoints?: number; color?: string; shading?: boolean; highlight?: boolean };

/** Combina dos niveles: manda el primero y el segundo completa lo que falte. */
function over(first: RunProps, second: RunProps): RunProps {
  return {
    vanish: first.vanish ?? second.vanish,
    halfPoints: first.halfPoints ?? second.halfPoints,
    color: first.color ?? second.color,
    shading: first.shading ?? second.shading,
    highlight: first.highlight ?? second.highlight,
  };
}

function applyRunProperty(props: RunProps, name: string, attrs: string): void {
  switch (name) {
    case "w:vanish":
      props.vanish = onOff(attrs);
      break;
    case "w:sz": {
      const value = Number(attr(attrs, "w:val"));
      if (Number.isFinite(value)) props.halfPoints = value;
      break;
    }
    case "w:color": {
      const value = attr(attrs, "w:val");
      if (value !== undefined) props.color = value;
      break;
    }
    case "w:shd":
      props.shading = shadingPaints(attrs);
      break;
    case "w:highlight":
      props.highlight = (attr(attrs, "w:val") ?? "none") !== "none";
      break;
  }
}

type StyleDef = { basedOn?: string; run: RunProps; paragraphShading?: boolean; paintsCells: boolean };

/** Estilos del documento (word/styles.xml) reducidos a lo que afecta a la visibilidad. */
export type DocxStyles = { defaults: RunProps; byId: Map<string, StyleDef>; defaultParagraph?: string };

/** Lee word/styles.xml. Con null (o un XML ilegible) devuelve estilos vacíos. */
export function parseDocxStyles(xml: string | null): DocxStyles {
  const result: DocxStyles = { defaults: {}, byId: new Map() };
  if (!xml) return result;
  const stack: string[] = [];
  let current: StyleDef | null = null;
  for (const m of xml.matchAll(TOKEN)) {
    const [, closing, name, attrs = "", selfClosing] = m;
    if (name === undefined) continue;
    if (closing) {
      stack.pop();
      if (name === "w:style") current = null;
      continue;
    }
    const parent = stack[stack.length - 1];
    const grandparent = stack[stack.length - 2];
    if (name === "w:style") {
      current = { run: {}, paintsCells: false };
      const id = attr(attrs, "w:styleId");
      if (id !== undefined) result.byId.set(id, current);
      const isDefault = /^(?:1|true|on)$/i.test(attr(attrs, "w:default") ?? "");
      if (id !== undefined && isDefault && attr(attrs, "w:type") === "paragraph") result.defaultParagraph = id;
    } else if (current !== null) {
      if (name === "w:basedOn") current.basedOn = attr(attrs, "w:val");
      else if (parent === "w:rPr" && grandparent === "w:style") applyRunProperty(current.run, name, attrs);
      else if (parent === "w:pPr" && grandparent === "w:style" && name === "w:shd") current.paragraphShading = shadingPaints(attrs);
      // Cualquier sombreado dentro de un estilo (p. ej. las filas de un estilo de tabla).
      if (name === "w:shd" && shadingPaints(attrs)) current.paintsCells = true;
    } else if (parent === "w:rPr" && grandparent === "w:rPrDefault") {
      applyRunProperty(result.defaults, name, attrs);
    }
    if (!selfClosing) stack.push(name);
  }
  return result;
}

/** Recorre la cadena «basedOn» de un estilo (con tope ante ciclos). */
function styleChain(styles: DocxStyles, id: string | undefined): StyleDef[] {
  const chain: StyleDef[] = [];
  const seen = new Set<string>();
  while (id !== undefined && !seen.has(id) && chain.length < 20) {
    seen.add(id);
    const style = styles.byId.get(id);
    if (!style) break;
    chain.push(style);
    id = style.basedOn;
  }
  return chain;
}

function styleRun(styles: DocxStyles, id: string | undefined): RunProps {
  return styleChain(styles, id).reduce<RunProps>((acc, style) => over(acc, style.run), {});
}

function styleParagraphShading(styles: DocxStyles, id: string | undefined): boolean {
  for (const style of styleChain(styles, id)) {
    if (style.paragraphShading !== undefined) return style.paragraphShading;
  }
  return false;
}

type ParagraphFrame = { style?: string; shading?: boolean };
type RunFrame = { style?: string; props: RunProps };
type Pending = { reason: HiddenReason; text: string; fontSize?: number };

/**
 * Quita de un XML de WordprocessingML el texto de las ejecuciones que no se ven y
 * devuelve ese texto aparte (agrupado por párrafo y motivo). Si no hay nada oculto,
 * devuelve el XML idéntico. `whiteDetection: false` desactiva el criterio del
 * blanco (cuando otra parte del documento tiene formas que pueden quedar detrás).
 */
export function stripHiddenRuns(
  xml: string,
  styles: DocxStyles,
  opts: { whiteDetection?: boolean } = {},
): { xml: string; hidden: HiddenFragment[] } {
  const whiteDetection = (opts.whiteDetection ?? true) && !BACKDROP.test(xml);
  const out: string[] = [];
  const hidden: HiddenFragment[] = [];
  const stack: string[] = [];
  const paragraphs: ParagraphFrame[] = [];
  const runs: RunFrame[] = [];
  const cells: boolean[] = [];
  const tables: boolean[] = [];
  let textBoxes = 0;
  let inText = false;
  let textReason: HiddenReason | null = null;
  let textFontSize: number | undefined;
  let pending: Pending | null = null;
  let changed = false;

  const flush = () => {
    if (pending !== null) {
      const str = pending.text.trim();
      if (str !== "") {
        hidden.push({ fragment: pending.fontSize !== undefined ? { str, fontSize: pending.fontSize } : { str }, reason: pending.reason });
      }
      pending = null;
    }
  };

  const reasonForCurrentRun = (): { reason: HiddenReason | null; fontSize?: number } => {
    const run = runs[runs.length - 1];
    if (!run) return { reason: null };
    const paragraph = paragraphs[paragraphs.length - 1];
    const paragraphStyle = paragraph?.style ?? styles.defaultParagraph;
    const effective = over(over(over(run.props, styleRun(styles, run.style)), styleRun(styles, paragraphStyle)), styles.defaults);
    if (effective.vanish === true) return { reason: "vanish" };
    if (effective.halfPoints !== undefined && effective.halfPoints < MIN_HALF_POINTS) {
      return { reason: "tiny", fontSize: effective.halfPoints / 2 };
    }
    const backdrop =
      effective.shading === true ||
      effective.highlight === true ||
      paragraph?.shading === true ||
      (paragraph?.shading === undefined && styleParagraphShading(styles, paragraphStyle)) ||
      cells.some(Boolean) ||
      tables.some(Boolean) ||
      textBoxes > 0;
    if (whiteDetection && !backdrop && isNearWhite(effective.color)) return { reason: "white" };
    return { reason: null };
  };

  for (const m of xml.matchAll(TOKEN)) {
    const token = m[0];
    const [, closing, name, attrs = "", selfClosing] = m;

    if (name === undefined) {
      // Texto (u otro nodo sin nombre). Solo se quita el contenido de un w:t oculto.
      if (inText && textReason !== null && !token.startsWith("<")) {
        const text = decodeXmlText(token);
        if (pending !== null && (pending.reason !== textReason || pending.fontSize !== textFontSize)) flush();
        if (pending === null) pending = { reason: textReason, text: "", fontSize: textFontSize };
        pending.text += text;
        changed = true;
        continue;
      }
      if (inText && textReason === null && token.trim() !== "") flush();
      out.push(token);
      continue;
    }

    out.push(token);

    if (closing) {
      stack.pop();
      switch (name) {
        case "w:p":
          flush();
          paragraphs.pop();
          break;
        case "w:r":
          runs.pop();
          break;
        case "w:tc":
          cells.pop();
          break;
        case "w:tbl":
          tables.pop();
          break;
        case "w:txbxContent":
          textBoxes = Math.max(0, textBoxes - 1);
          break;
        case "w:t":
          inText = false;
          break;
      }
      continue;
    }

    const parent = stack[stack.length - 1];
    const grandparent = stack[stack.length - 2];
    if (parent === "w:rPr" && grandparent === "w:r") {
      const run = runs[runs.length - 1];
      if (run) {
        if (name === "w:rStyle") run.style = attr(attrs, "w:val");
        else applyRunProperty(run.props, name, attrs);
      }
    } else if (parent === "w:pPr" && grandparent === "w:p") {
      const paragraph = paragraphs[paragraphs.length - 1];
      if (paragraph && name === "w:pStyle") paragraph.style = attr(attrs, "w:val");
      else if (paragraph && name === "w:shd") paragraph.shading = shadingPaints(attrs);
    } else if (parent === "w:tcPr" && grandparent === "w:tc" && name === "w:shd") {
      if (cells.length > 0) cells[cells.length - 1] = shadingPaints(attrs);
    } else if (parent === "w:tblPr" && grandparent === "w:tbl") {
      if (tables.length > 0 && name === "w:tblStyle") {
        tables[tables.length - 1] ||= styleChain(styles, attr(attrs, "w:val")).some((s) => s.paintsCells);
      } else if (tables.length > 0 && name === "w:shd") {
        tables[tables.length - 1] ||= shadingPaints(attrs);
      }
    }

    if (selfClosing) continue;
    stack.push(name);
    switch (name) {
      case "w:p":
        paragraphs.push({});
        break;
      case "w:r":
        runs.push({ props: {} });
        break;
      case "w:tc":
        cells.push(false);
        break;
      case "w:tbl":
        tables.push(false);
        break;
      case "w:txbxContent":
        textBoxes += 1;
        break;
      case "w:t": {
        inText = true;
        const { reason, fontSize } = reasonForCurrentRun();
        textReason = reason;
        textFontSize = fontSize;
        break;
      }
    }
  }
  flush();
  return { xml: changed ? out.join("") : xml, hidden };
}

/**
 * Limpia de texto oculto todas las partes de texto de un DOCX ya inspeccionado.
 * Devuelve las partes (solo se reemplazan las que tenían algo oculto) y los
 * fragmentos excluidos, empezando por el cuerpo del documento.
 */
export function stripHiddenDocxText(parts: Record<string, Uint8Array>): {
  parts: Record<string, Uint8Array>;
  hidden: HiddenFragment[];
} {
  const names = Object.keys(parts)
    .filter((name) => SCANNED_PARTS.test(name))
    .sort((a, b) => (a === "word/document.xml" ? -1 : b === "word/document.xml" ? 1 : a.localeCompare(b)));
  const xmls = new Map(names.map((name) => [name, strFromU8(parts[name]!)]));
  const stylesPart = parts["word/styles.xml"];
  const styles = parseDocxStyles(stylesPart ? strFromU8(stylesPart) : null);
  // Una forma en un encabezado puede quedar detrás del cuerpo: el blanco se evalúa
  // solo si NINGUNA parte del documento tiene algo que pueda ir detrás del texto.
  const whiteDetection = ![...xmls.values()].some((xml) => BACKDROP.test(xml));

  const result: Record<string, Uint8Array> = { ...parts };
  const hidden: HiddenFragment[] = [];
  for (const [name, xml] of xmls) {
    const stripped = stripHiddenRuns(xml, styles, { whiteDetection });
    if (stripped.hidden.length === 0) continue;
    result[name] = strToU8(stripped.xml);
    hidden.push(...stripped.hidden);
  }
  return { parts: result, hidden };
}

import type { Field, Site, Step } from "./sites";

/**
 * Variante de un portal ficticio: los cambios de estructura vigentes sobre el sitio
 * original. Un `Variant` vacío es el sitio de siempre; `resolveSite` lo aplica sin
 * tocar el original (los sitios de `sites.ts` no se modifican nunca).
 */
export interface Variant {
  // ---- Estructurales: cada una rompe algún selector o paso de los adaptadores.
  /** Campos (por su nombre original) cuyo `name` e `id` cambian. */
  renombrar?: string[];
  /** El botón de retirar y el estado «cerrado» cambian de texto. */
  textosCambiados?: boolean;
  /** Los botones del formulario aparecen solo al abrir un menú «Más acciones». */
  botonEnMenu?: boolean;
  /** Un paso nuevo en el asistente (el 2.º). */
  pasoExtra?: boolean;
  /** Los pasos 2 y 3 del asistente cambian de lugar. */
  reordenarPasos?: boolean;
  /** Un campo nuevo y obligatorio en el primer paso. */
  campoObligatorio?: boolean;
  /** Campos (por su nombre original) que pasan de texto libre a lista desplegable. */
  camposALista?: string[];
  /** Una ventana de cookies tapa el formulario de publicar. */
  avisoCookies?: boolean;
  /** La lista de postulantes se pagina y cambia de marcas. */
  paginarPostulantes?: boolean;
  /** El enlace de descarga del CV pasa a ser un botón con JavaScript. */
  enlaceCv?: boolean;
  // ---- Cosmética: solo aspecto, ningún selector cambia.
  cosmetico?: string;
}

export const COSMETICOS = ["colores", "tamanos", "tipografia", "espaciado", "orden_visual"] as const;

export const isEmptyVariant = (variant: Variant): boolean => Object.values(variant).every((value) => value === undefined || value === false || (Array.isArray(value) && value.length === 0));

/** Une un cambio a la variante vigente (las listas se suman sin repetir). */
export function mergeVariant(current: Variant, patch: Variant): Variant {
  const merged: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    const before = merged[key];
    merged[key] = Array.isArray(value) ? [...new Set([...((before as string[] | undefined) ?? []), ...value])] : value;
  }
  return merged as Variant;
}

export const cloneVariant = (variant: Variant): Variant => JSON.parse(JSON.stringify(variant)) as Variant;

const CIUDADES: [string, string][] = [
  ["", "Seleccione una ciudad"],
  ["Lima", "Lima"],
  ["Arequipa", "Arequipa"],
  ["Trujillo", "Trujillo"],
  ["Cusco", "Cusco"],
];

/** CSS de cada cambio cosmético; `s` es la clase del `<body>` del sitio. */
function cosmeticCss(id: string, s: string): string {
  switch (id) {
    case "colores":
      return `body.${s} .hd{background:#374151!important}body.${s} button,body.${s} .btn{background:#b45309!important;color:#fff!important}body.${s} .card{background:#fffbeb!important}`;
    case "tamanos":
      return `body.${s}{font-size:18px}body.${s} input[type=text],body.${s} textarea,body.${s} select{padding:.8rem!important}body.${s} button,body.${s} .btn{padding:.8rem 1.8rem!important;font-size:1.1rem}`;
    case "tipografia":
      return `body.${s}{font-family:Georgia,"Times New Roman",serif!important;letter-spacing:.2px}body.${s} h1{font-weight:400}`;
    case "espaciado":
      return `body.${s} .card{padding:1.8rem 2.2rem!important;margin-bottom:1.6rem!important}body.${s} .campo,body.${s} .fila{margin-bottom:1.4rem}`;
    case "orden_visual":
      return `body.${s} .acciones{display:flex;flex-direction:row-reverse;justify-content:flex-end}body.${s} .hd nav{flex-direction:row-reverse}`;
    default:
      return "";
  }
}

/** El sitio tal como se ve con la variante vigente. Sin cambios devuelve el mismo sitio original. */
export function resolveSite(site: Site, variant: Variant): Site {
  if (isEmptyVariant(variant)) return site;

  const steps: Step[] = site.steps.map((step) => ({ ...step, fields: step.fields.map((field): Field => ({ ...field })) }));
  const map = { ...site.map };
  const fieldsNamed = (name: string) => steps.flatMap((step) => step.fields).filter((field) => field.name === name);

  for (const name of variant.renombrar ?? []) {
    const renamed = `${name}_v2`;
    for (const field of fieldsNamed(name)) {
      field.name = renamed;
      if (field.id) field.id = `${field.id}-v2`;
    }
    for (const key of Object.keys(map) as (keyof Site["map"])[]) if (map[key] === name) map[key] = renamed;
  }
  for (const name of variant.camposALista ?? []) {
    for (const field of fieldsNamed(name)) Object.assign(field, { kind: "select", options: CIUDADES });
  }
  if (variant.campoObligatorio) {
    steps[0]!.fields.push({ name: "codigo_aviso", id: "codigo-aviso", label: "Código interno del aviso", kind: "text", required: true });
  }
  if (variant.reordenarPasos && steps.length >= 3) [steps[1], steps[2]] = [steps[2]!, steps[1]!];
  if (variant.pasoExtra && steps.length >= 2) {
    steps.splice(1, 0, {
      title: "Verificación del aviso",
      fields: [{ name: "verificacion", id: "verificacion", label: "Confirmo que los datos del aviso son correctos", kind: "checkbox" }],
    });
  }

  const labels = variant.textosCambiados ? { ...site.labels, close: "Finalizar oferta" } : site.labels;
  const statusText = variant.textosCambiados ? (status: Parameters<Site["statusText"]>[0]) => (status === "activa" ? site.statusText(status) : "Finalizado") : site.statusText;
  const css = variant.cosmetico ? `${site.css}\n${cosmeticCss(variant.cosmetico, site.slug)}` : site.css;

  return { ...site, steps, map, labels, statusText, css, variant };
}

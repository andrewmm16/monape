import type { Page } from "@playwright/test";
import { DETALLE, LISTADO, PORTAL } from "./selectors";
import type { OfertaPublica } from "./types";

/** Convierte "Ingeniero Sanitario" en "ingeniero-sanitario" para la ruta de búsqueda. */
export function aSlug(palabraClave: string): string {
  return palabraClave
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // quita tildes
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Arma la URL de búsqueda estandarizada del portal. */
export function construirUrlBusqueda(palabraClave: string): string {
  return `${PORTAL.base}${PORTAL.rutaBusqueda(aSlug(palabraClave))}`;
}

/** Colapsa espacios y saltos de línea en un texto legible de una sola pasada. */
function textoLimpio(valor: string | null | undefined): string {
  return (valor ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Devuelve el texto del primer selector de la lista que encuentre contenido.
 * Así un cambio menor de maquetado no rompe la extracción (se prueba el siguiente).
 */
async function primerTexto(page: Page, selectores: string[]): Promise<string> {
  for (const selector of selectores) {
    const loc = page.locator(selector).first();
    if ((await loc.count()) === 0) continue;
    const texto = textoLimpio(await loc.innerText().catch(() => ""));
    if (texto) return texto;
  }
  return "";
}

/**
 * Recoge las URLs de los avisos de la página de resultados ya cargada.
 * Resuelve a direcciones absolutas y elimina duplicados.
 */
export async function recolectarEnlaces(page: Page): Promise<string[]> {
  for (const selector of LISTADO.enlaceAviso) {
    const hrefs = await page
      .locator(selector)
      .evaluateAll((anclas) => anclas.map((a) => (a as HTMLAnchorElement).getAttribute("href") ?? ""))
      .catch(() => [] as string[]);
    const urls = hrefs
      .filter(Boolean)
      .map((href) => new URL(href, PORTAL.base).toString());
    const unicas = [...new Set(urls)];
    if (unicas.length > 0) return unicas;
  }
  return [];
}

/**
 * Abre un aviso y extrae título, empresa y requerimiento (datos públicos, con PII).
 * Si falta el título lo trata como error: suele indicar un cambio de DOM o una
 * página que no es un aviso (verificación, interstitial), y conviene registrarlo.
 */
export async function extraerOferta(page: Page, url: string): Promise<OfertaPublica & { telefonos?: string[]; correos?: string[] }> {
  await page.goto(url, { waitUntil: "domcontentloaded" });

  const titulo = await primerTexto(page, DETALLE.titulo);
  if (!titulo) {
    throw new Error("sin título: posible cambio de DOM, verificación o página no-aviso");
  }
  const empresa = await primerTexto(page, DETALLE.empresa);
  const requerimiento = await primerTexto(page, DETALLE.requerimiento);

  // === BLOQUE DE EXTRACCIÓN CALETA ===
  // Detecta números de 9 dígitos que empiezan con 9 en Perú (tolera espacios y guiones)
  const regexCelular = /\b9\d{2}[- ]?\d{3}[- ]?\d{3}\b/g;
  // Detecta correos electrónicos estándar expuestos en el texto
  const regexEmail = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

  const telefonosEncontrados = requerimiento.match(regexCelular) || [];
  const correosEncontrados = requerimiento.match(regexEmail) || [];

  return { 
    url, 
    titulo, 
    empresa, 
    requerimiento,
    // Se limpian duplicados por si acaso el mismo número aparece varias veces
    telefonos: [...new Set(telefonosEncontrados)],
    correos: [...new Set(correosEncontrados)]
  };
}

/**
 * Modo diagnóstico: vuelca una vista estructural de un aviso para descubrir los
 * selectores reales. Imprime los primeros nodos candidatos de cada campo con su
 * etiqueta, clases y un recorte de texto. Úsalo para ajustar `selectors.ts`.
 */
export async function inspeccionar(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  const resumen = await page.evaluate(() => {
    const describe = (el: Element) => ({
      tag: el.tagName.toLowerCase(),
      clases: el.className || "(sin clase)",
      id: (el as HTMLElement).id || "",
      texto: (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 120),
    });
    const tomar = (selector: string, n = 5) =>
      [...document.querySelectorAll(selector)].slice(0, n).map(describe);
    return {
      titulo: tomar("h1"),
      candidatosEmpresa: tomar("a[href*='/empresa'], [itemprop='hiringOrganization']"),
      candidatosDescripcion: tomar("[itemprop='description'], div.box_detail, section"),
    };
  });
  console.log(JSON.stringify(resumen, null, 2));
}

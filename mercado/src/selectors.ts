/**
 * Libro de selectores de Computrabajo (Perú).
 *
 * IMPORTANTE: estos selectores son una BASE no verificada. El marcado de
 * Computrabajo cambia con frecuencia y sus clases están ofuscadas. Antes de usar
 * el scraper en serio, corre `--inspeccionar <url-de-un-aviso>` y ajusta las
 * listas de abajo contra el HTML real. Cada campo lleva varias alternativas: se
 * usa la primera que devuelva texto, así un cambio menor de maquetado no rompe todo.
 */

/** Base del portal de Perú. Configurable por si cambia el dominio o la ruta de búsqueda. */
export const PORTAL = {
  base: "https://pe.computrabajo.com",
  /** Ruta de búsqueda por palabra clave: /trabajo-de-<slug>. */
  rutaBusqueda: (slug: string): string => `/trabajo-de-${slug}`,
};

/** Selectores de la página de resultados (lista de avisos). */
export const LISTADO = {
  /** Enlaces a cada aviso individual dentro de la tarjeta de resultado. */
  enlaceAviso: [
    "article a.js-o-link",
    "article h2 a",
    "article a[href*='/ofertas-de-trabajo/']",
    "article a",
  ],
  /** Botón/enlace "Siguiente" de la paginación (para una ampliación futura; no se usa en la base). */
  siguientePagina: ["a[title='Siguiente']", "span.b_primary.w48.buildLink.cp"],
};

/** Selectores de la página de detalle de un aviso. */
export const DETALLE = {
  titulo: ["h1.fs24", "h1[itemprop='title']", "h1"],
  empresa: [
    "a.dIB.fs16.js-o-company",
    "[itemprop='hiringOrganization'] [itemprop='name']",
    "p.dFlex a.fs16",
    ".box_detail a.fs16",
  ],
  requerimiento: [
    "div.box_detail p.mbB",
    "div[itemprop='description']",
    "section.description",
    "div.box_detail",
  ],
};

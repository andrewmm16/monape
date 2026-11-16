/**
 * Datos públicos e institucionales de un aviso, SIN datos personales.
 * El objetivo es inteligencia de mercado (qué cargos, qué empresas, qué piden),
 * no construir listas de contacto. Por eso aquí no hay teléfono ni correo.
 */
export interface OfertaPublica {
  /** Dirección del aviso de la que se extrajo (clave natural para mapear a la BD interna). */
  url: string;
  /** Título del cargo, tal como lo publica la empresa. */
  titulo: string;
  /** Nombre de la empresa contratante (institucional, no una persona). */
  empresa: string;
  /** Texto limpio de funciones, requisitos y habilidades. */
  requerimiento: string;
}

/** Resultado de una corrida: lo extraído y los avisos que fallaron (para no perder la traza). */
export interface ResultadoScraping {
  palabraClave: string;
  fecha: string;
  total: number;
  ofertas: OfertaPublica[];
  fallidos: { url: string; error: string }[];
}

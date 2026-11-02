import { PORTAL_SLUGS, type PortalSlug } from "./model";
import { SITES } from "./sites";
import { COSMETICOS, type Variant } from "./variants";

/**
 * Catálogo de cambios que el MUTADOR puede aplicar a un portal ficticio para
 * entrenar al robot. Los estructurales rompen de verdad algún selector o paso del
 * adaptador de ese portal (el robot debe detectarlos); los cosméticos solo cambian
 * el aspecto (el robot no debe notarlos).
 */
export type TipoMutacion = "estructural" | "cosmetica";

/** Paso del robot que debe notar el cambio. */
export type PasoRobot = "healthCheck" | "publish" | "retirar" | "postulantes" | "cv";

export interface Mutacion {
  id: string;
  tipo: TipoMutacion;
  descripcion: string;
  /** Portales a los que aplica (solo donde el cambio tiene sentido y rompe algo). */
  portales: readonly PortalSlug[];
  /** Qué paso del robot debe notarlo en ese portal (vacío en los cosméticos). */
  esperado(portal: PortalSlug): PasoRobot[];
  /** Cambio que se suma a la variante del portal. */
  variante(portal: PortalSlug): Variant;
}

const TODOS = PORTAL_SLUGS;
/** Portales con asistente de varios pasos. */
const CON_ASISTENTE = ["linkedin", "bumeran"] as const;

const estructural = (m: Omit<Mutacion, "tipo">): Mutacion => ({ ...m, tipo: "estructural" });

const COSMETICAS: Record<(typeof COSMETICOS)[number], string> = {
  colores: "Cambian los colores del encabezado, los botones y las tarjetas.",
  tamanos: "Cambian los tamaños de letra, de los campos y de los botones.",
  tipografia: "Cambia la tipografía (de sans-serif a serif).",
  espaciado: "Cambia el espaciado de tarjetas y campos.",
  orden_visual: "Cambia el orden visual de los botones y del menú (solo CSS, sin tocar el HTML).",
};

export const MUTACIONES: readonly Mutacion[] = [
  estructural({
    id: "renombrar_campo",
    descripcion: "El campo del título del puesto cambia de name e id.",
    portales: TODOS,
    esperado: () => ["healthCheck", "publish"],
    variante: (portal) => ({ renombrar: [SITES[portal].map.title] }),
  }),
  estructural({
    id: "texto_boton",
    descripcion: "El botón de retirar cambia de texto («Finalizar oferta») y el estado «cerrado» pasa a decir «Finalizado».",
    portales: TODOS.filter((portal) => portal !== "trabajos-diarios"),
    // La prueba de estructura lo nota solo si hay una oferta activa (mira el texto del botón sin pulsarlo).
    esperado: () => ["healthCheck", "retirar"],
    variante: () => ({ textosCambiados: true }),
  }),
  estructural({
    id: "boton_en_menu",
    descripcion: "Los botones del formulario (siguiente / publicar) pasan a un menú «Más acciones» que hay que abrir.",
    portales: TODOS,
    esperado: () => ["healthCheck", "publish"],
    variante: () => ({ botonEnMenu: true }),
  }),
  estructural({
    id: "paso_extra",
    descripcion: "El asistente agrega un paso nuevo («Verificación del aviso») entre el primero y el segundo.",
    portales: CON_ASISTENTE,
    esperado: () => ["healthCheck", "publish"],
    variante: () => ({ pasoExtra: true }),
  }),
  estructural({
    id: "reordenar_pasos",
    descripcion: "Los pasos 2 y 3 del asistente intercambian su lugar.",
    portales: CON_ASISTENTE,
    esperado: () => ["healthCheck", "publish"],
    variante: () => ({ reordenarPasos: true }),
  }),
  estructural({
    id: "campo_obligatorio",
    descripcion: "El primer paso del formulario pide un campo nuevo y obligatorio («Código interno del aviso»).",
    portales: TODOS,
    esperado: () => ["healthCheck", "publish"],
    variante: () => ({ campoObligatorio: true }),
  }),
  estructural({
    id: "campo_a_lista",
    descripcion: "El campo de la ubicación deja de ser texto libre y pasa a ser una lista desplegable.",
    portales: TODOS,
    esperado: () => ["healthCheck", "publish"],
    variante: (portal) => ({ camposALista: [SITES[portal].map.location] }),
  }),
  estructural({
    id: "aviso_cookies",
    descripcion: "Una ventana de cookies tapa el formulario de publicar hasta que se acepta.",
    portales: TODOS,
    esperado: () => ["healthCheck", "publish"],
    variante: () => ({ avisoCookies: true }),
  }),
  estructural({
    id: "paginacion_postulantes",
    descripcion: "La lista de postulantes se pagina (5 por página) y cambia sus marcas. Con una oferta publicada, la prueba de estructura ya lo nota.",
    portales: TODOS,
    esperado: () => ["healthCheck", "postulantes"],
    variante: () => ({ paginarPostulantes: true }),
  }),
  estructural({
    id: "enlace_cv",
    descripcion: "El enlace de descarga del CV pasa a ser un botón con JavaScript. Se nota al traer postulantes nuevos; la prueba de estructura lo ve si hay una oferta con postulantes.",
    portales: TODOS,
    esperado: () => ["healthCheck", "cv"],
    variante: () => ({ enlaceCv: true }),
  }),
  ...COSMETICOS.map(
    (id): Mutacion => ({
      id: `cosmetico_${id}`,
      tipo: "cosmetica",
      descripcion: COSMETICAS[id],
      portales: TODOS,
      esperado: () => [],
      variante: () => ({ cosmetico: id }),
    }),
  ),
];

export const getMutacion = (id: string): Mutacion | undefined => MUTACIONES.find((m) => m.id === id);

export const mutacionesDe = (portal: PortalSlug, tipo?: TipoMutacion): Mutacion[] =>
  MUTACIONES.filter((m) => m.portales.includes(portal) && (!tipo || m.tipo === tipo));

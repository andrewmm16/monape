/**
 * Las acciones del robot no llevan persona (`actor_id` vacío), pero quien dio la
 * orden sí quedó registrada en la línea previa de la misma publicación
 * («solicitada» o «retiro»). Aquí se empareja cada acción del robot con ella.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const REQUEST_ACTIONS = ["publicacion_portal_solicitada", "publicacion_portal_retiro"] as const;
type RequestAction = (typeof REQUEST_ACTIONS)[number];

export type RobotEntry = {
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: unknown;
  created_at: string;
};

export type OrderRequest = { entity_id: string | null; action: string; actor_id: string | null; created_at: string };

function uuidOf(value: unknown): string | null {
  return typeof value === "string" && UUID.test(value) ? value : null;
}

/** Publicación y tipo de orden que explican una acción del robot; `null` si no aplica. */
export function orderRef(entry: RobotEntry): { publicationId: string; actions: readonly RequestAction[] } | null {
  if (entry.actor_id !== null) return null;
  if (entry.entity_type === "portal_publications") {
    const publicationId = uuidOf(entry.entity_id);
    if (!publicationId) return null;
    if (entry.action === "publicacion_portal_retirada") return { publicationId, actions: ["publicacion_portal_retiro"] };
    if (entry.action === "publicacion_portal_error") return { publicationId, actions: REQUEST_ACTIONS };
    return { publicationId, actions: ["publicacion_portal_solicitada"] };
  }
  if (entry.action === "integracion_postulacion") {
    const metadata = entry.metadata;
    const raw =
      metadata !== null && typeof metadata === "object" && !Array.isArray(metadata)
        ? (metadata as Record<string, unknown>).publication_id
        : null;
    const publicationId = uuidOf(raw);
    return publicationId ? { publicationId, actions: ["publicacion_portal_solicitada"] } : null;
  }
  return null;
}

/** Persona que dio la orden: la más reciente de las órdenes anteriores a la acción del robot. */
export function pickRequester(entry: RobotEntry, requests: readonly OrderRequest[]): string | null {
  const ref = orderRef(entry);
  if (!ref) return null;
  const at = new Date(entry.created_at).getTime();
  let best: { actorId: string; time: number } | null = null;
  for (const request of requests) {
    if (request.entity_id !== ref.publicationId || !request.actor_id) continue;
    if (!(ref.actions as readonly string[]).includes(request.action)) continue;
    const time = new Date(request.created_at).getTime();
    if (time > at) continue;
    if (!best || time > best.time) best = { actorId: request.actor_id, time };
  }
  return best?.actorId ?? null;
}

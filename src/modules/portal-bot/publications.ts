import "server-only";
import { z } from "zod";
import { logServerError } from "@/lib/errors";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { httpStatusOf, json, rejectUnlessBot, resolvePortalId } from "./auth";

const portalBody = z.object({ portal: z.string() });
const resultBody = z.object({
  outcome: z.enum(["publicada", "retirada", "error"]),
  externalId: z.string().trim().min(1).max(200).optional(),
  externalUrl: z.string().trim().max(500).optional(),
  errorCode: z.string().regex(/^[a-z0-9_]{1,64}$/).optional(),
});

async function readJson(request: Request): Promise<unknown> {
  try {
    return JSON.parse(await request.text());
  } catch {
    return undefined;
  }
}

/** POST /api/bot/publicaciones/siguiente: reserva el próximo trabajo del portal. */
export async function claimNextPublication(request: Request): Promise<Response> {
  const denied = rejectUnlessBot(request);
  if (denied) return denied;
  const body = portalBody.safeParse(await readJson(request));
  if (!body.success) return json(422, { error: "payload_invalido" });

  try {
    const admin = createSupabaseAdminClient();
    const portalId = await resolvePortalId(admin, body.data.portal);
    if (!portalId) return json(404, { error: "portal_no_encontrado" });
    const { data, error } = await admin.rpc("bot_claim_publication", { p_portal_id: portalId });
    if (error) throw error;
    const job = data?.[0];
    if (!job) return json(200, { job: null });
    return json(200, {
      job: { publicationId: job.publication_id, action: job.action, externalId: job.external_id, vacancy: job.vacancy },
    });
  } catch (error) {
    logServerError("bot.claim", error);
    return json(httpStatusOf(error), { error: "error_interno" });
  }
}

/** POST /api/bot/publicaciones/[id]/resultado: resultado de publicar o retirar. */
export async function reportPublication(request: Request, publicationId: string): Promise<Response> {
  const denied = rejectUnlessBot(request);
  if (denied) return denied;
  const body = resultBody.safeParse(await readJson(request));
  if (!body.success || !z.uuid().safeParse(publicationId).success) return json(422, { error: "payload_invalido" });
  const { outcome, externalId, externalUrl, errorCode } = body.data;
  if (outcome === "publicada" && (!externalId || !externalUrl)) return json(422, { error: "payload_invalido" });

  try {
    const { error } = await createSupabaseAdminClient().rpc("bot_report_publication", {
      p_publication_id: publicationId,
      p_outcome: outcome,
      p_external_id: externalId ?? null,
      p_external_url: externalUrl ?? null,
      p_error_code: errorCode ?? null,
    });
    if (error) throw error;
    return json(200, { status: "ok" });
  } catch (error) {
    logServerError("bot.report", error);
    const status = httpStatusOf(error);
    return json(status, { error: status === 500 ? "error_interno" : "solicitud_rechazada" });
  }
}

/** GET /api/bot/publicaciones/activas?portal=...: ofertas cuyos postulantes hay que revisar. */
export async function listActivePublications(request: Request): Promise<Response> {
  const denied = rejectUnlessBot(request);
  if (denied) return denied;

  try {
    const admin = createSupabaseAdminClient();
    const portalId = await resolvePortalId(admin, new URL(request.url).searchParams.get("portal"));
    if (!portalId) return json(404, { error: "portal_no_encontrado" });
    const { data, error } = await admin.rpc("bot_list_active_publications", { p_portal_id: portalId });
    if (error) throw error;
    return json(200, {
      publications: (data ?? []).map((row) => ({
        publicationId: row.publication_id,
        externalId: row.external_id,
        externalUrl: row.external_url,
        lastSyncedAt: row.last_synced_at,
      })),
    });
  } catch (error) {
    logServerError("bot.active", error);
    return json(httpStatusOf(error), { error: "error_interno" });
  }
}

/** POST /api/bot/publicaciones/[id]/sincronizada: el bot terminó de revisar los postulantes. */
export async function markPublicationSynced(request: Request, publicationId: string): Promise<Response> {
  const denied = rejectUnlessBot(request);
  if (denied) return denied;
  if (!z.uuid().safeParse(publicationId).success) return json(422, { error: "payload_invalido" });

  try {
    const { error } = await createSupabaseAdminClient().rpc("bot_mark_synced", { p_publication_id: publicationId });
    if (error) throw error;
    return json(200, { status: "ok" });
  } catch (error) {
    logServerError("bot.synced", error);
    return json(httpStatusOf(error), { error: "error_interno" });
  }
}

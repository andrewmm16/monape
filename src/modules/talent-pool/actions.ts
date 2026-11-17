"use server";

import { revalidatePath } from "next/cache";
import { parseInput, runAction, type ActionResult } from "@/lib/action-result";
import { requirePermission } from "@/lib/auth/session";
import { getServerEnv } from "@/lib/env";
import { AppError, toAppError } from "@/lib/errors";
import { createSupabaseServerClient, type AppSupabaseClient } from "@/lib/supabase/server";
import { getEditedTemplate, getEmailReplyTo } from "@/modules/email-templates/queries";
import { sendEmail } from "@/modules/notifications/email/client";
import { getEmailAvailability } from "@/modules/notifications/email/config";
import { buildTalentInvitationEmail } from "@/modules/notifications/email/templates/talent-invitation";
import { getPublicJobsConfig } from "@/modules/public-jobs/config";
import { publicVacancyUrl } from "@/modules/public-jobs/link";
import { consentByCandidate } from "./queries";
import {
  batchCandidateVacancySchema,
  candidateTagSchema,
  createTalentTagSchema,
  reactivateCandidateSchema,
  REPLY_TO_MISSING_MESSAGE,
  type BatchCandidateVacancyInput,
  type CandidateTagInput,
  type CreateTalentTagInput,
  type ReactivateCandidateInput,
} from "./schema";

/** Crea una etiqueta compartida del equipo. Devuelve su id. */
export async function createTalentTag(input: CreateTalentTagInput): Promise<ActionResult<{ id: string }>> {
  return runAction("talent.createTag", async () => {
    const user = await requirePermission("candidates:manage");
    const values = parseInput(createTalentTagSchema, input);
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("talent_tags")
      .insert({ name: values.name, color: values.color ?? null, created_by: user.id })
      .select("id")
      .single();
    if (error) throw toAppError(error);
    return { id: data.id };
  });
}

/** Asigna una etiqueta a un candidato. */
export async function assignTalentTag(input: CandidateTagInput): Promise<ActionResult> {
  return runAction("talent.assignTag", async () => {
    const user = await requirePermission("candidates:manage");
    const values = parseInput(candidateTagSchema, input);
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .from("candidate_tags")
      .insert({ candidate_id: values.candidateId, tag_id: values.tagId, assigned_by: user.id });
    if (error) throw toAppError(error);
    revalidatePath(`/candidatos/${values.candidateId}`);
    return null;
  });
}

/** Quita una etiqueta de un candidato. */
export async function removeTalentTag(input: CandidateTagInput): Promise<ActionResult> {
  return runAction("talent.removeTag", async () => {
    await requirePermission("candidates:manage");
    const values = parseInput(candidateTagSchema, input);
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .from("candidate_tags")
      .delete()
      .eq("candidate_id", values.candidateId)
      .eq("tag_id", values.tagId);
    if (error) throw toAppError(error);
    revalidatePath(`/candidatos/${values.candidateId}`);
    return null;
  });
}

/**
 * Reactiva un candidato del histórico en una vacante nueva (crea su postulación,
 * reutilizando el CV vigente). El RPC valida que no duplique ni rompa la regla de
 * "una postulación en proceso". Devuelve el id de la postulación creada.
 */
export async function reactivateCandidate(
  input: ReactivateCandidateInput,
): Promise<ActionResult<{ applicationId: string }>> {
  return runAction("talent.reactivate", async () => {
    await requirePermission("candidates:manage");
    const values = parseInput(reactivateCandidateSchema, input);
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("add_candidate_to_vacancy", {
      p_candidate_id: values.candidateId,
      p_vacancy_id: values.vacancyId,
    });
    if (error) throw toAppError(error);
    revalidatePath(`/candidatos/${values.candidateId}`);
    revalidatePath(`/vacantes/${values.vacancyId}`);
    return { applicationId: data as string };
  });
}

export type BatchAddResult = { added: number; failed: { candidateId: string; reason: string }[] };

type BatchAddRpcResult = { added?: string[]; failed?: { candidate_id: string; reason: string }[] };

/**
 * Reactiva en lote varios candidatos sugeridos a una vacante. La BD procesa cada
 * uno por separado (un fallo, p. ej. "ya en proceso", no corta el resto) y deja
 * una línea de resumen del lote en la auditoría.
 */
export async function addCandidatesToVacancy(
  input: BatchCandidateVacancyInput,
): Promise<ActionResult<BatchAddResult>> {
  return runAction("talent.addBatch", async () => {
    await requirePermission("candidates:manage");
    const values = parseInput(batchCandidateVacancySchema, input);
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("add_candidates_to_vacancy", {
      p_vacancy_id: values.vacancyId,
      p_candidate_ids: values.candidateIds,
    });
    if (error) throw toAppError(error);
    const result = (data ?? {}) as BatchAddRpcResult;
    revalidatePath(`/vacantes/${values.vacancyId}`);
    return {
      added: result.added?.length ?? 0,
      failed: (result.failed ?? []).map((item) => ({ candidateId: item.candidate_id, reason: item.reason })),
    };
  });
}

export type BatchInviteResult = {
  invited: number;
  skippedNoEmail: number;
  skippedRevoked: number;
  skippedAlreadyInvited: number;
  failed: number;
};

type InvitationOutcome = "enviada" | "sin_correo" | "consentimiento_revocado" | "error";

/**
 * Envía la invitación a una vacante a varios candidatos del pool (contacto previo,
 * antes de reactivarlos) y registra cada resultado en el historial de contacto.
 * Omite a quien ya fue invitado a esta misma vacante, a quien revocó el
 * consentimiento de cartera y a quien no tiene correo. El envío es real (Resend)
 * y nunca aborta el lote: los fallos de envío se registran como tales.
 */
export async function inviteCandidatesToVacancy(
  input: BatchCandidateVacancyInput,
): Promise<ActionResult<BatchInviteResult>> {
  return runAction("talent.inviteBatch", async () => {
    await requirePermission("candidates:manage");
    const values = parseInput(batchCandidateVacancySchema, input);
    // Si el correo está desactivado (modo de prueba o sin configurar) no se envía
    // ni se registra nada: el historial no se llena de falsos «falló el envío».
    const availability = getEmailAvailability();
    if (!availability.available) {
      throw new AppError(`No se pueden enviar invitaciones: ${availability.reason}.`, "unavailable");
    }
    const supabase = await createSupabaseServerClient();
    // La invitación pide responder: sin dirección de respuestas, nadie la recibiría.
    const replyTo = await getEmailReplyTo(supabase);
    if (!replyTo) throw new AppError(REPLY_TO_MISSING_MESSAGE, "conflict");

    const { data: vacancy, error: vacancyError } = await supabase
      .from("vacancies")
      .select("title, status, is_confidential, public_code, description, employment_type, modality, city, region, closing_date")
      .eq("id", values.vacancyId)
      .maybeSingle();
    if (vacancyError) throw toAppError(vacancyError);
    if (!vacancy) throw new AppError("La vacante no existe.", "not_found");

    const publicJobs = getPublicJobsConfig();
    const vacancyUrl = publicVacancyUrl(vacancy, publicJobs.enabled ? publicJobs.siteUrl : null);
    const template = await getEditedTemplate(supabase, "invitacion_cartera");
    const companyName = getServerEnv().PUBLIC_COMPANY_NAME;

    const [{ data: candidates, error: candError }, consent, alreadyInvited] = await Promise.all([
      supabase.from("candidates").select("id, full_name, email").in("id", values.candidateIds),
      consentByCandidate(supabase, values.candidateIds),
      invitedCandidateIds(supabase, values.vacancyId, values.candidateIds),
    ]);
    if (candError) throw toAppError(candError);

    const result: BatchInviteResult = {
      invited: 0,
      skippedNoEmail: 0,
      skippedRevoked: 0,
      skippedAlreadyInvited: 0,
      failed: 0,
    };
    const items: { candidate_id: string; outcome: InvitationOutcome }[] = [];
    for (const candidate of candidates ?? []) {
      if (alreadyInvited.has(candidate.id)) {
        result.skippedAlreadyInvited += 1;
        continue;
      }
      if (consent.get(candidate.id) === "revocado") {
        result.skippedRevoked += 1;
        items.push({ candidate_id: candidate.id, outcome: "consentimiento_revocado" });
        continue;
      }
      const email = candidate.email?.trim();
      if (!email) {
        result.skippedNoEmail += 1;
        items.push({ candidate_id: candidate.id, outcome: "sin_correo" });
        continue;
      }
      const content = buildTalentInvitationEmail({
        fullName: candidate.full_name,
        vacancyTitle: vacancy.title,
        companyName,
        vacancyUrl,
        template,
      });
      const sent = await sendEmail({
        to: email,
        subject: content.subject,
        html: content.html,
        text: content.text,
        tags: [{ name: "type", value: "talent_invitation" }],
        replyTo,
      });
      if (sent.sent) result.invited += 1;
      else result.failed += 1;
      items.push({ candidate_id: candidate.id, outcome: sent.sent ? "enviada" : "error" });
    }

    if (items.length > 0) {
      const { error } = await supabase.rpc("record_talent_invitations", {
        p_vacancy_id: values.vacancyId,
        p_items: items,
        p_already_invited: result.skippedAlreadyInvited,
      });
      if (error) {
        console.error("[talent.inviteBatch] no se pudo registrar el historial", error.code);
        throw new AppError(
          "Las invitaciones se procesaron, pero no se pudo guardar el historial de contacto. Avise al administrador.",
          "internal",
        );
      }
    }
    revalidatePath(`/vacantes/${values.vacancyId}`);
    return result;
  });
}

/** Candidatos que ya recibieron una invitación enviada para esta vacante. */
async function invitedCandidateIds(
  supabase: AppSupabaseClient,
  vacancyId: string,
  candidateIds: string[],
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("talent_invitations")
    .select("candidate_id")
    .eq("vacancy_id", vacancyId)
    .eq("outcome", "enviada")
    .in("candidate_id", candidateIds);
  if (error) throw toAppError(error);
  return new Set((data ?? []).map((row) => row.candidate_id));
}

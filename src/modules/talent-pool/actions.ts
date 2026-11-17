"use server";

import { revalidatePath } from "next/cache";
import { parseInput, runAction, type ActionResult } from "@/lib/action-result";
import { requirePermission } from "@/lib/auth/session";
import { AppError, toAppError } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { sendEmail } from "@/modules/notifications/email/client";
import { buildTalentInvitationEmail } from "@/modules/notifications/email/templates/talent-invitation";
import { consentByCandidate } from "./queries";
import {
  batchCandidateVacancySchema,
  candidateTagSchema,
  createTalentTagSchema,
  reactivateCandidateSchema,
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

/**
 * Reactiva en lote varios candidatos sugeridos a una vacante. Procesa uno por uno
 * y acumula los que no se pudieron (p. ej. "ya en proceso"), sin abortar el resto.
 */
export async function addCandidatesToVacancy(
  input: BatchCandidateVacancyInput,
): Promise<ActionResult<BatchAddResult>> {
  return runAction("talent.addBatch", async () => {
    await requirePermission("candidates:manage");
    const values = parseInput(batchCandidateVacancySchema, input);
    const supabase = await createSupabaseServerClient();
    let added = 0;
    const failed: { candidateId: string; reason: string }[] = [];
    for (const candidateId of values.candidateIds) {
      const { error } = await supabase.rpc("add_candidate_to_vacancy", {
        p_candidate_id: candidateId,
        p_vacancy_id: values.vacancyId,
      });
      if (error) failed.push({ candidateId, reason: toAppError(error).message });
      else added += 1;
    }
    revalidatePath(`/vacantes/${values.vacancyId}`);
    return { added, failed };
  });
}

export type BatchInviteResult = {
  invited: number;
  skippedNoEmail: number;
  skippedRevoked: number;
  failed: number;
};

/**
 * Envía la invitación a una vacante a varios candidatos del pool (contacto previo,
 * antes de reactivarlos). Respeta el consentimiento de cartera (omite a quien lo
 * revocó) y a quien no tiene correo. El envío es real (Resend) y nunca aborta el
 * lote: los fallos de envío se cuentan.
 */
export async function inviteCandidatesToVacancy(
  input: BatchCandidateVacancyInput,
): Promise<ActionResult<BatchInviteResult>> {
  return runAction("talent.inviteBatch", async () => {
    await requirePermission("candidates:manage");
    const values = parseInput(batchCandidateVacancySchema, input);
    const supabase = await createSupabaseServerClient();

    const { data: vacancy, error: vacancyError } = await supabase
      .from("vacancies")
      .select("title")
      .eq("id", values.vacancyId)
      .maybeSingle();
    if (vacancyError) throw toAppError(vacancyError);
    if (!vacancy) throw new AppError("La vacante no existe.", "not_found");

    const { data: candidates, error: candError } = await supabase
      .from("candidates")
      .select("id, full_name, email")
      .in("id", values.candidateIds);
    if (candError) throw toAppError(candError);
    const consent = await consentByCandidate(supabase, values.candidateIds);

    const result: BatchInviteResult = { invited: 0, skippedNoEmail: 0, skippedRevoked: 0, failed: 0 };
    for (const candidate of candidates ?? []) {
      if (consent.get(candidate.id) === "revocado") {
        result.skippedRevoked += 1;
        continue;
      }
      const email = candidate.email?.trim();
      if (!email) {
        result.skippedNoEmail += 1;
        continue;
      }
      const content = buildTalentInvitationEmail({ fullName: candidate.full_name, vacancyTitle: vacancy.title });
      const sent = await sendEmail({
        to: email,
        subject: content.subject,
        html: content.html,
        text: content.text,
        tags: [{ name: "type", value: "talent_invitation" }],
      });
      if (sent.sent) result.invited += 1;
      else result.failed += 1;
    }
    return result;
  });
}

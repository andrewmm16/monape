"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseInput, runAction, type ActionResult } from "@/lib/action-result";
import { requirePermission } from "@/lib/auth/session";
import { AppError, toAppError } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { activateNoticeSchema, noticeFormSchema, type ActivateNoticeInput, type NoticeFormInput } from "./schemas";

const PAGE = "/configuracion/privacidad";
const NOT_A_DRAFT = "El aviso no existe o ya no es un borrador.";

/** Crea un borrador. La versión la asigna la base de datos. */
export async function createNotice(input: NoticeFormInput): Promise<ActionResult<{ id: string }>> {
  return runAction(
    "privacy.create_notice",
    async () => {
      await requirePermission("privacy:manage");
      const values = parseInput(noticeFormSchema, input);
      const supabase = await createSupabaseServerClient();
      const { data, error } = await supabase
        .from("privacy_notices")
        .insert({ title: values.title, body: values.body })
        .select("id")
        .single();
      if (error) throw toAppError(error);
      revalidatePath(PAGE);
      return { id: data.id };
    },
    "Borrador creado.",
  );
}

export async function updateNotice(id: string, input: NoticeFormInput): Promise<ActionResult> {
  return runAction(
    "privacy.update_notice",
    async () => {
      await requirePermission("privacy:manage");
      const noticeId = parseInput(z.uuid(), id);
      const values = parseInput(noticeFormSchema, input);
      const supabase = await createSupabaseServerClient();
      const { data, error } = await supabase
        .from("privacy_notices")
        .update({ title: values.title, body: values.body })
        .eq("id", noticeId)
        .select("id");
      if (error) throw toAppError(error);
      if (!data.length) throw new AppError(NOT_A_DRAFT, "not_found");
      revalidatePath(PAGE);
      return null;
    },
    "Borrador guardado.",
  );
}

export async function deleteNotice(id: string): Promise<ActionResult> {
  return runAction(
    "privacy.delete_notice",
    async () => {
      await requirePermission("privacy:manage");
      const noticeId = parseInput(z.uuid(), id);
      const supabase = await createSupabaseServerClient();
      const { data, error } = await supabase.from("privacy_notices").delete().eq("id", noticeId).select("id");
      if (error) throw toAppError(error);
      if (!data.length) throw new AppError(NOT_A_DRAFT, "not_found");
      revalidatePath(PAGE);
      return null;
    },
    "Borrador eliminado.",
  );
}

/** Activa un borrador con la referencia de aprobación; retira la vigente. */
export async function activateNotice(id: string, input: ActivateNoticeInput): Promise<ActionResult> {
  return runAction(
    "privacy.activate_notice",
    async () => {
      await requirePermission("privacy:manage");
      const noticeId = parseInput(z.uuid(), id);
      const values = parseInput(activateNoticeSchema, input);
      const supabase = await createSupabaseServerClient();
      const { error } = await supabase.rpc("activate_privacy_notice", {
        p_id: noticeId,
        p_approval_reference: values.approvalReference,
      });
      if (error) throw toAppError(error);
      revalidatePath(PAGE);
      revalidatePath("/empleos/privacidad");
      return null;
    },
    "Aviso activado. Es la versión vigente.",
  );
}

/** Registra la revocación de la cartera de talento (no borra la constancia). */
export async function revokeConsent(consentId: string, candidateId: string): Promise<ActionResult> {
  return runAction(
    "privacy.revoke_consent",
    async () => {
      await requirePermission("candidates:manage");
      const id = parseInput(z.uuid(), consentId);
      const candidate = parseInput(z.uuid(), candidateId);
      const supabase = await createSupabaseServerClient();
      const { error } = await supabase.rpc("revoke_consent", { p_id: id });
      if (error) throw toAppError(error);
      revalidatePath(`/candidatos/${candidate}`);
      return null;
    },
    "Revocación registrada.",
  );
}

import "server-only";
import { toAppError } from "@/lib/errors";
import type { AppSupabaseClient } from "@/lib/supabase/server";
import { isEmailTemplateKey, type EmailTemplateContent, type EmailTemplateKey } from "./defaults";

export type EditedTemplate = EmailTemplateContent & { updatedAt: string | null };

/**
 * Versiones editadas por RRHH, por clave. Las claves sin fila no aparecen: la
 * interfaz y el envío usan el texto por defecto del código para ellas.
 */
export async function listEditedTemplates(
  supabase: AppSupabaseClient,
): Promise<Partial<Record<EmailTemplateKey, EditedTemplate>>> {
  const { data, error } = await supabase.from("email_templates").select("key, subject, body, updated_at");
  if (error) throw toAppError(error);
  const result: Partial<Record<EmailTemplateKey, EditedTemplate>> = {};
  for (const row of data ?? []) {
    if (isEmailTemplateKey(row.key)) result[row.key] = { subject: row.subject, body: row.body, updatedAt: row.updated_at };
  }
  return result;
}

/**
 * Dirección a la que llegan las respuestas de los candidatos (Reply-To), o
 * `null` si RRHH aún no la configuró.
 */
export async function getEmailReplyTo(supabase: AppSupabaseClient): Promise<string | null> {
  const { data, error } = await supabase.from("email_settings").select("reply_to").maybeSingle();
  if (error) throw toAppError(error);
  return data?.reply_to?.trim() || null;
}

/**
 * Plantilla editada de una clave, o `null` si no hay (se usa la del código).
 * Nunca lanza: un problema al leerla no debe impedir el envío con el texto base.
 */
export async function getEditedTemplate(
  supabase: AppSupabaseClient,
  key: EmailTemplateKey,
): Promise<EmailTemplateContent | null> {
  try {
    const { data, error } = await supabase.from("email_templates").select("subject, body").eq("key", key).maybeSingle();
    if (error || !data) return null;
    const subject = typeof data.subject === "string" ? data.subject.trim() : "";
    const body = typeof data.body === "string" ? data.body.trim() : "";
    if (!subject || !body) return null;
    return { subject, body };
  } catch {
    return null;
  }
}

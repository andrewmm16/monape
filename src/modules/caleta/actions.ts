"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseInput, runAction, type ActionResult } from "@/lib/action-result";
import { requirePermission } from "@/lib/auth/session";
import { AppError, toAppError } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Enums, Json } from "@/types/database";
import { scoreProfileForVacancy } from "./scoring";
import {
  prospectConnectedSchema,
  prospectContactedSchema,
  prospectContactSchema,
  prospectCreateSchema,
  prospectStatusSchema,
  type ProspectConnectedInput,
  type ProspectContactedInput,
  type ProspectContactInput,
  type ProspectCreateInput,
  type ProspectStatusInput,
} from "./schemas";

const CALETA_USE = "caleta:use" as const;
const CANDIDATES_MANAGE = "candidates:manage" as const;

function toCandidateSource(source: Enums<"caleta_source">): Enums<"candidate_source"> {
  if (source === "linkedin") return "linkedin";
  if (source === "referido") return "referido";
  return "otro";
}

/** Localiza un perfil, lo puntúa contra la vacante y lo guarda como prospecto. */
export async function createProspect(input: ProspectCreateInput): Promise<ActionResult<{ id: string }>> {
  return runAction(
    "caleta.create",
    async () => {
      await requirePermission(CALETA_USE);
      const values = parseInput(prospectCreateSchema, input);
      const supabase = await createSupabaseServerClient();

      const scored = await scoreProfileForVacancy(supabase, values.vacancyId, values.profileText);

      const origins: Record<string, string> = { full_name: "declarado" };
      if (values.email) origins.email = "declarado";
      if (values.phone) origins.phone = "declarado";

      const { data, error } = await supabase
        .from("caleta_prospects")
        .insert({
          vacancy_id: values.vacancyId,
          full_name: values.fullName,
          headline: values.headline,
          location: values.location,
          linkedin_url: values.linkedinUrl,
          source: values.source,
          source_detail: values.sourceDetail,
          profile_text: values.profileText,
          email: values.email,
          phone: values.phone,
          field_origins: origins as Json,
          score: scored.score,
          score_detail: scored.detail as unknown as Json,
          scoring_version: scored.scoringVersion,
          scored_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (error) throw toAppError(error);

      revalidatePath("/caleta");
      return { id: data.id };
    },
    "Prospecto agregado y puntuado.",
  );
}

/** Vuelve a puntuar el prospecto (p. ej. tras editar los requisitos de la vacante). */
export async function rescoreProspect(id: string): Promise<ActionResult> {
  return runAction(
    "caleta.rescore",
    async () => {
      await requirePermission(CALETA_USE);
      const prospectId = parseInput(z.uuid(), id);
      const supabase = await createSupabaseServerClient();

      const { data: prospect, error } = await supabase
        .from("caleta_prospects")
        .select("vacancy_id, profile_text")
        .eq("id", prospectId)
        .maybeSingle();
      if (error) throw toAppError(error);
      if (!prospect) throw new AppError("El prospecto no existe o no tiene acceso.", "not_found");
      if (!prospect.profile_text) {
        throw new AppError("El prospecto no tiene texto de perfil para puntuar.", "conflict");
      }

      const scored = await scoreProfileForVacancy(supabase, prospect.vacancy_id, prospect.profile_text);
      const { error: updateError } = await supabase
        .from("caleta_prospects")
        .update({
          score: scored.score,
          score_detail: scored.detail as unknown as Json,
          scoring_version: scored.scoringVersion,
          scored_at: new Date().toISOString(),
        })
        .eq("id", prospectId);
      if (updateError) throw toAppError(updateError);

      revalidatePath("/caleta");
      return null;
    },
    "Prospecto vuelto a puntuar.",
  );
}

/** Guarda el teléfono/correo capturado en el contacto (dato declarado por la persona). */
export async function updateProspectContact(input: ProspectContactInput): Promise<ActionResult> {
  return runAction(
    "caleta.contact",
    async () => {
      await requirePermission(CALETA_USE);
      const values = parseInput(prospectContactSchema, input);
      const supabase = await createSupabaseServerClient();

      const { data: current, error } = await supabase
        .from("caleta_prospects")
        .select("field_origins")
        .eq("id", values.id)
        .maybeSingle();
      if (error) throw toAppError(error);
      if (!current) throw new AppError("El prospecto no existe o no tiene acceso.", "not_found");

      const origins: Record<string, string> = { ...((current.field_origins as Record<string, string>) ?? {}) };
      if (values.phone) origins.phone = "declarado";
      else delete origins.phone;
      if (values.email) origins.email = "declarado";
      else delete origins.email;

      const { error: updateError } = await supabase
        .from("caleta_prospects")
        .update({ phone: values.phone, email: values.email, field_origins: origins as Json })
        .eq("id", values.id);
      if (updateError) throw toAppError(updateError);

      revalidatePath("/caleta");
      return null;
    },
    "Datos de contacto guardados.",
  );
}

/**
 * Registra el primer contacto saliente (canal + fecha + mensaje enviado) y, si
 * el prospecto seguía en «encontrado», lo pasa a «contactado». Así queda mapeado
 * a quién se escribió, por dónde y cuándo, sin enviar nada en frío de forma
 * automática: el envío lo hace la persona al abrir el perfil.
 */
export async function markProspectContacted(input: ProspectContactedInput): Promise<ActionResult> {
  return runAction(
    "caleta.contacted",
    async () => {
      await requirePermission(CALETA_USE);
      const values = parseInput(prospectContactedSchema, input);
      const supabase = await createSupabaseServerClient();

      const { data: current, error } = await supabase
        .from("caleta_prospects")
        .select("status")
        .eq("id", values.id)
        .maybeSingle();
      if (error) throw toAppError(error);
      if (!current) throw new AppError("El prospecto no existe o no tiene acceso.", "not_found");

      const patch: {
        contact_channel: Enums<"caleta_contact_channel">;
        contacted_at: string;
        outreach_message: string | null;
        status?: Enums<"caleta_status">;
      } = {
        contact_channel: values.channel,
        contacted_at: new Date().toISOString(),
        outreach_message: values.message,
      };
      // Solo avanza el embudo en el primer contacto; no pisa respondió/interesado.
      if (current.status === "encontrado") patch.status = "contactado";

      const { error: updateError } = await supabase
        .from("caleta_prospects")
        .update(patch)
        .eq("id", values.id);
      if (updateError) throw toAppError(updateError);

      revalidatePath("/caleta");
      return null;
    },
    "Contacto registrado.",
  );
}

/**
 * La persona aceptó la invitación de LinkedIn: pasa a «conectado» y guarda el
 * mensaje directo que se le envía (ya gratis, por ser contacto). No retrocede a
 * quien ya respondió o mostró interés.
 */
export async function markProspectConnected(input: ProspectConnectedInput): Promise<ActionResult> {
  return runAction(
    "caleta.connected",
    async () => {
      await requirePermission(CALETA_USE);
      const values = parseInput(prospectConnectedSchema, input);
      const supabase = await createSupabaseServerClient();

      const { data: current, error } = await supabase
        .from("caleta_prospects")
        .select("status, contacted_at")
        .eq("id", values.id)
        .maybeSingle();
      if (error) throw toAppError(error);
      if (!current) throw new AppError("El prospecto no existe o no tiene acceso.", "not_found");

      const patch: {
        outreach_message: string | null;
        status?: Enums<"caleta_status">;
        contact_channel?: Enums<"caleta_contact_channel">;
        contacted_at?: string;
      } = { outreach_message: values.message };
      if (current.status === "encontrado" || current.status === "contactado") patch.status = "conectado";
      // Si nunca se registró la invitación (se conectó por fuera del panel), se registra ahora.
      if (!current.contacted_at) {
        patch.contact_channel = "linkedin";
        patch.contacted_at = new Date().toISOString();
      }

      const { error: updateError } = await supabase
        .from("caleta_prospects")
        .update(patch)
        .eq("id", values.id);
      if (updateError) throw toAppError(updateError);

      revalidatePath("/caleta");
      return null;
    },
    "Marcado como conectado.",
  );
}

/** Avanza el prospecto en el embudo de contacto (sin incluir «derivado»). */
export async function changeProspectStatus(input: ProspectStatusInput): Promise<ActionResult> {
  return runAction(
    "caleta.status",
    async () => {
      await requirePermission(CALETA_USE);
      const values = parseInput(prospectStatusSchema, input);
      const supabase = await createSupabaseServerClient();

      const patch: { status: Enums<"caleta_status">; notes?: string } = { status: values.status };
      if (values.notes) patch.notes = values.notes;

      const { data, error } = await supabase
        .from("caleta_prospects")
        .update(patch)
        .eq("id", values.id)
        .select("id");
      if (error) throw toAppError(error);
      if (!data.length) throw new AppError("El prospecto no existe o no tiene acceso.", "not_found");

      revalidatePath("/caleta");
      return null;
    },
    "Estado del prospecto actualizado.",
  );
}

/**
 * Deriva el prospecto al flujo normal: crea un candidato (con origen declarado) y
 * su postulación a la vacante, y marca el prospecto como «derivado».
 */
export async function deriveProspect(id: string): Promise<ActionResult<{ candidateId: string }>> {
  return runAction(
    "caleta.derive",
    async () => {
      await requirePermission(CANDIDATES_MANAGE);
      const prospectId = parseInput(z.uuid(), id);
      const supabase = await createSupabaseServerClient();

      const { data: prospect, error } = await supabase
        .from("caleta_prospects")
        .select("full_name, email, phone, location, linkedin_url, source, vacancy_id, candidate_id")
        .eq("id", prospectId)
        .maybeSingle();
      if (error) throw toAppError(error);
      if (!prospect) throw new AppError("El prospecto no existe o no tiene acceso.", "not_found");
      if (prospect.candidate_id) throw new AppError("Este prospecto ya fue derivado a un candidato.", "conflict");

      const origins: Record<string, string> = { full_name: "declarado" };
      if (prospect.email) origins.email = "declarado";
      if (prospect.phone) origins.phone = "declarado";

      const { data: candidate, error: candidateError } = await supabase
        .from("candidates")
        .insert({
          full_name: prospect.full_name,
          email: prospect.email,
          phone: prospect.phone,
          location: prospect.location,
          linkedin_url: prospect.linkedin_url,
          source: toCandidateSource(prospect.source),
          source_detail: "Reclutador Caleta",
          field_origins: origins as Json,
        })
        .select("id")
        .single();
      if (candidateError) throw toAppError(candidateError);

      const { error: applicationError } = await supabase
        .from("applications")
        .insert({ candidate_id: candidate.id, vacancy_id: prospect.vacancy_id });
      if (applicationError) throw toAppError(applicationError);

      const { error: updateError } = await supabase
        .from("caleta_prospects")
        .update({ candidate_id: candidate.id, status: "derivado" })
        .eq("id", prospectId);
      if (updateError) throw toAppError(updateError);

      revalidatePath("/caleta");
      revalidatePath("/candidatos");
      return { candidateId: candidate.id };
    },
    "Prospecto derivado: se creó el candidato y su postulación a la vacante.",
  );
}

/** Elimina un prospecto. La política RLS restringe la eliminación a administradores. */
export async function deleteProspect(id: string): Promise<ActionResult> {
  return runAction(
    "caleta.delete",
    async () => {
      await requirePermission(CANDIDATES_MANAGE);
      const prospectId = parseInput(z.uuid(), id);
      const supabase = await createSupabaseServerClient();
      const { data, error } = await supabase.from("caleta_prospects").delete().eq("id", prospectId).select("id");
      if (error) throw toAppError(error);
      if (!data.length) throw new AppError("Solo un administrador puede eliminar prospectos.", "forbidden");
      revalidatePath("/caleta");
      return null;
    },
    "Prospecto eliminado.",
  );
}

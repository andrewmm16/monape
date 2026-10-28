"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseInput, runAction, type ActionResult } from "@/lib/action-result";
import { requirePermission } from "@/lib/auth/session";
import { AppError, toAppError } from "@/lib/errors";
import { createSupabaseServerClient, type AppSupabaseClient } from "@/lib/supabase/server";
import type { Json, TablesUpdate } from "@/types/database";
import { findDuplicates } from "./queries";
import {
  candidateFormSchema,
  createCandidateSchema,
  profileItemSchema,
  TRACKED_FIELDS,
  type CandidateFormInput,
  type CreateCandidateInput,
  type ProfileItemInput,
  type TrackedField,
} from "./schemas";

type OriginMap = Partial<Record<TrackedField, "declarado" | "extraido" | "verificado">>;

export type DuplicateMatch = { id: string; full_name: string; match_reasons: string[] };

export type CreateCandidateResult =
  | { status: "created"; id: string }
  | { status: "duplicates"; duplicates: DuplicateMatch[] };

function readOrigins(value: Json): OriginMap {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as OriginMap) : {};
}

export async function createCandidate(input: CreateCandidateInput): Promise<ActionResult<CreateCandidateResult>> {
  return runAction("candidates.create", async () => {
    await requirePermission("candidates:manage");
    const values = parseInput(createCandidateSchema, input);
    const supabase = await createSupabaseServerClient();

    if (!values.confirmDuplicate) {
      const duplicates = await findDuplicates(supabase, values);
      if (duplicates.length > 0) {
        return {
          status: "duplicates" as const,
          duplicates: duplicates.map((d) => ({ id: d.id!, full_name: d.full_name ?? "", match_reasons: d.match_reasons ?? [] })),
        };
      }
    }

    // Los datos ingresados por RRHH a partir de la postulación se registran
    // como "declarados" por el candidato.
    const origins: OriginMap = {};
    for (const [field, value] of [
      ["full_name", values.fullName],
      ["email", values.email],
      ["phone", values.phone],
      ["location", values.location],
      ["linkedin_url", values.linkedinUrl],
    ] as const) {
      if (value) origins[field] = "declarado";
    }

    const { data, error } = await supabase
      .from("candidates")
      .insert({
        full_name: values.fullName,
        email: values.email,
        phone: values.phone,
        location: values.location,
        linkedin_url: values.linkedinUrl,
        source: values.source,
        source_detail: values.sourceDetail,
        field_origins: origins,
      })
      .select("id")
      .single();
    if (error) throw toAppError(error);

    if (values.vacancyId) {
      const { error: applicationError } = await supabase
        .from("applications")
        .insert({ candidate_id: data.id, vacancy_id: values.vacancyId });
      if (applicationError) {
        throw new AppError(
          `El candidato se registró, pero no se pudo asociar a la vacante: ${toAppError(applicationError).message}`,
          "conflict",
        );
      }
    }
    revalidatePath("/candidatos");
    return { status: "created" as const, id: data.id };
  });
}

export async function updateCandidate(id: string, input: CandidateFormInput): Promise<ActionResult> {
  return runAction(
    "candidates.update",
    async () => {
      await requirePermission("candidates:manage");
      const candidateId = parseInput(z.uuid(), id);
      const values = parseInput(candidateFormSchema, input);
      const supabase = await createSupabaseServerClient();
      const { data: current, error } = await supabase
        .from("candidates")
        .select("full_name, email, phone, location, linkedin_url, field_origins")
        .eq("id", candidateId)
        .maybeSingle();
      if (error) throw toAppError(error);
      if (!current) throw new AppError("El candidato no existe o no tiene acceso.", "not_found");

      const next = {
        full_name: values.fullName,
        email: values.email,
        phone: values.phone,
        location: values.location,
        linkedin_url: values.linkedinUrl,
      };
      // Un valor modificado manualmente deja de considerarse extraído o verificado.
      const origins = readOrigins(current.field_origins);
      for (const field of TRACKED_FIELDS) {
        if (next[field] !== current[field]) {
          if (next[field]) origins[field] = "declarado";
          else delete origins[field];
        }
      }

      const { error: updateError } = await supabase
        .from("candidates")
        .update({ ...next, source: values.source, source_detail: values.sourceDetail, field_origins: origins })
        .eq("id", candidateId);
      if (updateError) throw toAppError(updateError);
      revalidatePath(`/candidatos/${candidateId}`);
      return null;
    },
    "Datos del candidato actualizados.",
  );
}

async function setFieldOrigin(
  supabase: AppSupabaseClient,
  candidateId: string,
  field: TrackedField,
  origin: "extraido" | "verificado",
  value?: string,
) {
  const { data: current, error } = await supabase
    .from("candidates")
    .select("field_origins")
    .eq("id", candidateId)
    .maybeSingle();
  if (error) throw toAppError(error);
  if (!current) throw new AppError("El candidato no existe o no tiene acceso.", "not_found");
  const origins = readOrigins(current.field_origins);
  origins[field] = origin;
  const patch: TablesUpdate<"candidates"> = { field_origins: origins };
  if (value !== undefined) patch[field] = value;
  const { error: updateError } = await supabase.from("candidates").update(patch).eq("id", candidateId);
  if (updateError) throw toAppError(updateError);
}

const fieldSchema = z.enum(TRACKED_FIELDS);

/** RRHH confirma que verificó un dato del candidato. */
export async function verifyCandidateField(candidateId: string, field: string): Promise<ActionResult> {
  return runAction(
    "candidates.verify_field",
    async () => {
      await requirePermission("candidates:manage");
      const id = parseInput(z.uuid(), candidateId);
      const trackedField = parseInput(fieldSchema, field);
      const supabase = await createSupabaseServerClient();
      await setFieldOrigin(supabase, id, trackedField, "verificado");
      revalidatePath(`/candidatos/${id}`);
      return null;
    },
    "Dato marcado como verificado.",
  );
}

/** Aplica a la ficha un dato sugerido por la extracción (solo si figura en ella). */
export async function applySuggestedField(
  candidateId: string,
  extractionId: string,
  field: string,
): Promise<ActionResult> {
  return runAction(
    "candidates.apply_suggestion",
    async () => {
      await requirePermission("candidates:manage");
      const id = parseInput(z.uuid(), candidateId);
      const extraction = parseInput(z.uuid(), extractionId);
      const trackedField = parseInput(z.enum(["email", "phone", "linkedin_url"]), field);
      const supabase = await createSupabaseServerClient();

      const { data, error } = await supabase
        .from("resume_extractions")
        .select("suggested_fields, resumes!inner(candidate_id)")
        .eq("id", extraction)
        .maybeSingle();
      if (error) throw toAppError(error);
      if (!data || data.resumes.candidate_id !== id) throw new AppError("La extracción no corresponde al candidato.", "not_found");

      const suggestions = data.suggested_fields as Record<string, { value?: unknown } | undefined>;
      const value = suggestions[trackedField]?.value;
      if (typeof value !== "string" || value.length === 0) throw new AppError("No hay un valor sugerido para ese campo.", "validation");

      const validated = parseInput(candidateFormSchema.shape[trackedField === "linkedin_url" ? "linkedinUrl" : trackedField], value);
      await setFieldOrigin(supabase, id, trackedField, "extraido", validated ?? undefined);
      revalidatePath(`/candidatos/${id}`);
      return null;
    },
    "Dato aplicado desde el CV. Verifíquelo antes de usarlo en comunicaciones.",
  );
}

// --- Perfil profesional -------------------------------------------------------

export async function addProfileItem(
  candidateId: string,
  input: ProfileItemInput,
  sourceResumeId?: string,
): Promise<ActionResult> {
  return runAction(
    "candidates.profile_item.add",
    async () => {
      await requirePermission("candidates:manage");
      const id = parseInput(z.uuid(), candidateId);
      const values = parseInput(profileItemSchema, input);
      const resumeId = sourceResumeId ? parseInput(z.uuid(), sourceResumeId) : null;
      const supabase = await createSupabaseServerClient();
      const { error } = await supabase.from("candidate_profile_items").insert({
        candidate_id: id,
        kind: values.kind,
        title: values.title,
        organization: values.organization,
        start_date: values.startDate,
        end_date: values.endDate,
        description: values.description,
        origin: values.origin,
        source_resume_id: resumeId,
      });
      if (error) throw toAppError(error);
      revalidatePath(`/candidatos/${id}`);
      return null;
    },
    "Registro agregado al perfil.",
  );
}

export async function verifyProfileItem(candidateId: string, itemId: string): Promise<ActionResult> {
  return runAction(
    "candidates.profile_item.verify",
    async () => {
      await requirePermission("candidates:manage");
      const id = parseInput(z.uuid(), itemId);
      const candidate = parseInput(z.uuid(), candidateId);
      const supabase = await createSupabaseServerClient();
      const { data, error } = await supabase
        .from("candidate_profile_items")
        .update({ origin: "verificado" })
        .eq("id", id)
        .eq("candidate_id", candidate)
        .select("id");
      if (error) throw toAppError(error);
      if (!data.length) throw new AppError("Registro no encontrado.", "not_found");
      revalidatePath(`/candidatos/${candidate}`);
      return null;
    },
    "Registro verificado.",
  );
}

export async function deleteProfileItem(candidateId: string, itemId: string): Promise<ActionResult> {
  return runAction(
    "candidates.profile_item.delete",
    async () => {
      await requirePermission("candidates:manage");
      const id = parseInput(z.uuid(), itemId);
      const candidate = parseInput(z.uuid(), candidateId);
      const supabase = await createSupabaseServerClient();
      const { error } = await supabase.from("candidate_profile_items").delete().eq("id", id).eq("candidate_id", candidate);
      if (error) throw toAppError(error);
      revalidatePath(`/candidatos/${candidate}`);
      return null;
    },
    "Registro eliminado.",
  );
}

// --- Postulaciones ------------------------------------------------------------

export async function addApplication(candidateId: string, vacancyId: string): Promise<ActionResult<{ id: string }>> {
  return runAction(
    "applications.create",
    async () => {
      await requirePermission("applications:manage");
      const values = parseInput(z.object({ candidateId: z.uuid(), vacancyId: z.uuid() }), { candidateId, vacancyId });
      const supabase = await createSupabaseServerClient();
      const { data: resume } = await supabase
        .from("resumes")
        .select("id")
        .eq("candidate_id", values.candidateId)
        .eq("is_current", true)
        .maybeSingle();
      const { data, error } = await supabase
        .from("applications")
        .insert({ candidate_id: values.candidateId, vacancy_id: values.vacancyId, resume_id: resume?.id ?? null })
        .select("id")
        .single();
      if (error) throw toAppError(error, { conflict: "El candidato ya postula a esa vacante." });
      revalidatePath(`/candidatos/${values.candidateId}`);
      revalidatePath(`/vacantes/${values.vacancyId}`);
      return { id: data.id };
    },
    "Postulación registrada.",
  );
}

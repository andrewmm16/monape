"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { parseInput, runAction, type ActionResult } from "@/lib/action-result";
import { requirePermission } from "@/lib/auth/session";
import { AppError, toAppError } from "@/lib/errors";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { applyPortalSelection } from "@/modules/portals/actions";
import { RESUMES_BUCKET } from "@/modules/resumes/storage";
import {
  canTransitionVacancy,
  killerQuestionFormSchema,
  publishBlockers,
  requirementFormSchema,
  vacancyFormSchema,
  vacancyStatusSchema,
  type KillerQuestionFormInput,
  type RequirementFormInput,
  type VacancyFormInput,
} from "./schemas";

function toRow(values: z.output<typeof vacancyFormSchema>) {
  return {
    title: values.title,
    department: values.department,
    description: values.description,
    responsibilities: values.responsibilities,
    location: values.location,
    modality: values.modality,
    opening_date: values.openingDate,
    closing_date: values.closingDate,
    owner_id: values.ownerId,
    city: values.city,
    region: values.region,
    employment_type: values.employmentType,
    salary_min: values.salaryMin,
    salary_max: values.salaryMax,
    salary_currency: values.salaryCurrency,
    salary_period: values.salaryPeriod,
    is_confidential: values.isConfidential,
  };
}

export async function createVacancy(input: VacancyFormInput): Promise<ActionResult<{ id: string }>> {
  return runAction(
    "vacancies.create",
    async () => {
      await requirePermission("vacancies:manage");
      const values = parseInput(vacancyFormSchema, input);
      const supabase = await createSupabaseServerClient();
      const { data, error } = await supabase.from("vacancies").insert(toRow(values)).select("id").single();
      if (error) throw toAppError(error);
      revalidatePath("/vacantes");
      return { id: data.id };
    },
    "Vacante creada en borrador. Defina y apruebe los requisitos antes de evaluar candidatos.",
  );
}

export async function updateVacancy(id: string, input: VacancyFormInput): Promise<ActionResult> {
  return runAction(
    "vacancies.update",
    async () => {
      await requirePermission("vacancies:manage");
      const vacancyId = parseInput(z.uuid(), id);
      const values = parseInput(vacancyFormSchema, input);
      const supabase = await createSupabaseServerClient();
      const { data, error } = await supabase.from("vacancies").update(toRow(values)).eq("id", vacancyId).select("id");
      if (error) throw toAppError(error);
      if (!data.length) throw new AppError("La vacante no existe o no tiene acceso.", "not_found");
      revalidatePath(`/vacantes/${vacancyId}`);
      return null;
    },
    "Vacante actualizada.",
  );
}

/** Cambia el estado de la vacante. Para publicarla exige requisitos cargados y criterios aprobados. */
async function setVacancyStatus(vacancyId: string, status: string): Promise<void> {
  await requirePermission("vacancies:manage");
  const id = parseInput(z.uuid(), vacancyId);
  const next = parseInput(vacancyStatusSchema, status);
  const supabase = await createSupabaseServerClient();
  const { data: current, error } = await supabase
    .from("vacancies")
    .select("status, criteria_approved_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw toAppError(error);
  if (!current) throw new AppError("La vacante no existe o no tiene acceso.", "not_found");
  if (!canTransitionVacancy(current.status, next)) {
    throw new AppError("Ese cambio de estado no está permitido para la vacante.", "conflict");
  }
  if (next === "publicada") {
    const { count, error: countError } = await supabase
      .from("vacancy_requirements")
      .select("id", { count: "exact", head: true })
      .eq("vacancy_id", id);
    if (countError) throw toAppError(countError);
    const blockers = publishBlockers({ requirementCount: count ?? 0, criteriaApproved: Boolean(current.criteria_approved_at) });
    if (blockers.length > 0) throw new AppError(`No se puede publicar todavía. ${blockers.join(" ")}`, "conflict");
  }
  const { error: updateError } = await supabase.from("vacancies").update({ status: next }).eq("id", id);
  if (updateError) throw toAppError(updateError);
  revalidatePath(`/vacantes/${id}`);
  revalidatePath("/vacantes");
}

export async function changeVacancyStatus(id: string, status: string): Promise<ActionResult> {
  return runAction("vacancies.status", async () => {
    await setVacancyStatus(id, status);
    return null;
  }, "Estado de la vacante actualizado.");
}

/** Publica la vacante y, en el mismo paso, pide su publicación en los portales elegidos. */
export async function publishVacancy(id: string, portalIds: string[]): Promise<ActionResult> {
  const published = await runAction("vacancies.publish", async () => {
    await setVacancyStatus(id, "publicada");
    return null;
  });
  if (!published.ok || portalIds.length === 0) {
    return published.ok ? { ...published, message: "Estado de la vacante actualizado." } : published;
  }
  const portals = await applyPortalSelection(id, portalIds, []);
  if (!portals.ok) {
    return { ok: true, data: null, message: `Vacante publicada, pero no se pudo pedir la publicación en portales: ${portals.error} Reintente desde la pestaña Portales.` };
  }
  return { ok: true, data: null, message: `Vacante publicada. ${portals.message ?? ""}`.trim() };
}

export async function deleteVacancy(id: string): Promise<ActionResult> {
  return runAction("vacancies.delete", async () => {
    await requirePermission("vacancies:delete");
    const vacancyId = parseInput(z.uuid(), id);
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.from("vacancies").delete().eq("id", vacancyId).select("id");
    if (error) throw toAppError(error);
    if (!data.length) throw new AppError("Solo pueden eliminarse vacantes en borrador o archivadas sin postulaciones.", "conflict");
    revalidatePath("/vacantes");
    redirect("/vacantes");
  });
}

/**
 * Borrado en cascada de una vacante ARCHIVADA: elimina la vacante, sus
 * postulaciones y su historial, y los candidatos sin ninguna otra postulación.
 * Solo administradores (la función de BD lo exige). Tras el borrado en BD, limpia
 * del bucket los CV de los candidatos eliminados para no dejar archivos huérfanos.
 */
export async function deleteArchivedVacancyCascade(id: string): Promise<ActionResult> {
  return runAction("vacancies.delete_archived_cascade", async () => {
    await requirePermission("vacancies:delete");
    const vacancyId = parseInput(z.uuid(), id);
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("delete_archived_vacancy", { p_vacancy_id: vacancyId });
    if (error) throw toAppError(error);

    const paths = (data as { resume_paths?: string[] } | null)?.resume_paths ?? [];
    if (paths.length > 0) {
      // El borrado en BD ya se confirmó; si falla la limpieza del bucket, los
      // archivos quedan huérfanos (barrido pendiente) pero no se revierte nada.
      try {
        await createSupabaseAdminClient().storage.from(RESUMES_BUCKET).remove(paths);
      } catch {
        // Ignorado a propósito: no debe tumbar la operación ya confirmada.
      }
    }
    revalidatePath("/vacantes");
    redirect("/vacantes");
  });
}

// --- Requisitos ---------------------------------------------------------------

function requirementRow(values: z.output<typeof requirementFormSchema>) {
  return {
    category: values.category,
    priority: values.priority,
    description: values.description,
    keywords: values.keywords,
    weight: values.weight,
    min_years: values.minYears,
    is_essential: values.isEssential,
  };
}

export async function addRequirement(vacancyId: string, input: RequirementFormInput): Promise<ActionResult> {
  return runAction(
    "requirements.add",
    async () => {
      await requirePermission("vacancies:manage");
      const id = parseInput(z.uuid(), vacancyId);
      const values = parseInput(requirementFormSchema, input);
      const supabase = await createSupabaseServerClient();
      const { count } = await supabase
        .from("vacancy_requirements")
        .select("id", { count: "exact", head: true })
        .eq("vacancy_id", id);
      if ((count ?? 0) >= 40) throw new AppError("Una vacante admite hasta 40 requisitos.", "validation");
      const { error } = await supabase
        .from("vacancy_requirements")
        .insert({ ...requirementRow(values), vacancy_id: id, position: count ?? 0 });
      if (error) throw toAppError(error);
      revalidatePath(`/vacantes/${id}`);
      return null;
    },
    "Requisito agregado. Los criterios deberán aprobarse nuevamente.",
  );
}

export async function updateRequirement(
  vacancyId: string,
  requirementId: string,
  input: RequirementFormInput,
): Promise<ActionResult> {
  return runAction(
    "requirements.update",
    async () => {
      await requirePermission("vacancies:manage");
      const id = parseInput(z.uuid(), requirementId);
      const vId = parseInput(z.uuid(), vacancyId);
      const values = parseInput(requirementFormSchema, input);
      const supabase = await createSupabaseServerClient();
      const { data, error } = await supabase
        .from("vacancy_requirements")
        .update(requirementRow(values))
        .eq("id", id)
        .eq("vacancy_id", vId)
        .select("id");
      if (error) throw toAppError(error);
      if (!data.length) throw new AppError("El requisito no existe.", "not_found");
      revalidatePath(`/vacantes/${vId}`);
      return null;
    },
    "Requisito actualizado. Los criterios deberán aprobarse nuevamente.",
  );
}

export async function deleteRequirement(vacancyId: string, requirementId: string): Promise<ActionResult> {
  return runAction(
    "requirements.delete",
    async () => {
      await requirePermission("vacancies:manage");
      const id = parseInput(z.uuid(), requirementId);
      const vId = parseInput(z.uuid(), vacancyId);
      const supabase = await createSupabaseServerClient();
      const { error } = await supabase.from("vacancy_requirements").delete().eq("id", id).eq("vacancy_id", vId);
      if (error) throw toAppError(error);
      revalidatePath(`/vacantes/${vId}`);
      return null;
    },
    "Requisito eliminado. Los criterios deberán aprobarse nuevamente.",
  );
}

// --- Preguntas eliminatorias --------------------------------------------------
// Marcan al candidato; no son criterios de evaluación (no reabren la aprobación).

function killerQuestionRow(values: z.output<typeof killerQuestionFormSchema>) {
  const base = {
    question: values.question,
    question_type: values.questionType,
    help_text: values.helpText,
    is_required: values.isRequired,
    expected_boolean: null as boolean | null,
    comparator: null as Exclude<typeof values.comparator, ""> | null,
    threshold: null as number | null,
    options: null as string[] | null,
    accepted_options: null as string[] | null,
  };
  if (values.questionType === "si_no") return { ...base, expected_boolean: values.expectedBoolean === "si" };
  if (values.questionType === "numero") {
    return { ...base, comparator: values.comparator === "" ? null : values.comparator, threshold: values.threshold };
  }
  return { ...base, options: values.options, accepted_options: values.acceptedOptions };
}

export async function addKillerQuestion(vacancyId: string, input: KillerQuestionFormInput): Promise<ActionResult> {
  return runAction(
    "killer_questions.add",
    async () => {
      await requirePermission("vacancies:manage");
      const id = parseInput(z.uuid(), vacancyId);
      const values = parseInput(killerQuestionFormSchema, input);
      const supabase = await createSupabaseServerClient();
      const { count } = await supabase
        .from("vacancy_killer_questions")
        .select("id", { count: "exact", head: true })
        .eq("vacancy_id", id);
      if ((count ?? 0) >= 10) throw new AppError("Una vacante admite hasta 10 preguntas eliminatorias.", "validation");
      const { error } = await supabase
        .from("vacancy_killer_questions")
        .insert({ ...killerQuestionRow(values), vacancy_id: id, position: count ?? 0 });
      if (error) throw toAppError(error);
      revalidatePath(`/vacantes/${id}`);
      return null;
    },
    "Pregunta agregada. Se mostrará a los candidatos en el formulario de postulación.",
  );
}

export async function updateKillerQuestion(
  vacancyId: string,
  questionId: string,
  input: KillerQuestionFormInput,
): Promise<ActionResult> {
  return runAction(
    "killer_questions.update",
    async () => {
      await requirePermission("vacancies:manage");
      const id = parseInput(z.uuid(), questionId);
      const vId = parseInput(z.uuid(), vacancyId);
      const values = parseInput(killerQuestionFormSchema, input);
      const supabase = await createSupabaseServerClient();
      const { data, error } = await supabase
        .from("vacancy_killer_questions")
        .update(killerQuestionRow(values))
        .eq("id", id)
        .eq("vacancy_id", vId)
        .select("id");
      if (error) throw toAppError(error);
      if (!data.length) throw new AppError("La pregunta no existe.", "not_found");
      revalidatePath(`/vacantes/${vId}`);
      return null;
    },
    "Pregunta actualizada. Las respuestas ya recibidas se recalculan con la nueva condición.",
  );
}

export async function deleteKillerQuestion(vacancyId: string, questionId: string): Promise<ActionResult> {
  return runAction(
    "killer_questions.delete",
    async () => {
      await requirePermission("vacancies:manage");
      const id = parseInput(z.uuid(), questionId);
      const vId = parseInput(z.uuid(), vacancyId);
      const supabase = await createSupabaseServerClient();
      const { error } = await supabase.from("vacancy_killer_questions").delete().eq("id", id).eq("vacancy_id", vId);
      if (error) throw toAppError(error);
      revalidatePath(`/vacantes/${vId}`);
      return null;
    },
    "Pregunta eliminada, junto con las respuestas recibidas.",
  );
}

export async function approveCriteria(vacancyId: string): Promise<ActionResult<{ version: number }>> {
  return runAction(
    "requirements.approve",
    async () => {
      await requirePermission("vacancies:manage");
      const id = parseInput(z.uuid(), vacancyId);
      const supabase = await createSupabaseServerClient();
      const { data, error } = await supabase.rpc("approve_vacancy_criteria", { p_vacancy_id: id });
      if (error) throw toAppError(error);
      revalidatePath(`/vacantes/${id}`);
      return { version: data };
    },
    "Criterios aprobados. Ya pueden evaluarse candidatos con esta versión.",
  );
}


"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { parseInput, runAction, type ActionResult } from "@/lib/action-result";
import { requirePermission } from "@/lib/auth/session";
import { AppError, toAppError } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  canTransitionVacancy,
  requirementFormSchema,
  vacancyFormSchema,
  vacancyStatusSchema,
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
    contract_type: values.contractType,
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

export async function changeVacancyStatus(id: string, status: string): Promise<ActionResult> {
  return runAction(
    "vacancies.status",
    async () => {
      await requirePermission("vacancies:manage");
      const vacancyId = parseInput(z.uuid(), id);
      const next = parseInput(vacancyStatusSchema, status);
      const supabase = await createSupabaseServerClient();
      const { data: current, error } = await supabase.from("vacancies").select("status").eq("id", vacancyId).maybeSingle();
      if (error) throw toAppError(error);
      if (!current) throw new AppError("La vacante no existe o no tiene acceso.", "not_found");
      if (!canTransitionVacancy(current.status, next)) {
        throw new AppError("Ese cambio de estado no está permitido para la vacante.", "conflict");
      }
      const { error: updateError } = await supabase.from("vacancies").update({ status: next }).eq("id", vacancyId);
      if (updateError) throw toAppError(updateError);
      revalidatePath(`/vacantes/${vacancyId}`);
      revalidatePath("/vacantes");
      return null;
    },
    "Estado de la vacante actualizado.",
  );
}

export async function deleteDraftVacancy(id: string): Promise<ActionResult> {
  return runAction("vacancies.delete", async () => {
    await requirePermission("vacancies:delete");
    const vacancyId = parseInput(z.uuid(), id);
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.from("vacancies").delete().eq("id", vacancyId).select("id");
    if (error) throw toAppError(error);
    if (!data.length) throw new AppError("Solo pueden eliminarse vacantes en borrador sin postulaciones.", "conflict");
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


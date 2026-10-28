import "server-only";
import { cache } from "react";
import { toAppError } from "@/lib/errors";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/types/database";
import type { PublicRequirement, PublicSalary, PublicVacancy } from "./types";

type VacancyRow = Database["public"]["Functions"]["public_vacancies"]["Returns"][number];

/** Las funciones garantizan estos datos; la conversión descarta cualquier fila incompleta. */
function toPublicVacancy(row: VacancyRow): PublicVacancy | null {
  if (!row.code || !row.title || !row.department || !row.employment_type || !row.first_published_at) return null;
  const salary: PublicSalary | null =
    row.salary_min !== null && (row.salary_currency === "PEN" || row.salary_currency === "USD") && row.salary_period
      ? {
          min: Number(row.salary_min),
          max: row.salary_max === null ? null : Number(row.salary_max),
          currency: row.salary_currency,
          period: row.salary_period,
        }
      : null;
  return {
    code: row.code,
    title: row.title,
    department: row.department,
    description: row.description ?? "",
    responsibilities: row.responsibilities ?? "",
    city: row.city,
    region: row.region,
    modality: row.modality,
    employmentType: row.employment_type,
    contractType: row.contract_type,
    salary,
    firstPublishedAt: row.first_published_at,
    closingDate: row.closing_date,
    updatedAt: row.updated_at ?? row.first_published_at,
  };
}

/** Vacantes abiertas, públicas y con los datos exigidos (la base de datos filtra). */
export async function listPublicVacancies(): Promise<PublicVacancy[]> {
  const { data, error } = await createSupabaseAdminClient().rpc("public_vacancies");
  if (error) throw toAppError(error);
  return data.flatMap((row) => toPublicVacancy(row) ?? []);
}

export type PublicVacancyDetail = PublicVacancy & { acceptingApplications: boolean };

/** Una vacante pública (abierta o cerrada) por su código, o null. */
export const getPublicVacancy = cache(async (code: string): Promise<PublicVacancyDetail | null> => {
  const { data, error } = await createSupabaseAdminClient().rpc("public_vacancy", { p_code: code });
  if (error) throw toAppError(error);
  const row = data[0];
  const vacancy = row ? toPublicVacancy(row) : null;
  return row && vacancy ? { ...vacancy, acceptingApplications: row.accepting_applications === true } : null;
});

/** Solo descripción y prioridad; nunca términos, pesos ni años mínimos. */
export async function listPublicRequirements(code: string): Promise<PublicRequirement[]> {
  const { data, error } = await createSupabaseAdminClient().rpc("public_vacancy_requirements", { p_code: code });
  if (error) throw toAppError(error);
  return data.flatMap((row) => (row.description && row.priority ? [{ description: row.description, priority: row.priority }] : []));
}

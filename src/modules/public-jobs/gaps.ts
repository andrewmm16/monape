import { limaDate } from "./feed";

type GapInput = {
  description: string;
  employment_type: string | null;
  modality: string | null;
  city: string | null;
  region: string | null;
  closing_date: string | null;
};

/** Mismas reglas que `private.vacancy_has_public_data` en la base de datos. */
export function publicationGaps(vacancy: GapInput): string[] {
  const gaps: string[] = [];
  if (vacancy.description.trim().length < 50) gaps.push("una descripción de al menos 50 caracteres");
  if (!vacancy.employment_type) gaps.push("el tipo de empleo");
  if (vacancy.modality !== "remoto" && !(vacancy.city?.trim() && vacancy.region?.trim())) gaps.push("la ciudad y la región");
  return gaps;
}

export function isClosingDatePassed(closingDate: string | null, now: Date = new Date()): boolean {
  return closingDate !== null && closingDate < limaDate(now);
}

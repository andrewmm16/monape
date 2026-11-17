import { isClosingDatePassed, publicationGaps } from "./gaps";
import { jobPath } from "./slug";

export type PublicVacancyLinkInput = {
  title: string;
  status: string;
  is_confidential: boolean;
  public_code: string | null;
  description: string;
  employment_type: string | null;
  modality: string | null;
  city: string | null;
  region: string | null;
  closing_date: string | null;
};

/**
 * Dirección de la página pública de la vacante, o `null` si no la tiene. Usa
 * las mismas condiciones que la ficha de la vacante para mostrar su «Página
 * pública»: publicada, no confidencial, con los datos completos, sin fecha de
 * cierre vencida y con la parte pública encendida (`siteUrl`).
 */
export function publicVacancyUrl(vacancy: PublicVacancyLinkInput, siteUrl: string | null): string | null {
  if (!siteUrl || vacancy.status !== "publicada" || vacancy.is_confidential || !vacancy.public_code) return null;
  if (publicationGaps(vacancy).length > 0 || isClosingDatePassed(vacancy.closing_date)) return null;
  return `${siteUrl.replace(/\/+$/, "")}${jobPath(vacancy.title, vacancy.public_code)}`;
}

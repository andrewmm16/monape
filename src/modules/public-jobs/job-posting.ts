import { buildDescriptionHtml } from "./html";
import type { PublicSalary, PublicSiteContext, PublicVacancy } from "./types";

const EMPLOYMENT_TYPES = {
  tiempo_completo: "FULL_TIME",
  medio_tiempo: "PART_TIME",
  temporal: "TEMPORARY",
  practicas: "INTERN",
  por_proyecto: "CONTRACTOR",
} as const;

const SALARY_UNITS = { hora: "HOUR", dia: "DAY", semana: "WEEK", mes: "MONTH", anio: "YEAR" } as const;

/** Perú no tiene horario de verano: Lima es UTC-5 todo el año. */
const LIMA_OFFSET = "-05:00";

/** Fin del día de cierre en hora de Lima (instante ISO con desfase). */
export function endOfClosingDay(closingDate: string): string {
  return `${closingDate}T23:59:59${LIMA_OFFSET}`;
}

function baseSalary(salary: PublicSalary) {
  const unitText = SALARY_UNITS[salary.period];
  const value =
    salary.max !== null && salary.max !== salary.min
      ? { "@type": "QuantitativeValue", minValue: salary.min, maxValue: salary.max, unitText }
      : { "@type": "QuantitativeValue", value: salary.min, unitText };
  return { "@type": "MonetaryAmount", currency: salary.currency, value };
}

/**
 * Datos estructurados `JobPosting` de Google. `directApply: true` solo se
 * incluye cuando la página ofrece el formulario de postulación (2.2); si no,
 * se omite (nunca `false`).
 */
export function buildJobPosting(
  vacancy: PublicVacancy,
  site: PublicSiteContext,
  options: { directApply?: boolean } = {},
): Record<string, unknown> {
  const posting: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: vacancy.title,
    description: buildDescriptionHtml(vacancy),
    datePosted: vacancy.firstPublishedAt,
    employmentType: EMPLOYMENT_TYPES[vacancy.employmentType],
    hiringOrganization: {
      "@type": "Organization",
      name: site.companyName,
      ...(site.companyWebsite ? { sameAs: site.companyWebsite } : {}),
      ...(site.companyLogoUrl ? { logo: site.companyLogoUrl } : {}),
    },
    identifier: { "@type": "PropertyValue", name: site.companyName, value: vacancy.code },
  };
  if (options.directApply === true) posting.directApply = true;
  if (vacancy.closingDate) posting.validThrough = endOfClosingDay(vacancy.closingDate);

  if (vacancy.modality === "remoto") {
    posting.jobLocationType = "TELECOMMUTE";
    posting.applicantLocationRequirements = { "@type": "Country", name: "Perú" };
  }
  if (vacancy.city || vacancy.region) {
    posting.jobLocation = {
      "@type": "Place",
      address: {
        "@type": "PostalAddress",
        ...(vacancy.city ? { addressLocality: vacancy.city } : {}),
        ...(vacancy.region ? { addressRegion: vacancy.region } : {}),
        addressCountry: "PE",
      },
    };
  }
  if (vacancy.salary) posting.baseSalary = baseSalary(vacancy.salary);
  return posting;
}

/** JSON seguro dentro de `<script>`: `<` se escribe como `\u003c`. */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

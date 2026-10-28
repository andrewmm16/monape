import { buildDescriptionHtml } from "./html";
import { jobPath } from "./slug";
import type { PublicSalary, PublicSiteContext, PublicVacancy } from "./types";

/** Valores de `jobtype` según el formato de Talent.com. Sin verificar con cada buscador. */
const JOB_TYPES = {
  tiempo_completo: "fulltime",
  medio_tiempo: "parttime",
  temporal: "temporary",
  practicas: "internship",
  por_proyecto: "contract",
} as const;

const PERIOD_TEXT = { hora: "hora", dia: "día", semana: "semana", mes: "mes", anio: "año" } as const;
const CURRENCY_SYMBOL = { PEN: "S/", USD: "US$" } as const;

const INVALID_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;

export function escapeXml(text: string): string {
  return text
    .replace(INVALID_XML_CHARS, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** CDATA que no puede cerrarse desde el contenido: `]]>` se parte en dos secciones. */
export function cdata(text: string): string {
  return `<![CDATA[${text.replace(INVALID_XML_CHARS, "").replaceAll("]]>", "]]]]><![CDATA[>")}]]>`;
}

const LIMA_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Lima",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Fecha civil `YYYY-MM-DD` de un instante, en hora de Lima. */
export function limaDate(instant: Date | string): string {
  return LIMA_DATE.format(typeof instant === "string" ? new Date(instant) : instant);
}

function formatAmount(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

export function formatSalaryText(salary: PublicSalary): string {
  const range =
    salary.max !== null && salary.max !== salary.min
      ? `${formatAmount(salary.min)} - ${formatAmount(salary.max)}`
      : formatAmount(salary.min);
  return `${CURRENCY_SYMBOL[salary.currency]} ${range} por ${PERIOD_TEXT[salary.period]}`;
}

function element(name: string, value: string): string {
  return `    <${name}>${escapeXml(value)}</${name}>`;
}

/** Opciones del feed. */
export type FeedOptions = {
  /**
   * Talent Apply: URL a la que Talent.com envía las postulaciones de cada
   * vacante. Si se indica, cada `<job>` lleva su `<talent-apply-data>`.
   */
  talentApplyPostUrl?: (vacancy: PublicVacancy) => string;
};

/** Contenido de `<talent-apply-data>`: parámetros URL-encoded con prefijo `talent-apply-`. */
export function talentApplyData(postUrl: string): string {
  return `talent-apply-posturl=${encodeURIComponent(postUrl)}`;
}

function jobElement(vacancy: PublicVacancy, site: PublicSiteContext, options: FeedOptions): string {
  const lines = [
    element("referencenumber", vacancy.code),
    element("title", vacancy.title),
    element("company", site.companyName),
    element("city", vacancy.city ?? ""),
    element("state", vacancy.region ?? ""),
    element("country", "PE"),
    element("dateposted", limaDate(vacancy.firstPublishedAt)),
    element("url", `${site.siteUrl}${jobPath(vacancy.title, vacancy.code)}`),
    `    <description>${cdata(buildDescriptionHtml(vacancy))}</description>`,
  ];
  if (vacancy.closingDate) lines.push(element("expirationdate", vacancy.closingDate));
  lines.push(element("jobtype", JOB_TYPES[vacancy.employmentType]));
  lines.push(element("isremote", vacancy.modality === "remoto" ? "yes" : "no"));
  if (vacancy.salary) lines.push(element("salary", formatSalaryText(vacancy.salary)));
  if (options.talentApplyPostUrl) {
    lines.push(`    <talent-apply-data>${cdata(talentApplyData(options.talentApplyPostUrl(vacancy)))}</talent-apply-data>`);
  }
  return `  <job>\n${lines.join("\n")}\n  </job>`;
}

/**
 * Feed XML en el formato que publica Talent.com. Omite las vacantes cuya fecha
 * de cierre ya pasó (hora de Lima); la exclusión de confidenciales, borradores
 * y archivadas la hace la base de datos en `public_vacancies()`.
 */
export function buildFeedXml(
  vacancies: PublicVacancy[],
  site: PublicSiteContext,
  now: Date = new Date(),
  options: FeedOptions = {},
): string {
  const today = limaDate(now);
  const open = vacancies.filter((vacancy) => !vacancy.closingDate || vacancy.closingDate >= today);
  const header = [
    element("publisher", site.companyName),
    element("publisherurl", site.companyWebsite ?? site.siteUrl),
    element("lastbuilddate", now.toUTCString()),
  ];
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<source>",
    ...header,
    ...open.map((vacancy) => jobElement(vacancy, site, options)),
    "</source>",
    "",
  ].join("\n");
}

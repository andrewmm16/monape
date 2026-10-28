import type { Enums } from "@/types/database";

/** Vacante tal como la exponen las funciones `public_*` (lista cerrada de columnas). */
export type PublicVacancy = {
  code: string;
  title: string;
  department: string;
  description: string;
  responsibilities: string;
  city: string | null;
  region: string | null;
  modality: Enums<"work_modality"> | null;
  employmentType: Enums<"employment_type">;
  contractType: string | null;
  salary: PublicSalary | null;
  /** ISO 8601. */
  firstPublishedAt: string;
  /** Fecha civil `YYYY-MM-DD` (último día para postular, hora de Lima). */
  closingDate: string | null;
  updatedAt: string;
};

export type PublicSalary = {
  min: number;
  max: number | null;
  currency: "PEN" | "USD";
  period: Enums<"salary_period">;
};

export type PublicRequirement = {
  description: string;
  priority: Enums<"requirement_priority">;
};

/** Datos de la empresa y del sitio que usan el JSON-LD y el feed. */
export type PublicSiteContext = {
  siteUrl: string;
  companyName: string;
  companyWebsite?: string;
  companyLogoUrl?: string;
};

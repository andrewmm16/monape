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

/** Pregunta eliminatoria tal como la ve el candidato: sin la condición que "cumple". */
export type PublicKillerQuestion = {
  id: string;
  question: string;
  type: Enums<"killer_question_type">;
  helpText: string | null;
  required: boolean;
  /** Solo en `opcion_unica`. */
  options: string[];
};

/** Datos de la empresa y del sitio que usan el JSON-LD y el feed. */
export type PublicSiteContext = {
  siteUrl: string;
  companyName: string;
  companyWebsite?: string;
  companyLogoUrl?: string;
};

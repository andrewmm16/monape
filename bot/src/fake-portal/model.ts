/** Los cinco portales ficticios de la demostración (ninguno es un portal real). */
export const PORTAL_SLUGS = ["linkedin", "bumeran", "trabajos-diarios", "indeed", "computrabajo"] as const;
export type PortalSlug = (typeof PORTAL_SLUGS)[number];

export interface FakeApplicant {
  id: string;
  fullName: string;
  email?: string;
  phone?: string;
  /** Contenido del CV (bytes de un PDF). */
  resume: Uint8Array;
}

export interface FakeJob {
  id: string;
  /** Portal ficticio donde se publicó. */
  portal: PortalSlug;
  title: string;
  description: string;
  status: "activa" | "retirada";
  /** Cuándo la publicó el robot (ISO). */
  createdAt: string;
  applicants: FakeApplicant[];
  company?: string;
  location?: string;
  /** Preguntas de selección (solo las que el portal pide al candidato). */
  questions?: string[];
}

/** Fallas simuladas de un portal. */
export interface PortalFlags {
  loggedIn: boolean;
  captcha: boolean;
  changed: boolean;
  rejecting: boolean;
}

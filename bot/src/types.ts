/** Datos de la vacante tal como los entrega `/api/bot/publicaciones/siguiente`. */
export interface VacancyData {
  id: string;
  title: string;
  department: string | null;
  description: string | null;
  responsibilities: string | null;
  location: string | null;
  city: string | null;
  region: string | null;
  modality: string | null;
  contract_type: string | null;
  closing_date: string | null;
  requirements: { description: string; priority: string }[];
}

export interface Job {
  publicationId: string;
  action: "publicar" | "retirar";
  /** Id de la oferta en el portal; solo existe si ya se publicó. */
  externalId: string | null;
  vacancy: VacancyData;
}

export type ReportBody =
  | { outcome: "publicada"; externalId: string; externalUrl: string }
  | { outcome: "retirada" }
  | { outcome: "error"; errorCode: string };

/** Oferta publicada cuyos postulantes hay que revisar. */
export interface ActivePublication {
  publicationId: string;
  externalId: string | null;
  externalUrl: string | null;
  lastSyncedAt: string | null;
}

/** Fila de la lista de postulantes del portal, sin el CV todavía. */
export interface ApplicantSummary {
  /** Id estable del postulante dentro de la oferta (la app deduplica por él). */
  externalId: string;
  fullName: string;
  email?: string;
  phone?: string;
  /** Referencia propia del adaptador para bajar el CV (por ejemplo, una URL). */
  resumeRef: string;
}

export interface ResumeFile {
  filename: string;
  bytes: Uint8Array;
}

export interface PublishResult {
  externalId: string;
  externalUrl: string;
}

/**
 * Lo único que cambia de un portal a otro. El adaptador solo habla con el
 * portal; nunca con la app (de eso se encarga el runner). Debe lanzar
 * `PortalError` con un código conocido cuando no pueda continuar.
 */
export interface PortalAdapter {
  /** Nombre corto del portal en la API del robot, por ejemplo "trabajos-diarios". */
  readonly slug: string;
  /**
   * Prueba SIN efectos: abre las pantallas que el adaptador usa (publicar, lista
   * de postulantes) y comprueba que sigan los campos y botones esperados. No
   * envía ni cambia nada. Lanza `PortalError` si no puede continuar
   * (pagina_cambio, sesion_expirada, verificacion_requerida).
   */
  healthCheck(): Promise<void>;
  /**
   * Opcional: pasos de la última `healthCheck()` que no pudo verificar (por ejemplo, no
   * hay ofertas ni postulantes en el portal). El runner los deja en el log.
   */
  healthCheckGaps?(): string[];
  /**
   * Opcional: esquema de la pantalla en la que está el adaptador (campos y botones,
   * sin datos personales; ver `captureStructure` en `structure.ts`). Se usa al
   * registrar un incidente para poder diagnosticar el cambio del portal.
   */
  captureStructure?(): Promise<string>;
  publish(vacancy: VacancyData): Promise<PublishResult>;
  withdraw(externalId: string): Promise<void>;
  listApplicants(publication: ActivePublication): Promise<ApplicantSummary[]>;
  downloadResume(publication: ActivePublication, applicant: ApplicantSummary): Promise<ResumeFile>;
  close(): Promise<void>;
}

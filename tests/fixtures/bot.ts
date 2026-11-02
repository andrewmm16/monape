import type { BotApiLike, SendApplicantStatus } from "../../bot/src/api";
import type { ActivePublication, ApplicantSummary, Job, ReportBody, ResumeFile, VacancyData } from "../../bot/src/types";

export const PUBLICATION_ID = "0b1f6a52-3c1e-4c53-9d6e-2f1f3a7a9c11";

export const vacancy = (overrides: Partial<VacancyData> = {}): VacancyData => ({
  id: "v-1",
  title: "Operario de planta (ficticio)",
  department: null,
  description: "Descripción ficticia de la vacante.",
  responsibilities: null,
  location: null,
  city: "Lima",
  region: "Lima",
  modality: null,
  contract_type: null,
  closing_date: null,
  requirements: [],
  ...overrides,
});

export const job = (overrides: Partial<Job> = {}): Job => ({
  publicationId: PUBLICATION_ID,
  action: "publicar",
  externalId: null,
  vacancy: vacancy(),
  ...overrides,
});

/** La app simulada en memoria: registra lo que el robot informa y entrega. */
export class MemoryApi implements BotApiLike {
  queue: Job[] = [];
  reports: { publicationId: string; body: ReportBody }[] = [];
  activePublications: ActivePublication[] = [];
  sent: { publicationId: string; applicant: ApplicantSummary; resume: ResumeFile }[] = [];
  synced: string[] = [];
  reportFailures = 0;
  /** Si se da, `report` falla siempre con este error (por ejemplo, un `ApiError` 409). */
  reportError: Error | null = null;
  /** Si se da, `sendApplicant` y `markSynced` fallan con este error. */
  appError: Error | null = null;
  sendStatus: SendApplicantStatus = "registrada";

  async claim(): Promise<Job | null> {
    return this.queue.shift() ?? null;
  }

  async report(publicationId: string, body: ReportBody): Promise<void> {
    if (this.reportError) throw this.reportError;
    if (this.reportFailures > 0) {
      this.reportFailures--;
      throw new Error("app caída");
    }
    // Misma regla que la base de datos: el enlace de la oferta debe ser https.
    if (body.outcome === "publicada" && !body.externalUrl.startsWith("https://")) throw new Error("422: externalUrl debe ser https");
    this.reports.push({ publicationId, body });
  }

  statuses: { state: string; reason?: string }[] = [];
  async reportStatus(_portal: string, state: "activo" | "necesita_persona", reason?: string): Promise<void> {
    this.statuses.push({ state, reason });
  }

  async active(): Promise<ActivePublication[]> {
    return this.activePublications;
  }

  async markSynced(publicationId: string): Promise<void> {
    if (this.appError) throw this.appError;
    this.synced.push(publicationId);
  }

  async sendApplicant(publicationId: string, applicant: ApplicantSummary, resume: ResumeFile): Promise<SendApplicantStatus> {
    if (this.appError) throw this.appError;
    this.sent.push({ publicationId, applicant, resume });
    return this.sendStatus;
  }
}

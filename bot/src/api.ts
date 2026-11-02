import { ApiError } from "./errors";
import type { ActivePublication, ApplicantSummary, Job, ReportBody, ResumeFile } from "./types";

/** `registrada` y `ya_registrada` son éxito; `cerrada` = la vacante ya no recibe postulantes; `invalida` = la app rechazó el CV. */
export type SendApplicantStatus = "registrada" | "ya_registrada" | "cerrada" | "invalida";

/** Lo que el runner necesita de la app. Permite probarlo sin red. */
export interface BotApiLike {
  claim(portal: string): Promise<Job | null>;
  report(publicationId: string, body: ReportBody): Promise<void>;
  active(portal: string): Promise<ActivePublication[]>;
  markSynced(publicationId: string): Promise<void>;
  /** Avisa a la app que el robot sigue activo o que necesita a una persona. */
  reportStatus(portal: string, state: "activo" | "necesita_persona", reason?: string): Promise<void>;
  sendApplicant(publicationId: string, applicant: ApplicantSummary, resume: ResumeFile): Promise<SendApplicantStatus>;
}

export { ApiError };

export class BotApi implements BotApiLike {
  constructor(
    private readonly baseUrl: string,
    private readonly secret: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async request(path: string, init: { method: string; body?: BodyInit; json?: unknown }): Promise<Response> {
    const headers: Record<string, string> = { authorization: `Bearer ${this.secret}` };
    let body = init.body;
    if (init.json !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(init.json);
    }
    return this.fetchImpl(`${this.baseUrl}${path}`, { method: init.method, headers, body, signal: AbortSignal.timeout(60_000) });
  }

  private async ok<T>(path: string, response: Response): Promise<T> {
    if (!response.ok) throw new ApiError(response.status, path);
    return (await response.json()) as T;
  }

  async claim(portal: string): Promise<Job | null> {
    const path = "/api/bot/publicaciones/siguiente";
    const response = await this.request(path, { method: "POST", json: { portal } });
    return (await this.ok<{ job: Job | null }>(path, response)).job;
  }

  async report(publicationId: string, body: ReportBody): Promise<void> {
    const path = `/api/bot/publicaciones/${publicationId}/resultado`;
    await this.ok(path, await this.request(path, { method: "POST", json: body }));
  }

  async active(portal: string): Promise<ActivePublication[]> {
    const path = `/api/bot/publicaciones/activas?portal=${encodeURIComponent(portal)}`;
    const data = await this.ok<{ publications: ActivePublication[] }>(path, await this.request(path, { method: "GET" }));
    return data.publications;
  }

  async markSynced(publicationId: string): Promise<void> {
    const path = `/api/bot/publicaciones/${publicationId}/sincronizada`;
    await this.ok(path, await this.request(path, { method: "POST" }));
  }

  async reportStatus(portal: string, state: "activo" | "necesita_persona", reason?: string): Promise<void> {
    const path = "/api/bot/estado";
    await this.ok(path, await this.request(path, { method: "POST", json: { portal, state, reason } }));
  }

  async sendApplicant(publicationId: string, applicant: ApplicantSummary, resume: ResumeFile): Promise<SendApplicantStatus> {
    const path = "/api/bot/postulantes";
    const form = new FormData();
    form.set("publicationId", publicationId);
    form.set("externalId", applicant.externalId);
    form.set("fullName", applicant.fullName);
    if (applicant.email) form.set("email", applicant.email);
    if (applicant.phone) form.set("phone", applicant.phone);
    form.set("resume", new File([new Uint8Array(resume.bytes)], resume.filename));

    const response = await this.request(path, { method: "POST", body: form });
    if (response.status === 409) return "cerrada";
    if (response.status === 422 || response.status === 413) return "invalida";
    const data = await this.ok<{ status: string }>(path, response);
    return data.status === "ya_registrada" ? "ya_registrada" : "registrada";
  }
}

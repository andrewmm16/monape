import { claimResponseSchema, type Job, type Report } from "./types";

/** Error al hablar con la app. `status` es null si no hubo respuesta (red, DNS, tiempo agotado). */
export class AppApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "AppApiError";
  }
}

export type WorkerState =
  | { state: "activo"; cliVersion?: string }
  | { state: "pausado"; reason: "limite_plan" | "sin_sesion" | "worker_no_disponible"; until?: string; cliVersion?: string };

export type AppApi = {
  claim(): Promise<{ job: Job | null; paused: boolean }>;
  report(job: Pick<Job, "id" | "claimToken">, report: Report): Promise<void>;
  /** Latido con el estado del worker (la app avisa a RRHH si deja de llegar). */
  status(state: WorkerState): Promise<void>;
};

const REQUEST_TIMEOUT_MS = 60_000;

/** Cliente de la API del worker en la app. El secreto solo viaja en la cabecera Authorization. */
export function createAppApi(options: { appUrl: string; secret: string; fetchImpl?: typeof fetch }): AppApi {
  const doFetch = options.fetchImpl ?? fetch;

  async function post(path: string, body: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await doFetch(new URL(path, options.appUrl), {
        method: "POST",
        headers: { authorization: `Bearer ${options.secret}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new AppApiError(`no se pudo conectar con la app (${error instanceof Error ? error.name : "error"})`, null);
    }
    if (response.status === 404 && path.endsWith("/siguiente")) {
      throw new AppApiError(
        "la app respondió 404: revise IA_WORKER_APP_URL y que IA_WORKER_SECRET sea igual a AI_WORKER_SECRET del servidor",
        404,
      );
    }
    if (!response.ok) throw new AppApiError(`la app respondió ${response.status}`, response.status);
    return response.json();
  }

  return {
    async claim() {
      const parsed = claimResponseSchema.safeParse(await post("/api/ia/trabajos/siguiente", {}));
      if (!parsed.success) throw new AppApiError("la app devolvió un trabajo con formato inesperado", 200);
      return { job: parsed.data.job, paused: parsed.data.paused ?? false };
    },
    async report(job, report) {
      await post(`/api/ia/trabajos/${encodeURIComponent(job.id)}/resultado`, { ...report, claimToken: job.claimToken });
    },
    async status(state) {
      await post("/api/ia/estado", state);
    },
  };
}

import { z } from "zod";

/**
 * Configuración del worker de IA, leída del entorno (`.env.ia-worker`).
 * La autenticación con Claude NO se configura aquí: el CLI usa
 * CLAUDE_CODE_OAUTH_TOKEN (de `claude setup-token`) o la sesión iniciada con
 * `claude` en esta máquina.
 */
const configSchema = z.object({
  IA_WORKER_APP_URL: z.url(),
  IA_WORKER_SECRET: z.string().trim().min(32, "mínimo 32 caracteres (el mismo AI_WORKER_SECRET del servidor)"),
  IA_WORKER_CLI_PATH: z.string().trim().min(1).default("claude"),
  IA_WORKER_POLL_SECONDS: z.coerce.number().int().min(2).max(300).default(10),
  // Máximo 480 s: la reserva de un trabajo vence a los 10 min y luego otro worker podría tomarlo.
  IA_WORKER_TIMEOUT_SECONDS: z.coerce.number().int().min(30).max(480).default(300),
  IA_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(1),
  /** Opcional: fuerza un modelo en vez del que indica el servidor (AI_MODEL). */
  IA_WORKER_MODEL: z
    .string()
    .trim()
    .optional()
    .transform((value) => value || undefined),
});

export type WorkerConfig = {
  appUrl: string;
  secret: string;
  cliPath: string;
  pollMs: number;
  timeoutMs: number;
  concurrency: number;
  modelOverride?: string;
};

export function loadConfig(env: Record<string, string | undefined>): WorkerConfig {
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    // Solo nombres de variables y el motivo, nunca valores.
    const detail = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new Error(`Configuración del worker incompleta o inválida: ${detail}`);
  }
  const c = parsed.data;
  return {
    appUrl: c.IA_WORKER_APP_URL,
    secret: c.IA_WORKER_SECRET,
    cliPath: c.IA_WORKER_CLI_PATH,
    pollMs: c.IA_WORKER_POLL_SECONDS * 1_000,
    timeoutMs: c.IA_WORKER_TIMEOUT_SECONDS * 1_000,
    concurrency: c.IA_WORKER_CONCURRENCY,
    modelOverride: c.IA_WORKER_MODEL,
  };
}

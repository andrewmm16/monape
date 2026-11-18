import "server-only";
import { z } from "zod";

/**
 * Variables de entorno del servidor, validadas de forma perezosa (en la
 * primera solicitud) para que `next build` no requiera secretos.
 * Ninguna variable sin prefijo NEXT_PUBLIC_ llega al navegador.
 */
const booleanFlag = z
  .enum(["true", "false", ""])
  .default("false")
  .transform((value) => value === "true");

const optionalText = z.string().trim().optional().transform((value) => value || undefined);
const optionalUrl = z
  .string()
  .trim()
  .optional()
  .transform((value) => value || undefined)
  .pipe(z.url().optional());

const MIN_TALENT_SECRET_LENGTH = 32;

const serverEnvSchema = z
  .object({
    APP_URL: z.url(),
    APP_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
    NEXT_PUBLIC_SUPABASE_URL: z.url(),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
    SUPABASE_SECRET_KEY: z.string().min(20).optional().or(z.literal("").transform(() => undefined)),
    // `anthropic`: API de pago dentro de la solicitud. `claude-cli`: cola procesada por
    // ia-worker/ con la suscripción de Claude (docs/configuracion-ia.md).
    AI_PROVIDER: z.enum(["none", "anthropic", "claude-cli"]).default("none"),
    AI_API_KEY: z.string().optional(),
    AI_MODEL: z.string().min(1).default("claude-haiku-5-5"),
    AI_EXTERNAL_PROCESSING_APPROVED: booleanFlag,
    // Solo con `anthropic` (costo por token); la cola no tiene tope propio.
    AI_MAX_EVALUATIONS_PER_DAY: z.coerce.number().int().min(0).default(50),
    AI_MAX_INPUT_CHARS: z.coerce.number().int().min(1000).max(200_000).default(30_000),
    // API del worker de IA (/api/ia/*): apagada si no se define el secreto.
    AI_WORKER_SECRET: optionalText,
    // Tras cada evaluación del motor, con `claude-cli`: nada, solo los casos dudosos o todas.
    AI_AUTO_ENQUEUE: z.enum(["off", "dudosos", "todos"]).default("dudosos"),
    // Con `dudosos`: % de las evaluaciones SIN dudas que también van a la IA (muestra de control).
    AI_CONTROL_SAMPLE_PERCENT: z.coerce.number().int().min(0).max(100).default(10),
    // La IA releva al motor en lo dudoso y su valoración cuenta en el puntaje (ai/relay.ts).
    AI_RELAY_SCORE: z
      .enum(["true", "false", ""])
      .default("true")
      .transform((value) => value !== "false"),
    // El motor aprende de la IA: votos de CV distintos (sin ninguno en contra) para pasar
    // al segundo juez (0 = no aprende). 2: los votos de un mismo modelo se equivocan juntos;
    // el control independiente es el juez (medido el 18/11, ver docs/metodologia-evaluacion.md).
    AI_LEARN_MIN_CONFIRMATIONS: z.coerce.number().int().min(0).max(50).default(2),
    // Segundo juez de las reglas aprendidas (un modelo más capaz que el de las evaluaciones).
    AI_JUDGE_MODEL: z.string().min(1).default("claude-opus-5-5"),
    // Parte pública (2.9): apagada por defecto. Encendida, exige URL y empresa.
    PUBLIC_JOBS_ENABLED: booleanFlag,
    PUBLIC_SITE_URL: optionalUrl,
    PUBLIC_COMPANY_NAME: optionalText,
    PUBLIC_COMPANY_WEBSITE: optionalUrl,
    PUBLIC_COMPANY_LOGO_URL: optionalUrl,
    // Recepción de Talent Apply (2.10): apagada por defecto. Encendida, exige
    // dos secretos de al menos 32 caracteres, la URL del sitio y la empresa.
    TALENT_APPLY_ENABLED: booleanFlag,
    TALENT_APPLY_SECRET: optionalText,
    TALENT_FEED_TOKEN: optionalText,
    // Formulario público de postulación (2.2): apagado por defecto. Encendido,
    // exige la parte pública y un secreto de al menos 32 caracteres (firma los
    // desafíos y deriva el identificador de límite a partir de la IP).
    PUBLIC_APPLY_ENABLED: booleanFlag,
    INTAKE_HASH_SECRET: optionalText,
    // Webhook de evaluación (/api/evaluar-cv): apagado si no se define el secreto.
    EVALUATION_WEBHOOK_SECRET: optionalText,
    // API del robot de portales (/api/bot/*): apagada si no se define el secreto.
    PORTAL_BOT_SECRET: optionalText,
    // Correo transaccional (Resend): en `test` (por defecto) no se envía nada.
    // En `live` exige la clave y un remitente verificado.
    RESEND_API_KEY: optionalText,
    EMAIL_FROM: optionalText,
    EMAIL_DELIVERY_MODE: z.enum(["test", "live"]).default("test"),
  })
  .superRefine((env, ctx) => {
    if (env.EMAIL_DELIVERY_MODE === "live") {
      for (const name of ["RESEND_API_KEY", "EMAIL_FROM"] as const) {
        if (!env[name]) ctx.addIssue({ code: "custom", path: [name], message: "Obligatoria si EMAIL_DELIVERY_MODE=live" });
      }
    }
    if (env.PUBLIC_JOBS_ENABLED) {
      for (const name of ["PUBLIC_SITE_URL", "PUBLIC_COMPANY_NAME"] as const) {
        if (!env[name]) ctx.addIssue({ code: "custom", path: [name], message: "Obligatoria si PUBLIC_JOBS_ENABLED=true" });
      }
    }
    if (env.PUBLIC_APPLY_ENABLED) {
      if (!env.PUBLIC_JOBS_ENABLED) {
        ctx.addIssue({ code: "custom", path: ["PUBLIC_JOBS_ENABLED"], message: "Obligatoria si PUBLIC_APPLY_ENABLED=true" });
      }
      if (!env.INTAKE_HASH_SECRET || env.INTAKE_HASH_SECRET.length < MIN_TALENT_SECRET_LENGTH) {
        ctx.addIssue({
          code: "custom",
          path: ["INTAKE_HASH_SECRET"],
          message: `Obligatoria (mínimo ${MIN_TALENT_SECRET_LENGTH} caracteres) si PUBLIC_APPLY_ENABLED=true`,
        });
      }
    }
    for (const name of ["EVALUATION_WEBHOOK_SECRET", "PORTAL_BOT_SECRET", "AI_WORKER_SECRET"] as const) {
      const value = env[name];
      if (value && value.length < MIN_TALENT_SECRET_LENGTH) {
        ctx.addIssue({ code: "custom", path: [name], message: `Mínimo ${MIN_TALENT_SECRET_LENGTH} caracteres` });
      }
    }
    if (env.TALENT_APPLY_ENABLED) {
      // El feed y la URL de postulación se arman con la URL del sitio y la empresa.
      for (const name of ["PUBLIC_SITE_URL", "PUBLIC_COMPANY_NAME"] as const) {
        if (!env[name]) ctx.addIssue({ code: "custom", path: [name], message: "Obligatoria si TALENT_APPLY_ENABLED=true" });
      }
      for (const name of ["TALENT_APPLY_SECRET", "TALENT_FEED_TOKEN"] as const) {
        if (!env[name] || env[name].length < MIN_TALENT_SECRET_LENGTH) {
          ctx.addIssue({
            code: "custom",
            path: [name],
            message: `Obligatoria (mínimo ${MIN_TALENT_SECRET_LENGTH} caracteres) si TALENT_APPLY_ENABLED=true`,
          });
        }
      }
    }
  });

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // Solo se informa el nombre de las variables, nunca sus valores.
    const fields = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Configuración del servidor incompleta o inválida: ${fields}`);
  }
  cached = parsed.data;
  return cached;
}

export function getSupabaseConfig() {
  const env = getServerEnv();
  return { url: env.NEXT_PUBLIC_SUPABASE_URL, publishableKey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY };
}

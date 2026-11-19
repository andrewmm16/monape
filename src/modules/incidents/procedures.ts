/**
 * Rotación de claves (docs/politica-incidentes.md, punto 6). Solo nombres de
 * variables y pasos: aquí NUNCA van valores de secretos.
 */
export type SecretRotation = { secret: string; where: string; how: string };

export const SECRET_ROTATIONS: readonly SecretRotation[] = [
  {
    secret: "SUPABASE_SECRET_KEY",
    where: "Vercel",
    how: "Supabase → Project Settings → API keys: crear una nueva y revocar la anterior.",
  },
  {
    secret: "AI_WORKER_SECRET / IA_WORKER_SECRET",
    where: "Vercel y .env.ia-worker de la PC del robot",
    how: "Generar uno nuevo (32 caracteres o más), el mismo valor en los dos lados, y reiniciar el worker.",
  },
  {
    secret: "CLAUDE_CODE_OAUTH_TOKEN",
    where: ".env.ia-worker",
    how: "claude setup-token para generar uno nuevo; revocar el anterior desde la cuenta de Claude.",
  },
  {
    secret: "RESEND_API_KEY",
    where: "Vercel",
    how: "Panel de Resend: crear una clave nueva y borrar la anterior.",
  },
  {
    secret: "PORTAL_BOT_SECRET, CRON_SECRET, EVALUATION_WEBHOOK_SECRET, TALENT_APPLY_SECRET, TALENT_FEED_TOKEN",
    where: "Vercel (y el robot o el portal que la usa)",
    how: "Generar una nueva y actualizarla en los dos extremos (Talent.com: ver configuracion-talent.md).",
  },
  {
    secret: "INTAKE_HASH_SECRET",
    where: "Vercel",
    how: "Generar una nueva (firma el desafío antirrobots del formulario público). Quien esté postulando tendrá que reintentar.",
  },
  {
    secret: "Usuario y clave de un portal de empleo",
    where: "Configuración del robot",
    how: "Cambiar la clave en el portal y luego en el robot.",
  },
];

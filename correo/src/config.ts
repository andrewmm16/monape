import path from "node:path";

export interface MailConfig {
  apiUrl: string;
  secret: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  user: string;
  /** Contraseña de aplicación del buzón. Es sensible: no se sube al repositorio. */
  password: string;
  mailbox: string;
  pollSeconds: number;
  stateFile: string;
  /** Si es true, un correo sin Authentication-Results que lo respalde se rechaza. */
  requireAuth: boolean;
  /** Carpeta de archivos .eml (pruebas con correos reenviados); vacío = se usa el buzón IMAP. */
  folder: string;
  /** Activa la plantilla ficticia `ejemplo-ficticio` (solo para pruebas). */
  enableExample: boolean;
}

function number(env: Record<string, string | undefined>, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} debe ser un número entre ${min} y ${max}.`);
  }
  return value;
}

function flag(env: Record<string, string | undefined>, name: string, fallback: boolean): boolean {
  const raw = (env[name] ?? "").trim().toLowerCase();
  if (raw === "") return fallback;
  if (["true", "1"].includes(raw)) return true;
  if (["false", "0"].includes(raw)) return false;
  throw new Error(`${name} debe ser true o false.`);
}

/**
 * `needsImap` = false cuando se leen .eml de una carpeta (`--folder` o MAIL_FOLDER):
 * entonces no hacen falta los datos del buzón.
 */
export function loadConfig(env: Record<string, string | undefined> = process.env, needsImap = true): MailConfig {
  const apiUrl = (env.BOT_API_URL ?? "").trim().replace(/\/+$/, "");
  if (!apiUrl) throw new Error("Falta BOT_API_URL (la dirección de la app, sin /api).");
  const url = new URL(apiUrl);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !local) {
    throw new Error("BOT_API_URL debe usar https, salvo en localhost.");
  }

  const secret = env.PORTAL_BOT_SECRET ?? "";
  if (secret.length < 32) throw new Error("PORTAL_BOT_SECRET debe tener al menos 32 caracteres.");

  const imapHost = (env.MAIL_IMAP_HOST ?? "").trim();
  const user = (env.MAIL_USER ?? "").trim();
  const password = env.MAIL_PASSWORD ?? "";
  if (needsImap) {
    if (!imapHost) throw new Error("Falta MAIL_IMAP_HOST.");
    if (!user) throw new Error("Falta MAIL_USER.");
    if (!password) throw new Error("Falta MAIL_PASSWORD (contraseña de aplicación del buzón).");
  }

  return {
    apiUrl,
    secret,
    imapHost,
    imapPort: number(env, "MAIL_IMAP_PORT", 993, 1, 65_535),
    imapSecure: flag(env, "MAIL_IMAP_SECURE", true),
    user,
    password,
    mailbox: (env.MAIL_MAILBOX ?? "").trim() || "INBOX",
    pollSeconds: number(env, "MAIL_POLL_SECONDS", 300, 30, 86_400),
    stateFile: path.resolve(env.MAIL_STATE_FILE ?? "correo/.state/procesados.json"),
    // Por defecto se exige autenticidad: cualquiera puede escribir un correo falso al buzón.
    requireAuth: flag(env, "MAIL_REQUIRE_AUTH", true),
    folder: (env.MAIL_FOLDER ?? "").trim() ? path.resolve(env.MAIL_FOLDER as string) : "",
    enableExample: env.MAIL_ENABLE_EXAMPLE === "1",
  };
}

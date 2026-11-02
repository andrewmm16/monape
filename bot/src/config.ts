import path from "node:path";

export interface BotConfig {
  apiUrl: string;
  secret: string;
  adapter: string;
  /** Carpeta con la sesión del navegador (cookies). Es sensible: no se sube al repositorio. */
  profileDir: string;
  stateFile: string;
  headless: boolean;
  pollSeconds: number;
  /** Pausa entre acciones en el portal, para no cargarlo. */
  pauseMs: number;
  maxJobsPerCycle: number;
  /** Cada cuántas horas se prueba la estructura del portal; 0 = nunca. */
  healthCheckHours: number;
  /** Cada cuántos minutos se reintenta (solo con la prueba de estructura) un portal detenido por `pagina_cambio`; 0 = nunca. */
  resumeCheckMinutes: number;
  /** Retraso de cada acción del navegador, para verlo trabajar. */
  slowMoMs: number;
  fakePortalUrl: string;
  /** Número del responsable (solo dígitos, con código de país) para avisos por WhatsApp; `null` = sin avisos. */
  notifyPhone: string | null;
  /** Ofertas publicadas cuyo resultado aún no se informó a la app (evita publicar dos veces). */
  journalFile: string;
  /** Carpeta de los incidentes del robot (un JSON por incidente). */
  incidentsDir: string;
  /** Sesión de WhatsApp vinculada. Es sensible: no se sube al repositorio. */
  whatsappAuthDir: string;
  /** Selectores aprobados por una persona que reemplazan a los del adaptador (ver `selectors.ts`). */
  selectorsFile: string;
  /** Eventos en que el robot usó un selector alternativo (últimos 500). */
  tolerancesFile: string;
  /** Carpeta de las propuestas de reparación (un JSON por incidente). */
  proposalsDir: string;
  /** Reparación asistida por IA: solo se activa si existe `ANTHROPIC_API_KEY` (la clave se lee del entorno, nunca se guarda aquí). */
  repairEnabled: boolean;
  /** Modelo que propone el selector nuevo (ID exacto, sin sufijo de fecha). */
  repairModel: string;
  /** Máximo de consultas al modelo por día. */
  repairMaxPerDay: number;
  /** Minutos tras aplicar una propuesta en que un fallo de la comprobación la revierte sola. */
  repairVerifyMinutes: number;
  /** Intentos máximos por incidente: cada propuesta se prueba (ensayo) y, si falla, se pide una corrección al modelo. */
  repairMaxAttempts: number;
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

export function loadConfig(env: Record<string, string | undefined> = process.env): BotConfig {
  const apiUrl = (env.BOT_API_URL ?? "").trim().replace(/\/+$/, "");
  if (!apiUrl) throw new Error("Falta BOT_API_URL (la dirección de la app, sin /api).");
  const url = new URL(apiUrl);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !local) {
    throw new Error("BOT_API_URL debe usar https, salvo en localhost.");
  }

  const secret = env.PORTAL_BOT_SECRET ?? "";
  if (secret.length < 32) throw new Error("PORTAL_BOT_SECRET debe tener al menos 32 caracteres.");

  return {
    apiUrl,
    secret,
    adapter: (env.BOT_ADAPTER ?? "").trim(),
    profileDir: path.resolve(env.BOT_PROFILE_DIR ?? "bot/.profile"),
    stateFile: path.resolve(env.BOT_STATE_FILE ?? "bot/.state/enviados.json"),
    // Por defecto el navegador es visible: una persona debe poder verlo e intervenir.
    headless: env.BOT_HEADLESS === "true",
    pollSeconds: number(env, "BOT_POLL_SECONDS", 600, 60, 86_400),
    pauseMs: number(env, "BOT_PAUSE_MS", 2_000, 0, 60_000),
    maxJobsPerCycle: number(env, "BOT_MAX_JOBS_PER_CYCLE", 10, 1, 100),
    healthCheckHours: number(env, "BOT_HEALTH_CHECK_HOURS", 24, 0, 168),
    resumeCheckMinutes: resumeCheckMinutes(env),
    slowMoMs: number(env, "BOT_SLOWMO_MS", 0, 0, 5_000),
    fakePortalUrl: (env.BOT_FAKE_PORTAL_URL ?? "http://127.0.0.1:4010").replace(/\/+$/, ""),
    journalFile: path.resolve(env.BOT_JOURNAL_FILE ?? "bot/.state/publicadas.json"),
    incidentsDir: path.resolve(env.BOT_INCIDENTS_DIR ?? "bot/.state/incidentes"),
    selectorsFile: path.resolve(env.BOT_SELECTORS_FILE ?? "bot/.state/selectores.json"),
    tolerancesFile: path.resolve(env.BOT_TOLERANCES_FILE ?? "bot/.state/tolerancias.json"),
    proposalsDir: path.resolve(env.BOT_PROPOSALS_DIR ?? "bot/.state/propuestas"),
    ...loadRepairConfig(env),
    ...loadNotifyConfig(env),
  };
}

/** 0 (desactivado) o de 1 a 1440 minutos. */
function resumeCheckMinutes(env: Record<string, string | undefined>): number {
  const value = number(env, "BOT_RESUME_CHECK_MINUTES", 10, 0, 1_440);
  if (value > 0 && value < 1) throw new Error("BOT_RESUME_CHECK_MINUTES debe ser 0 (desactivado) o un número entre 1 y 1440.");
  return value;
}

/** Modelo por defecto de la reparación asistida (ID exacto, sin sufijo de fecha). */
export const DEFAULT_REPAIR_MODEL = "claude-sonnet-5-5";

/** Reparación asistida: sin `ANTHROPIC_API_KEY` queda desactivada y el robot se comporta como siempre. */
export function loadRepairConfig(
  env: Record<string, string | undefined> = process.env,
): Pick<BotConfig, "repairEnabled" | "repairModel" | "repairMaxPerDay" | "repairVerifyMinutes" | "repairMaxAttempts"> {
  const model = (env.BOT_REPAIR_MODEL ?? "").trim() || DEFAULT_REPAIR_MODEL;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{1,79}$/.test(model)) {
    throw new Error("BOT_REPAIR_MODEL debe ser un ID de modelo (letras, números, punto, guion), por ejemplo claude-sonnet-5-5.");
  }
  const maxPerDay = number(env, "BOT_REPAIR_MAX_PER_DAY", 10, 0, 1_000);
  if (!Number.isInteger(maxPerDay)) throw new Error("BOT_REPAIR_MAX_PER_DAY debe ser un número entero entre 0 y 1000.");
  const verify = number(env, "BOT_REPAIR_VERIFY_MINUTES", 30, 1, 1_440);
  const attempts = number(env, "BOT_REPAIR_MAX_ATTEMPTS", 3, 1, 5);
  if (!Number.isInteger(attempts)) throw new Error("BOT_REPAIR_MAX_ATTEMPTS debe ser un número entero entre 1 y 5.");
  return {
    repairEnabled: (env.ANTHROPIC_API_KEY ?? "").trim() !== "" && maxPerDay > 0,
    repairModel: model,
    repairMaxPerDay: maxPerDay,
    repairVerifyMinutes: verify,
    repairMaxAttempts: attempts,
  };
}

/** Solo lo de los avisos: la vinculación de WhatsApp no necesita la dirección de la app ni el secreto. */
export function loadNotifyConfig(
  env: Record<string, string | undefined> = process.env,
): Pick<BotConfig, "notifyPhone" | "whatsappAuthDir"> {
  const phone = (env.BOT_NOTIFY_PHONE ?? "").trim();
  if (phone && !/^[1-9]\d{7,14}$/.test(phone)) {
    throw new Error("BOT_NOTIFY_PHONE debe tener solo dígitos, con código de país y sin «+» (por ejemplo 51999999999).");
  }
  return {
    notifyPhone: phone || null,
    whatsappAuthDir: path.resolve(env.BOT_WHATSAPP_DIR ?? "bot/.state/whatsapp"),
  };
}

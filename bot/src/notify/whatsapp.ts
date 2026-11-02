import type { WAMessage } from "@whiskeysockets/baileys";
import { parseIncoming } from "./commands";
import type { IncomingHandler, Notifier } from "./types";

type Baileys = typeof import("@whiskeysockets/baileys");
type Socket = ReturnType<Baileys["default"]>;
type Logger = NonNullable<Parameters<Baileys["default"]>[0]["logger"]>;

export interface WhatsAppOptions {
  /** Carpeta con la sesión vinculada. Es sensible: no se sube al repositorio. */
  authDir: string;
  /** Número del responsable, solo dígitos y con código de país (por ejemplo 51999999999). */
  phone: string;
  log: (message: string) => void;
  /** Si se da y la sesión aún no está vinculada, se pide un código de vinculación. */
  onPairingCode?: (code: string) => void;
  /** Si se da y la sesión aún no está vinculada, recibe cada código QR (cambia cada ~20 s). */
  onQr?: (qr: string) => void;
}

const SEND_WAIT_MS = 15_000;
/** Cuánto espera `stop()` a que salgan los avisos pendientes. */
const FLUSH_WAIT_MS = 5_000;
/** Ids de mensajes recordados (enviados por el robot y órdenes ya atendidas). */
const SEEN_IDS_MAX = 200;
const RECONNECT_MS = 5_000;
/** Órdenes más viejas que esto (por ejemplo, entregadas tras una desconexión) se ignoran. */
const STALE_COMMAND_SECONDS = 60;

/**
 * `libsignal` (dependencia de Baileys) imprime en consola cada cambio de sesión
 * cifrada, incluidas las claves. Se descartan esos mensajes y solo esos.
 */
const SIGNAL_NOISE = /^(Closing session|Opening session|Removing old closed session|Migrating session|Session already (closed|open)|Decrypted message with closed session)/;

let signalNoiseHidden = false;
export function hideSignalNoise(target: Pick<Console, "info" | "warn"> = console): void {
  if (signalNoiseHidden && target === console) return;
  if (target === console) signalNoiseHidden = true;
  for (const method of ["info", "warn"] as const) {
    const original = target[method].bind(target);
    target[method] = (...args: unknown[]) => {
      if (typeof args[0] === "string" && SIGNAL_NOISE.test(args[0])) return;
      original(...args);
    };
  }
}

const silent: Logger = {
  level: "silent",
  child: () => silent,
  trace() {},
  debug() {},
  info() {},
  warn() {},
  error() {},
};

/** Con `BOT_WHATSAPP_DEBUG=true` se ven los avisos y errores internos de la librería (sin contenido de mensajes). */
function debugLogger(log: (message: string) => void): Logger {
  const line = (level: string) => (obj: unknown, msg?: string) => {
    const detail = obj instanceof Error ? obj.message : typeof obj === "string" ? obj : JSON.stringify(obj)?.slice(0, 300);
    log(`WhatsApp[${level}]: ${msg ?? ""} ${msg ? "" : (detail ?? "")}`.trim());
  };
  const logger: Logger = {
    level: "warn",
    child: () => logger,
    trace() {},
    debug() {},
    info() {},
    warn: line("warn"),
    error: line("error"),
  };
  return logger;
}

/**
 * Avisos y órdenes por WhatsApp con Baileys (librería NO oficial: WhatsApp puede
 * restringir la cuenta vinculada). El robot solo escribe en el chat del propio
 * responsable («Tú») y solo obedece mensajes enviados desde su misma cuenta.
 */
export class WhatsAppNotifier implements Notifier {
  private socket: Socket | null = null;
  private open = false;
  private stopped = false;
  private blocked = false;
  private pairingRequested = false;
  private handler: IncomingHandler | null = null;
  private readonly sentIds = new BoundedSet(SEEN_IDS_MAX);
  private readonly handledIds = new BoundedSet(SEEN_IDS_MAX);
  private readonly openWaiters: (() => void)[] = [];
  /** Avisos en orden; `notify` solo encola, para no frenar el ciclo del robot si WhatsApp está caído. */
  private outbox: Promise<void> = Promise.resolve();
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(private readonly options: WhatsAppOptions) {}

  private get target(): string {
    return `${this.options.phone}@s.whatsapp.net`;
  }

  async start(onIncoming: IncomingHandler): Promise<void> {
    this.handler = onIncoming;
    await this.connect();
  }

  /** Espera a que la conexión esté abierta; `false` si no se logró a tiempo. */
  ready(timeoutMs: number): Promise<boolean> {
    if (this.open) return Promise.resolve(true);
    return new Promise((resolve) => {
      const waiter = () => {
        clearTimeout(timer);
        resolve(true);
      };
      const timer = setTimeout(() => {
        const index = this.openWaiters.indexOf(waiter);
        if (index >= 0) this.openWaiters.splice(index, 1);
        resolve(false);
      }, timeoutMs);
      this.openWaiters.push(waiter);
    });
  }

  /** Encola el aviso y vuelve de inmediato; el envío ocurre en segundo plano y nunca lanza. */
  async notify(text: string): Promise<void> {
    this.outbox = this.outbox.then(() => this.send(text));
  }

  async stop(): Promise<void> {
    // Da un momento a los avisos pendientes (por ejemplo, el de «se detuvo») antes de cerrar.
    await Promise.race([this.outbox, new Promise((resolve) => setTimeout(resolve, FLUSH_WAIT_MS))]);
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    // Deja terminar el guardado de la sesión, que es asíncrono.
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    this.socket?.end(undefined);
    this.socket = null;
  }

  private async send(text: string): Promise<void> {
    if (this.blocked || this.stopped) return;
    try {
      if (!(await this.ready(SEND_WAIT_MS)) || !this.socket) {
        this.options.log("WhatsApp: sin conexión, no se pudo enviar el aviso.");
        return;
      }
      const sent = await this.socket.sendMessage(this.target, { text });
      if (sent?.key.id) this.sentIds.add(sent.key.id);
    } catch (error) {
      this.options.log(`WhatsApp: no se pudo enviar el aviso (${error instanceof Error ? error.message : String(error)}).`);
    }
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    hideSignalNoise();
    const baileys: Baileys = await import("@whiskeysockets/baileys");
    const { state, saveCreds } = await baileys.useMultiFileAuthState(this.options.authDir);
    // La versión de WhatsApp Web integrada puede quedar vieja y WhatsApp rechaza la vinculación.
    const latest = await baileys.fetchLatestWaWebVersion().catch(() => null);
    this.options.log(
      latest && !latest.error
        ? `WhatsApp: usando la versión ${latest.version.join(".")}.`
        : "WhatsApp: no se pudo consultar la versión más reciente; se usa la integrada.",
    );
    const socket = baileys.default({
      ...(latest && !latest.error ? { version: latest.version } : {}),
      auth: state,
      logger: process.env.BOT_WHATSAPP_DEBUG === "true" ? debugLogger(this.options.log) : silent,
      browser: baileys.Browsers.ubuntu("Robot RRHH"),
      syncFullHistory: false,
      markOnlineOnConnect: false,
    });
    this.socket = socket;
    socket.ev.on("creds.update", saveCreds);

    socket.ev.on("connection.update", (update) => {
      if (update.qr && !state.creds.registered) this.options.onQr?.(update.qr);
      if (update.qr && !state.creds.registered && this.options.onPairingCode && !this.pairingRequested) {
        this.pairingRequested = true;
        socket
          .requestPairingCode(this.options.phone)
          .then((code) => this.options.onPairingCode?.(code))
          .catch((error) => this.options.log(`WhatsApp: no se pudo pedir el código (${String(error)}).`));
      }
      if (update.connection && update.connection !== "open") this.options.log(`WhatsApp: conexión ${update.connection}.`);
      if (update.connection === "open") {
        if (!this.ownsPhone(baileys, socket)) {
          this.blocked = true;
          this.options.log("WhatsApp: la cuenta vinculada no coincide con BOT_NOTIFY_PHONE. Avisos desactivados.");
          socket.end(undefined);
          return;
        }
        this.open = true;
        this.openWaiters.splice(0).forEach((resolve) => resolve());
      }
      if (update.connection === "close") {
        this.open = false;
        // Baileys entrega un `Boom` (de @hapi/boom, que no es dependencia directa): basta su forma.
        const failure = update.lastDisconnect?.error as { message?: string; output?: { statusCode?: number } } | undefined;
        const status = failure?.output?.statusCode;
        this.options.log(`WhatsApp: conexión cerrada (código ${status ?? "?"}: ${failure?.message ?? "sin detalle"}).`);
        if (status === baileys.DisconnectReason.loggedOut) {
          this.blocked = true;
          this.options.log("WhatsApp: la sesión se cerró. Vuelva a vincular con «npm run bot:whatsapp-login».");
        } else if (!this.stopped && !this.blocked) {
          this.reconnectTimer = setTimeout(
            () => this.connect().catch((error) => this.options.log(`WhatsApp: ${String(error)}`)),
            RECONNECT_MS,
          );
        }
      }
    });

    socket.ev.on("messages.upsert", ({ messages, type }) => {
      if (type !== "notify") return;
      for (const message of messages) {
        void this.onMessage(baileys, socket, message);
      }
    });
  }

  /** Verifica, cuando se conoce, que la cuenta vinculada sea la del responsable. */
  private ownsPhone(baileys: Baileys, socket: Socket): boolean {
    const me = socket.user;
    const known = [me?.phoneNumber, me?.id]
      .filter((jid): jid is string => Boolean(jid) && !baileys.isLidUser(jid))
      .map((jid) => baileys.jidNormalizedUser(jid).split("@")[0]);
    if (known.length === 0) {
      // WhatsApp a veces identifica la cuenta solo con un LID: no hay número con qué comparar.
      this.options.log("WhatsApp: no se pudo verificar que la cuenta vinculada sea BOT_NOTIFY_PHONE (sin número en la sesión).");
      return true;
    }
    return known.includes(this.options.phone);
  }

  private async onMessage(baileys: Baileys, socket: Socket, message: WAMessage) {
    try {
      const chat = message.key.remoteJid;
      const me = socket.user;
      const ownChat = [this.target, me?.id, me?.lid, me?.phoneNumber].some(
        (jid) => jid && chat && baileys.areJidsSameUser(jid, chat),
      );
      // Solo órdenes escritas por el responsable desde su propia cuenta, en su propio chat, recientes y no atendidas.
      const accepted = acceptMessage({
        fromMe: Boolean(message.key.fromMe),
        id: message.key.id,
        ownChat,
        timestampSeconds: Number(message.messageTimestamp ?? 0),
        nowSeconds: Math.floor(Date.now() / 1000),
        sentIds: this.sentIds,
        handledIds: this.handledIds,
      });
      if (!accepted) return;
      const incoming = parseIncoming(message.message?.conversation ?? message.message?.extendedTextMessage?.text);
      if (!incoming || !this.handler) return;
      await this.send(await this.handler(incoming));
    } catch (error) {
      // Un mensaje raro nunca debe tumbar el proceso del robot.
      this.options.log(`WhatsApp: no se pudo atender la orden (${error instanceof Error ? error.message : String(error)}).`);
    }
  }
}

/** Conjunto con tope: conserva solo los últimos `max` elementos. */
export class BoundedSet {
  private readonly items = new Set<string>();
  constructor(private readonly max: number) {}
  has(value: string): boolean {
    return this.items.has(value);
  }
  add(value: string): void {
    this.items.delete(value);
    this.items.add(value);
    if (this.items.size > this.max) this.items.delete(this.items.values().next().value as string);
  }
}

export interface AcceptInput {
  fromMe: boolean;
  id: string | null | undefined;
  /** El mensaje está en el chat del propio responsable («Tú»). */
  ownChat: boolean;
  timestampSeconds: number;
  nowSeconds: number;
  sentIds: BoundedSet;
  handledIds: BoundedSet;
}

/**
 * Decide si un mensaje entrante puede ser una orden: lo escribió el responsable
 * desde su cuenta, en su chat, no es un aviso del propio robot, no se atendió ya
 * y no es viejo (por ejemplo, entregado tras una caída de la red). Marca el id
 * como atendido cuando lo acepta.
 */
export function acceptMessage(input: AcceptInput): boolean {
  const { id } = input;
  if (!input.fromMe || !input.ownChat || !id) return false;
  if (input.sentIds.has(id) || input.handledIds.has(id)) return false;
  if (input.nowSeconds - input.timestampSeconds > STALE_COMMAND_SECONDS) return false;
  input.handledIds.add(id);
  return true;
}

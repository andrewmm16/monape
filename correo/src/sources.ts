import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { ImapFlow } from "imapflow";

export interface RawMail {
  raw: Buffer;
}

/**
 * De dónde salen los correos. Permite probar el proceso sin red.
 * `isKnown` recibe el Message-ID (sin <>) y permite no bajar de nuevo lo ya procesado;
 * es solo una optimización: `processMail` vuelve a comprobarlo.
 */
export interface MailSourceLike {
  fetchNew(isKnown: (messageId: string) => boolean): AsyncIterable<RawMail>;
}

/** Solo se miran los correos recientes del buzón; lo anterior no se vuelve a leer. */
const LOOKBACK_DAYS = 30;

/**
 * Buzón IMAP en SOLO LECTURA: se abre con `readOnly` (EXAMINE) y solo se usan
 * búsqueda y lectura. Nunca se borra, mueve ni marca ningún correo.
 */
export class ImapSource implements MailSourceLike {
  constructor(
    private readonly options: { host: string; port: number; secure: boolean; user: string; password: string; mailbox: string },
  ) {}

  async *fetchNew(isKnown: (messageId: string) => boolean): AsyncGenerator<RawMail> {
    const client = new ImapFlow({
      host: this.options.host,
      port: this.options.port,
      secure: this.options.secure,
      auth: { user: this.options.user, pass: this.options.password },
      // Sin registro interno: sus líneas pueden incluir direcciones y asuntos.
      logger: false,
    });
    // Sin este oyente, un corte de conexión lanzaría una excepción no capturada.
    client.on("error", () => {});
    await client.connect();
    try {
      const lock = await client.getMailboxLock(this.options.mailbox, { readOnly: true });
      try {
        const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
        const uids = (await client.search({ since }, { uid: true })) || [];
        for (const uid of uids) {
          const header = await client.fetchOne(String(uid), { envelope: true }, { uid: true });
          if (!header) continue;
          const messageId = (header.envelope?.messageId ?? "").replace(/^<|>$/g, "").trim();
          if (messageId && isKnown(messageId)) continue;
          const message = await client.fetchOne(String(uid), { source: true }, { uid: true });
          if (message && message.source) yield { raw: message.source };
        }
      } finally {
        lock.release();
      }
    } finally {
      await client.logout().catch(() => {});
    }
  }
}

/** Archivos .eml de una carpeta (por ejemplo, correos reenviados como adjunto). Solo lee. */
export class FolderSource implements MailSourceLike {
  constructor(private readonly folder: string) {}

  async *fetchNew(): AsyncGenerator<RawMail> {
    const names = readdirSync(this.folder)
      .filter((name) => name.toLowerCase().endsWith(".eml"))
      .sort();
    for (const name of names) {
      yield { raw: readFileSync(path.join(this.folder, name)) };
    }
  }
}

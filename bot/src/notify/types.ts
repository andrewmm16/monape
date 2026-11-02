import type { Incoming } from "./commands";

/** Responde a lo que la persona escribió; el texto devuelto se envía de vuelta. */
export type IncomingHandler = (incoming: Incoming) => string | Promise<string>;

/**
 * Canal para avisar a la persona responsable y recibir órdenes de una lista
 * cerrada. Hoy hay una implementación (WhatsApp con Baileys); se puede cambiar
 * por la API oficial o Telegram sin tocar el robot. `notify` nunca lanza ni
 * bloquea: si el canal falla, el robot sigue trabajando.
 */
export interface Notifier {
  start(onIncoming: IncomingHandler): Promise<void>;
  notify(text: string): Promise<void>;
  stop(): Promise<void>;
}

/** Cuando no hay canal configurado: no avisa ni recibe nada. */
export class NullNotifier implements Notifier {
  async start() {}
  async notify() {}
  async stop() {}
}

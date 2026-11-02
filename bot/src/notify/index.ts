import type { BotConfig } from "../config";
import { NullNotifier, type Notifier } from "./types";
import { WhatsAppNotifier } from "./whatsapp";

/** WhatsApp si `BOT_NOTIFY_PHONE` está definido; si no, no se avisa por mensajería. */
export function createNotifier(config: BotConfig, log: (message: string) => void): Notifier {
  if (!config.notifyPhone) return new NullNotifier();
  return new WhatsAppNotifier({ authDir: config.whatsappAuthDir, phone: config.notifyPhone, log });
}

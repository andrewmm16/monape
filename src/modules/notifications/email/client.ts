import "server-only";
import { Resend } from "resend";
import { logServerError } from "@/lib/errors";
import { getEmailAvailability } from "./config";

export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  text: string;
  tags?: { name: string; value: string }[];
  /** Adónde llegan las respuestas (el remitente técnico puede no recibir correo). */
  replyTo?: string;
};

export type SendEmailResult = { sent: true } | { sent: false; reason?: string };

let client: Resend | undefined;
let clientKey: string | undefined;

/** Cliente creado perezosamente, solo cuando el envío está disponible. */
function getClient(apiKey: string): Resend {
  if (!client || clientKey !== apiKey) {
    client = new Resend(apiKey);
    clientKey = apiKey;
  }
  return client;
}

/**
 * Envía un correo con Resend. Nunca lanza: un fallo de correo no debe romper el
 * flujo que lo llama. No registra la dirección ni el contenido.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  try {
    const availability = getEmailAvailability();
    if (!availability.available) {
      console.debug(`[email.send] omitido: ${availability.reason}`);
      return { sent: false, reason: availability.reason };
    }
    const { error } = await getClient(availability.apiKey).emails.send({
      from: availability.from,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
      tags: input.tags,
      ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    });
    if (error) {
      logServerError("email.send", { code: error.name });
      return { sent: false };
    }
    return { sent: true };
  } catch (error) {
    logServerError("email.send", error);
    return { sent: false };
  }
}

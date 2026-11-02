import type { PortalTemplate } from "./types";

/**
 * Plantilla FICTICIA para las pruebas. El formato está INVENTADO: no corresponde a
 * ningún portal real. Solo se activa con MAIL_ENABLE_EXAMPLE=1.
 *
 * Asunto:  [EJEMPLO] Nueva postulación
 * Cuerpo:  líneas «Oferta: …», «Nombre: …», «Correo: …» y «Telefono: …»
 */
function line(text: string, label: string): string | undefined {
  const match = new RegExp(`^${label}:[ \\t]*(.+)$`, "im").exec(text);
  return match?.[1]?.trim() || undefined;
}

export const ejemploFicticio: PortalTemplate = {
  portal: "ejemplo",
  senderDomains: ["avisos.ejemplo.test"],
  matches: (mail) => mail.subject.startsWith("[EJEMPLO] Nueva postulación"),
  extract: (mail) => {
    const offerRef = line(mail.text, "Oferta");
    const fullName = line(mail.text, "Nombre");
    if (!offerRef || !fullName) return null;
    return { offerRef, fullName, email: line(mail.text, "Correo"), phone: line(mail.text, "Telefono") };
  },
};

import { describe, expect, it } from "vitest";
import { buildTalentInvitationEmail } from "@/modules/notifications/email/templates/talent-invitation";
import { publicVacancyUrl, type PublicVacancyLinkInput } from "@/modules/public-jobs/link";

const URL = "https://empleos.ejemplo.pe/empleos/desarrollador-full-stack-abcdefghij";

describe("buildTalentInvitationEmail", () => {
  it("usa el texto por defecto con el nombre, la vacante y la empresa", () => {
    const email = buildTalentInvitationEmail({ fullName: "Valeria Ríos", vacancyTitle: "Desarrollador Full Stack", companyName: "Iterruptivo" });
    expect(email.subject).toBe("Una nueva oportunidad que encaja con tu perfil");
    expect(email.text).toContain("Hola Valeria Ríos,");
    expect(email.text).toContain("Participaste en un proceso anterior con Iterruptivo y se abrió la vacante «Desarrollador Full Stack»");
    expect(email.text).toContain("responde a este correo");
    expect(email.text).toContain("Recursos Humanos · Iterruptivo");
    expect(email.html).toContain(">Iterruptivo</p>");
  });

  it("siempre agrega la nota final con por qué recibe el correo y cómo pedir la baja", () => {
    const email = buildTalentInvitationEmail({ fullName: "Ana", vacancyTitle: "Contador", companyName: "Iterruptivo" });
    const footer =
      "Te escribimos porque participaste en un proceso de selección con Iterruptivo y tus datos están en su base de talentos. Si no quieres recibir más avisos como este, responde a este correo indicándolo y te retiraremos de la base.";
    expect(email.text).toContain(footer);
    expect(email.html).toContain(footer);
  });

  it("con enlace público agrega el botón «Ver la vacante»; sin enlace no", () => {
    const withLink = buildTalentInvitationEmail({ fullName: "Ana", vacancyTitle: "Contador", vacancyUrl: URL });
    expect(withLink.html).toContain(`href="${URL}"`);
    expect(withLink.html).toContain("Ver la vacante</a>");
    expect(withLink.text).toContain(`Ver la vacante: ${URL}`);

    const withoutLink = buildTalentInvitationEmail({ fullName: "Ana", vacancyTitle: "Contador", vacancyUrl: null });
    expect(withoutLink.html).not.toContain("Ver la vacante");
    expect(withoutLink.text).not.toContain("Ver la vacante");
  });

  it("descarta enlaces que no son http(s)", () => {
    const email = buildTalentInvitationEmail({ fullName: "Ana", vacancyTitle: "Contador", vacancyUrl: "javascript:alert(1)" });
    expect(email.html).not.toContain("javascript:");
    expect(email.html).not.toContain("Ver la vacante");
  });

  it("usa la plantilla editada por RRHH con sus variables y escapa el HTML", () => {
    const email = buildTalentInvitationEmail({
      fullName: "Ana <b>",
      vacancyTitle: "Contador",
      companyName: "Iterruptivo",
      template: { subject: "{{nombre}}, mira {{vacante}}", body: "Primer párrafo de {{empresa}}.\n\nSegundo <script> párrafo." },
    });
    expect(email.subject).toBe("Ana <b>, mira la vacante «Contador»");
    expect(email.html).toContain("<p>Primer párrafo de Iterruptivo.</p>");
    expect(email.html).toContain("Segundo &lt;script&gt; párrafo.");
    expect(email.html).toContain("Hola Ana &lt;b&gt;,");
    expect(email.html).not.toContain("<script>");
  });

  it("sin empresa configurada usa un texto neutro y no deja variables sin resolver", () => {
    const email = buildTalentInvitationEmail({ fullName: "", vacancyTitle: "Contador" });
    expect(email.text).toContain("Hola postulante,");
    expect(email.text).toContain("con nuestro equipo de Recursos Humanos");
    expect(email.text).not.toContain("{{");
    expect(email.html).not.toContain("color:#0b7a4b\">");
  });
});

describe("publicVacancyUrl", () => {
  const base: PublicVacancyLinkInput = {
    title: "Desarrollador Full Stack",
    status: "publicada",
    is_confidential: false,
    public_code: "abcdefghij",
    description: "Desarrollo de aplicaciones web de punta a punta para los productos internos.",
    employment_type: "tiempo_completo",
    modality: "remoto",
    city: null,
    region: null,
    closing_date: null,
  };

  it("arma la dirección pública de una vacante publicada y completa", () => {
    expect(publicVacancyUrl(base, "https://empleos.ejemplo.pe/")).toBe(URL);
  });

  it("no hay enlace si la parte pública está apagada o la vacante no se muestra", () => {
    expect(publicVacancyUrl(base, null)).toBeNull();
    expect(publicVacancyUrl({ ...base, status: "borrador" }, "https://e.pe")).toBeNull();
    expect(publicVacancyUrl({ ...base, is_confidential: true }, "https://e.pe")).toBeNull();
    expect(publicVacancyUrl({ ...base, public_code: null }, "https://e.pe")).toBeNull();
    expect(publicVacancyUrl({ ...base, description: "corta" }, "https://e.pe")).toBeNull();
    expect(publicVacancyUrl({ ...base, closing_date: "2000-01-01" }, "https://e.pe")).toBeNull();
  });
});

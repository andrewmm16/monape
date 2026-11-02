import type { Page } from "@playwright/test";
import { ERROR_CODES, PortalError } from "../errors";
import { AVISO_COOKIES, estricto, registerBook, tolerante } from "../selectors";
import type { ActivePublication, ApplicantSummary, PublishResult, VacancyData } from "../types";
import { DEMO_COMPANY, DEMO_CONTACT_EMAIL, FakeSiteAdapter, HEALTH_VACANCY, contractOf, descriptionOf, locationOf, modalityOf, questionOf } from "./fake-base";

/**
 * Libro de selectores de «Linkedin (simulación)». Tolerantes: campos, navegación y lectura de
 * candidatos; estrictos: «Publicar empleo», «Cerrar empleo» y las marcas de resultado (ver `selectors.ts`).
 */
export const LINKEDIN_BOOK = registerBook("linkedin", {
  captcha: estricto("Aviso de verificación humana (CAPTCHA)", "#challenge-dialog"),
  aviso_cookies: AVISO_COOKIES,
  campo_titulo: tolerante("Campo del cargo (título del empleo)", "#li-titulo", [{ etiqueta: ["Cargo", "Título", "Titulo", "Puesto"] }, { css: "[name^=titulo]" }]),
  campo_empresa: tolerante("Campo de la empresa", "#li-empresa", [{ etiqueta: ["Empresa"] }, { css: "[name^=empresa]" }]),
  campo_ubicacion: tolerante("Campo de la ubicación del empleo", "#li-ubicacion", [{ etiqueta: ["Ubicación", "Ubicacion"] }, { css: "[name^=ubicacion]" }]),
  campo_modalidad: tolerante("Lista de la modalidad del lugar de trabajo", "#li-modalidad", [{ etiqueta: ["Modalidad"] }, { css: "[name^=modalidad]" }]),
  campo_contrato: tolerante("Lista del tipo de empleo", "#li-contrato", [{ etiqueta: ["Tipo de empleo", "Contrato"] }, { css: "[name^=contrato]" }]),
  campo_descripcion: tolerante("Campo de la descripción del empleo", "#li-descripcion", [{ etiqueta: ["Descripción del empleo", "Descripcion del empleo", "Descripción"] }, { css: "[name^=descripcion]" }]),
  campo_pregunta_1: tolerante("Pregunta de selección 1", "#li-pregunta-1", [{ etiqueta: ["Pregunta de selección 1", "Pregunta de seleccion 1"] }, { css: "[name^=pregunta1]" }]),
  campo_pregunta_2: tolerante("Pregunta de selección 2", "#li-pregunta-2", [{ etiqueta: ["Pregunta de selección 2", "Pregunta de seleccion 2"] }, { css: "[name^=pregunta2]" }]),
  campo_recepcion_plataforma: tolerante("Opción de recibir candidatos por la plataforma", "#li-recepcion-plataforma", [
    { etiqueta: ["Esta plataforma", "Postulación sencilla", "Postulacion sencilla"] },
  ]),
  campo_correo: tolerante("Campo del correo de contacto", "#li-correo", [{ etiqueta: ["Correo de contacto"] }, { css: "[name^=correo]" }]),
  boton_siguiente: tolerante("Botón «Siguiente» del asistente", "#li-siguiente", [{ rol: "button", nombre: ["Siguiente", "Continuar", "Next"] }]),
  boton_atras: tolerante("Botón «Atrás» del asistente", "#li-atras", [{ rol: "button", nombre: ["Atrás", "Atras", "Volver", "Back"] }]),
  boton_enviar: estricto("Botón «Publicar empleo»", "#li-publicar"),
  marca_paso: estricto("Marca del paso {n} del asistente", "#li-paso-{n}"),
  resumen_revision: tolerante("Resumen de la revisión (paso 4)", "#li-paso-4 dl.resumen", [{ css: "dl.resumen" }]),
  resultado_publicada: estricto("Título de la oferta publicada", "#li-publicada"),
  resultado_error: estricto("Mensaje de error al publicar", "#li-error"),
  panel_ofertas: tolerante("Lista de empleos del empleador", "#li-lista-empleos", [{ css: "[id*='empleos']" }]),
  enlace_ver_candidatos: tolerante("Enlace «Ver candidatos» de cada empleo", "a.li-ver-candidatos", [
    { css: "a[href$='/candidatos']" },
    { rol: "link", nombre: ["Ver candidatos"] },
  ]),
  lista_postulantes: tolerante("Lista de candidatos", "#li-candidatos", [{ css: "[id*='candidatos']" }]),
  fila_postulante: tolerante("Fila de un candidato", "#li-candidatos li.candidato", [{ css: "li.candidato" }, { css: "#li-candidatos > li" }]),
  enlace_cv: tolerante("Enlace al CV del candidato", "a.c-cv", [{ css: "a[href*='/cv/']" }, { rol: "link", nombre: ["Descargar CV", "Currículum", "Curriculum", "Hoja de vida"] }]),
  postulante_nombre: tolerante("Nombre del candidato", ".c-nombre", [{ css: "[class*='nombre']" }]),
  postulante_correo: tolerante("Correo del candidato", ".c-correo", [{ css: "[class*='correo']" }, { css: "[class*='mail']" }]),
  postulante_telefono: tolerante("Teléfono del candidato", ".c-telefono", [{ css: "[class*='telefono']" }]),
  boton_retirar: estricto("Botón «Cerrar empleo»", "#li-cerrar"),
  estado_oferta: estricto("Estado del empleo", "#li-estado"),
});

/**
 * «Linkedin (simulación)»: portal ficticio con asistente de 4 pasos para publicar
 * (detalles → descripción y preguntas → cómo recibir candidatos → revisar y publicar).
 */
export class FakeLinkedinAdapter extends FakeSiteAdapter {
  readonly slug = "linkedin";
  protected readonly sitePath = "/linkedin";
  protected readonly externalOrigin = "https://linkedin.fake.test";

  /** Pulsa «Siguiente» y espera a estar en el paso indicado. */
  private async next(page: Page, step: number): Promise<void> {
    await this.clickKey(page, "boton_siguiente");
    await page.locator(`${this.sel("marca_paso", { n: step })}, ${this.sel("captcha")}`).first().waitFor();
    await this.guard(page);
  }

  /**
   * Rellena el asistente paso a paso hasta el 4 («Revisar y publicar») SIN pulsar «Publicar empleo».
   * Con `check`, además verifica en cada paso que estén los botones de navegación que usa `publish`
   * (los campos se verifican al rellenarlos).
   */
  private async fillWizard(page: Page, vacancy: VacancyData, check: boolean): Promise<void> {
    // 1. Detalles del empleo
    if (check) await this.requireKeys(page, ["boton_siguiente"], "el paso 1 del asistente");
    await this.fillField(page, "campo_titulo", vacancy.title);
    await this.fillField(page, "campo_empresa", DEMO_COMPANY);
    await this.fillField(page, "campo_ubicacion", locationOf(vacancy));
    await this.selectField(page, "campo_modalidad", modalityOf(vacancy.modality));
    await this.selectField(page, "campo_contrato", contractOf(vacancy.contract_type));
    await this.next(page, 2);

    // 2. Descripción y preguntas de selección
    if (check) await this.requireKeys(page, ["boton_atras", "boton_siguiente"], "el paso 2 del asistente");
    await this.fillField(page, "campo_descripcion", descriptionOf(vacancy));
    await this.fillField(page, "campo_pregunta_1", questionOf(vacancy, 0));
    await this.fillField(page, "campo_pregunta_2", questionOf(vacancy, 1));
    await this.next(page, 3);

    // 3. Cómo recibir candidatos: por la plataforma (Postulación sencilla)
    if (check) await this.requireKeys(page, ["boton_atras", "boton_siguiente"], "el paso 3 del asistente");
    await this.checkField(page, "campo_recepcion_plataforma");
    await this.fillField(page, "campo_correo", DEMO_CONTACT_EMAIL);
    await this.next(page, 4);
  }

  healthCheck(): Promise<void> {
    return this.withPage(async (page) => {
      // El asistente no guarda nada en el portal hasta pulsar «Publicar empleo», que aquí NO se pulsa:
      // se recorre en una pestaña nueva con datos de prueba y se cierra sin enviar.
      await this.withScratchPage(async (scratch) => {
        await scratch.goto(`${this.root}/empleos/publicar`);
        await this.guard(scratch);
        await this.fillWizard(scratch, HEALTH_VACANCY, true);
        await this.requireKeys(scratch, ["resumen_revision", "boton_atras"], "el paso 4 del asistente");
        await this.assertSubmittable(scratch, "el paso 4 del asistente");
        // «Atrás» también forma parte de la navegación del asistente.
        await this.clickKey(scratch, "boton_atras");
        await scratch.locator(this.sel("marca_paso", { n: 3 })).waitFor();
      });

      await this.checkOfferScreens(page, { homePath: "/linkedin/empleos", closeText: "Cerrar empleo" });
    });
  }

  publish(vacancy: VacancyData): Promise<PublishResult> {
    return this.withPage(async (page) => {
      await page.goto(`${this.root}/empleos/publicar`);
      await this.guard(page);
      await this.fillWizard(page, vacancy, false);

      // 4. Revisar y publicar
      await this.clickKey(page, "boton_enviar");
      await page.locator(`${this.sel("resultado_publicada")}, ${this.sel("resultado_error")}, ${this.sel("captcha")}`).first().waitFor();
      await this.guard(page);

      if ((await page.locator(this.sel("resultado_error")).count()) > 0) throw new PortalError(ERROR_CODES.publicationRejected);
      return this.published(this.jobIdFromUrl(page, /\/empleos\/([^/]+)$/), "/empleos/:id");
    });
  }

  withdraw(externalId: string): Promise<void> {
    return this.withPage((page) => this.closeJob(page, `/linkedin/empleos/${encodeURIComponent(externalId)}`, "Cerrado"));
  }

  listApplicants(publication: ActivePublication): Promise<ApplicantSummary[]> {
    return this.withPage(async (page) => {
      await page.goto(`${this.root}/empleos/${encodeURIComponent(publication.externalId ?? "")}/candidatos`);
      await this.guard(page, { offer: true });
      return this.readApplicants(page, "data-candidato-id", "selectors");
    });
  }
}

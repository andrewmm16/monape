import type { Page } from "@playwright/test";
import { ERROR_CODES, PortalError } from "../errors";
import { AVISO_COOKIES, estricto, registerBook, tolerante } from "../selectors";
import type { ActivePublication, ApplicantSummary, PublishResult, VacancyData } from "../types";
import { DEMO_COMPANY, DEMO_CONTACT_EMAIL, FakeSiteAdapter, HEALTH_VACANCY, descriptionOf, locationOf } from "./fake-base";

/**
 * Libro de selectores de «Indeed (simulación)». Tolerantes: campos, navegación y lectura de
 * candidatos; estrictos: «Publicar empleo», «Cerrar empleo» y las marcas de resultado (ver `selectors.ts`).
 */
export const INDEED_BOOK = registerBook("indeed", {
  captcha: estricto("Aviso de verificación humana (CAPTCHA)", "#cf-challenge"),
  aviso_cookies: AVISO_COOKIES,
  campo_titulo: tolerante("Campo del título del empleo", "#input-jobtitle", [{ etiqueta: ["Título del empleo", "Titulo del empleo", "Título", "Cargo", "Puesto"] }, { css: "[name^=jobtitle]" }]),
  campo_empresa: tolerante("Campo del nombre de la empresa", "#input-companyname", [{ etiqueta: ["Nombre de la empresa", "Empresa"] }, { css: "[name^=companyname]" }]),
  campo_ubicacion: tolerante("Campo de la ciudad", "#input-jobcity", [{ etiqueta: ["Ciudad", "Ubicación", "Ubicacion"] }, { css: "[name^=jobcity]" }]),
  campo_descripcion: tolerante("Campo de la descripción completa", "#input-jobdesc", [{ etiqueta: ["Descripción completa", "Descripción", "Descripcion"] }, { css: "[name^=jobdesc]" }]),
  campo_correo: tolerante("Campo del correo para recibir candidatos", "#input-applyemail", [{ etiqueta: ["Correo para recibir candidatos", "Correo"] }, { css: "[name^=applyemail]" }]),
  boton_siguiente: tolerante("Botón «Continuar»", "[data-testid=continuar]", [{ rol: "button", nombre: ["Continuar", "Siguiente", "Next"] }]),
  boton_atras: tolerante("Botón «Volver»", "[data-testid=volver]", [{ rol: "button", nombre: ["Volver", "Atrás", "Atras", "Back"] }]),
  boton_enviar: estricto("Botón «Publicar empleo»", "[data-testid=publicar-empleo]"),
  marca_paso: estricto("Marca del paso {n} de publicar", "[data-testid=paso-{n}]"),
  resultado_publicada: estricto("Título del empleo publicado", "[data-testid=job-title]"),
  resultado_error: estricto("Mensaje de error al publicar", "[data-testid=error-publicacion]"),
  panel_ofertas: tolerante("Lista de empleos del empleador", "[data-testid=employer-jobs]", [{ css: "[data-testid*='jobs']" }]),
  enlace_ver_candidatos: tolerante("Enlace «Ver candidatos» de cada empleo", "a[data-testid=ver-candidatos]", [
    { css: "a[href$='/candidatos']" },
    { rol: "link", nombre: ["Ver candidatos"] },
  ]),
  lista_postulantes: tolerante("Lista de candidatos", "[data-testid=candidates]", [{ css: "[data-testid*='candidates']" }]),
  fila_postulante: tolerante("Fila de un candidato", "[data-testid=candidate-row]", [{ css: "[data-testid*='candidate-row']" }, { css: "[data-candidate-id]" }]),
  enlace_cv: tolerante("Enlace al currículum del candidato", "[data-testid=candidate-resume]", [
    { css: "a[href*='/cv/']" },
    { rol: "link", nombre: ["Ver currículum", "Ver curriculum", "Currículum", "CV"] },
  ]),
  postulante_nombre: tolerante("Nombre del candidato", "[data-testid=candidate-name]", [{ css: "[data-testid*='candidate-name']" }]),
  postulante_correo: tolerante("Correo del candidato", "[data-testid=candidate-email]", [{ css: "[data-testid*='candidate-email']" }]),
  postulante_telefono: tolerante("Teléfono del candidato", "[data-testid=candidate-phone]", [{ css: "[data-testid*='candidate-phone']" }]),
  boton_retirar: estricto("Botón «Cerrar empleo»", "[data-testid=cerrar-empleo]"),
  estado_oferta: estricto("Estado del empleo", "[data-testid=job-status]"),
});

/** «Indeed (simulación)»: publicar en 2 pasos (describe el empleo → descripción y contacto), selectores `data-testid`. */
export class FakeIndeedAdapter extends FakeSiteAdapter {
  readonly slug = "indeed";
  protected readonly sitePath = "/indeed";
  protected readonly externalOrigin = "https://indeed.fake.test";

  private async next(page: Page): Promise<void> {
    await this.clickKey(page, "boton_siguiente");
    await page.locator(`${this.sel("marca_paso", { n: 2 })}, ${this.sel("captcha")}`).first().waitFor();
    await this.guard(page);
  }

  /**
   * Rellena los 2 pasos SIN pulsar «Publicar empleo». Con `check`, además verifica en cada paso
   * que estén los botones de navegación que usa `publish` (los campos se verifican al rellenarlos).
   */
  private async fillJob(page: Page, vacancy: VacancyData, check: boolean): Promise<void> {
    if (check) await this.requireKeys(page, ["boton_siguiente"], "el paso 1 de publicar");
    await this.fillField(page, "campo_titulo", vacancy.title);
    await this.fillField(page, "campo_empresa", DEMO_COMPANY);
    await this.fillField(page, "campo_ubicacion", locationOf(vacancy));
    await this.next(page);

    if (check) await this.requireKeys(page, ["boton_atras"], "el paso 2 de publicar");
    await this.fillField(page, "campo_descripcion", descriptionOf(vacancy));
    await this.fillField(page, "campo_correo", DEMO_CONTACT_EMAIL);
  }

  healthCheck(): Promise<void> {
    return this.withPage(async (page) => {
      // Nada se guarda hasta «Publicar empleo», que NO se pulsa: pestaña nueva, datos de prueba, se cierra sin enviar.
      await this.withScratchPage(async (scratch) => {
        await scratch.goto(`${this.root}/empleador/publicar`);
        await this.guard(scratch);
        await this.fillJob(scratch, HEALTH_VACANCY, true);
        await this.assertSubmittable(scratch, "el paso 2 de publicar");
      });

      await this.checkOfferScreens(page, { homePath: "/indeed/empleador", closeText: "Cerrar empleo" });
    });
  }

  publish(vacancy: VacancyData): Promise<PublishResult> {
    return this.withPage(async (page) => {
      await page.goto(`${this.root}/empleador/publicar`);
      await this.guard(page);
      await this.fillJob(page, vacancy, false);
      await this.clickKey(page, "boton_enviar");
      await page.locator(`${this.sel("resultado_publicada")}, ${this.sel("resultado_error")}, ${this.sel("captcha")}`).first().waitFor();
      await this.guard(page);

      if ((await page.locator(this.sel("resultado_error")).count()) > 0) throw new PortalError(ERROR_CODES.publicationRejected);
      return this.published(this.jobIdFromUrl(page, /\/empleador\/empleos\/([^/]+)$/), "/empleo/:id");
    });
  }

  withdraw(externalId: string): Promise<void> {
    return this.withPage((page) => this.closeJob(page, `/indeed/empleador/empleos/${encodeURIComponent(externalId)}`, "Cerrado"));
  }

  listApplicants(publication: ActivePublication): Promise<ApplicantSummary[]> {
    return this.withPage(async (page) => {
      await page.goto(`${this.root}/empleador/empleos/${encodeURIComponent(publication.externalId ?? "")}/candidatos`);
      await this.guard(page, { offer: true });
      return this.readApplicants(page, "data-candidate-id", "selectors");
    });
  }
}

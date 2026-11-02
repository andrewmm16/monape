import type { Page } from "@playwright/test";
import { ERROR_CODES, PortalError } from "../errors";
import { AVISO_COOKIES, estricto, registerBook, tolerante } from "../selectors";
import type { ActivePublication, ApplicantSummary, PublishResult, VacancyData } from "../types";
import { FakeSiteAdapter, HEALTH_VACANCY, descriptionOf, locationOf } from "./fake-base";

/**
 * Libro de selectores de «Computrabajo (simulación)». Tolerantes: campos y lectura de candidatos;
 * estrictos: «Publicar oferta», «Desactivar oferta» y las marcas de resultado (ver `selectors.ts`).
 */
export const COMPUTRABAJO_BOOK = registerBook("computrabajo", {
  captcha: estricto("Aviso de verificación humana (CAPTCHA)", "[data-testid=captcha]"),
  aviso_cookies: AVISO_COOKIES,
  campo_titulo: tolerante("Campo del nombre de la oferta", "#oferta_titulo", [{ etiqueta: ["Nombre de la oferta", "Título", "Titulo", "Cargo", "Puesto"] }, { css: "[name^=oferta_titulo]" }]),
  campo_categoria: tolerante("Lista de la categoría", "#oferta_categoria", [{ etiqueta: ["Categoría", "Categoria"] }, { css: "[name^=oferta_categoria]" }]),
  campo_descripcion: tolerante("Campo de la descripción de la oferta", "#oferta_descripcion", [{ etiqueta: ["Descripción de la oferta", "Descripción", "Descripcion"] }, { css: "[name^=oferta_descripcion]" }]),
  campo_ubicacion: tolerante("Campo de la ciudad", "#oferta_ciudad", [{ etiqueta: ["Ciudad", "Ubicación", "Ubicacion"] }, { css: "[name^=oferta_ciudad]" }]),
  boton_enviar: estricto("Botón «Publicar oferta»", "#oferta_publicar"),
  resultado_publicada: estricto("Título de la oferta publicada", ".titulo-oferta"),
  resultado_error: estricto("Mensaje de error al publicar", ".msg-error"),
  panel_ofertas: tolerante("Lista de ofertas de la empresa", ".ofertas-empresa", [{ css: "[class*='ofertas']" }]),
  enlace_ver_candidatos: tolerante("Enlace «Ver candidatos» de cada oferta", "a.lnk-candidatos", [
    { css: "a[href$='/candidatos']" },
    { rol: "link", nombre: ["Ver candidatos"] },
  ]),
  lista_postulantes: tolerante("Lista de candidatos", "section.lista-candidatos", [{ css: "section[class*='candidatos']" }]),
  fila_postulante: tolerante("Tarjeta de un candidato", "section.lista-candidatos article.cand", [{ css: "article.cand" }, { css: "section.lista-candidatos > article" }]),
  enlace_cv: tolerante("Enlace a la hoja de vida", "a.bajar-cv", [
    { css: "a[href*='/cv/']" },
    { rol: "link", nombre: ["Bajar hoja de vida", "Hoja de vida", "Currículum", "Curriculum", "CV"] },
  ]),
  postulante_nombre: tolerante("Nombre del candidato", "h3", [{ css: "[class*='nombre']" }]),
  postulante_correo: tolerante("Correo del candidato", ".mail", [{ css: "[class*='correo']" }]),
  postulante_telefono: tolerante("Teléfono del candidato", ".tel", [{ css: "[class*='telefono']" }]),
  boton_retirar: estricto("Botón «Desactivar oferta»", "#desactivar"),
  estado_oferta: estricto("Estado de la oferta", ".estado-oferta"),
});

/** «Computrabajo (simulación)»: formulario único de oferta (campos `oferta_*`) y candidatos en tarjetas. */
export class FakeComputrabajoAdapter extends FakeSiteAdapter {
  readonly slug = "computrabajo";
  protected readonly sitePath = "/computrabajo";
  protected readonly externalOrigin = "https://computrabajo.fake.test";

  /** Rellena el formulario único SIN pulsar «Publicar oferta» (los campos se verifican al rellenarlos). */
  private async fillOffer(page: Page, vacancy: VacancyData): Promise<void> {
    await this.fillField(page, "campo_titulo", vacancy.title);
    await this.selectField(page, "campo_categoria", "general");
    await this.fillField(page, "campo_descripcion", descriptionOf(vacancy));
    await this.fillField(page, "campo_ubicacion", locationOf(vacancy));
  }

  healthCheck(): Promise<void> {
    return this.withPage(async (page) => {
      // Nada se envía: pestaña nueva, datos de prueba, se cierra sin pulsar «Publicar oferta».
      await this.withScratchPage(async (scratch) => {
        await scratch.goto(`${this.root}/empresa/ofertas/nueva`);
        await this.guard(scratch);
        await this.fillOffer(scratch, HEALTH_VACANCY);
        await this.assertSubmittable(scratch, "el formulario de la oferta");
      });

      await this.checkOfferScreens(page, { homePath: "/computrabajo/empresa/ofertas", closeText: "Desactivar oferta" });
    });
  }

  publish(vacancy: VacancyData): Promise<PublishResult> {
    return this.withPage(async (page) => {
      await page.goto(`${this.root}/empresa/ofertas/nueva`);
      await this.guard(page);
      await this.fillOffer(page, vacancy);
      await this.clickKey(page, "boton_enviar");
      await page.locator(`${this.sel("resultado_publicada")}, ${this.sel("resultado_error")}, ${this.sel("captcha")}`).first().waitFor();
      await this.guard(page);

      if ((await page.locator(this.sel("resultado_error")).count()) > 0) throw new PortalError(ERROR_CODES.publicationRejected);
      return this.published(this.jobIdFromUrl(page, /\/empresa\/ofertas\/([^/]+)$/), "/empleo/:id");
    });
  }

  withdraw(externalId: string): Promise<void> {
    return this.withPage((page) => this.closeJob(page, `/computrabajo/empresa/ofertas/${encodeURIComponent(externalId)}`, "Desactivada"));
  }

  listApplicants(publication: ActivePublication): Promise<ApplicantSummary[]> {
    return this.withPage(async (page) => {
      await page.goto(`${this.root}/empresa/ofertas/${encodeURIComponent(publication.externalId ?? "")}/candidatos`);
      await this.guard(page, { offer: true });
      return this.readApplicants(page, "data-cid", "selectors");
    });
  }
}

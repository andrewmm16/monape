import type { BrowserContext, Page } from "@playwright/test";
import { ERROR_CODES, PortalError } from "../errors";
import { AVISO_COOKIES, estricto, registerBook, tolerante } from "../selectors";
import type { ActivePublication, ApplicantSummary, PublishResult, VacancyData } from "../types";
import { FakeSiteAdapter, HEALTH_VACANCY, locationOf } from "./fake-base";

/**
 * Libro de selectores de «Trabajos Diarios (simulación)» (también del alias `fake` de la raíz).
 * Tolerantes: campos y lectura de postulantes; estrictos: el botón de publicar y las marcas de
 * resultado (ver `selectors.ts`). Este portal retira con una petición directa: no hay botón de retirar.
 */
export const TRABAJOS_DIARIOS_BOOK = registerBook("trabajos-diarios", {
  captcha: estricto("Aviso de verificación humana (CAPTCHA)", "#captcha"),
  aviso_cookies: AVISO_COOKIES,
  campo_titulo: tolerante("Campo del título del puesto", "#titulo", [{ etiqueta: ["Título del puesto", "Título", "Titulo", "Cargo", "Puesto"] }, { css: "[name^=titulo]" }]),
  campo_descripcion: tolerante("Campo de la descripción", "#descripcion", [{ etiqueta: ["Descripción", "Descripcion"] }, { css: "[name^=descripcion]" }]),
  campo_ubicacion: tolerante("Campo de la ubicación", "#ubicacion", [{ etiqueta: ["Ubicación", "Ubicacion"] }, { css: "[name^=ubicacion]" }]),
  boton_enviar: estricto("Botón de publicar la oferta", "button[type=submit]"),
  resultado_publicada: estricto("Título de la oferta publicada", "#publicada"),
  resultado_error: estricto("Mensaje de error al publicar", "#error"),
  panel_ofertas: tolerante("Lista de ofertas del empleador", "#mis-empleos", [{ css: "[id*='empleos']" }]),
  enlace_ver_candidatos: tolerante("Enlace «Ver postulantes» de cada oferta", "a.ver-postulantes", [
    { css: "a[href$='/postulantes']" },
    { rol: "link", nombre: ["Ver postulantes"] },
  ]),
  lista_postulantes: tolerante("Tabla de postulantes", "#postulantes", [{ css: "[id*='postulantes']" }]),
  fila_postulante: tolerante("Fila de un postulante", "tr.postulante", [{ css: "#postulantes tr[data-id]" }]),
  enlace_cv: tolerante("Enlace al CV del postulante", "a.cv", [{ css: "a[href*='/cv/']" }, { rol: "link", nombre: ["CV", "Currículum", "Curriculum", "Hoja de vida"] }]),
  postulante_nombre: tolerante("Nombre del postulante", ".nombre", [{ css: "[class*='nombre']" }]),
  postulante_correo: tolerante("Correo del postulante", ".correo", [{ css: "[class*='correo']" }, { css: "[class*='mail']" }]),
  postulante_telefono: tolerante("Teléfono del postulante", ".telefono", [{ css: "[class*='telefono']" }]),
});

/**
 * Adaptador del portal falso original («Trabajos Diarios» ficticio, `src/fake-portal`):
 * una sola pantalla para publicar. Con `sitePath` vacío usa las rutas de la raíz
 * (alias histórico, adaptador `fake`); `FakeTrabajosDiariosAdapter` usa `/trabajos-diarios`.
 * Sirve de modelo para escribir los reales: solo navega el portal; no habla con la app.
 */
export class FakePortalAdapter extends FakeSiteAdapter {
  readonly slug: string = "trabajos-diarios";
  protected readonly externalOrigin: string = "https://portal-falso.test";

  constructor(
    context: BrowserContext,
    baseUrl: string,
    timeoutMs = 15_000,
    protected readonly sitePath = "",
  ) {
    super(context, baseUrl, timeoutMs);
  }

  /** Rellena el formulario SIN pulsar «publicar» (los campos se verifican al rellenarlos). */
  private async fillForm(page: Page, vacancy: VacancyData): Promise<void> {
    await this.fillField(page, "campo_titulo", vacancy.title);
    await this.fillField(page, "campo_descripcion", vacancy.description ?? "");
    await this.fillField(page, "campo_ubicacion", locationOf(vacancy));
  }

  healthCheck(): Promise<void> {
    return this.withPage(async (page) => {
      // Nada se envía: pestaña nueva, datos de prueba, se cierra sin pulsar el botón de publicar.
      await this.withScratchPage(async (scratch) => {
        await scratch.goto(`${this.root}/empleos/nuevo`);
        await this.guard(scratch);
        await this.fillForm(scratch, HEALTH_VACANCY);
        await this.assertSubmittable(scratch, "el formulario de publicar");
      });

      // Este portal retira con una petición directa (sin botón): no hay control de retiro que comprobar.
      await this.checkOfferScreens(page, { homePath: `${this.sitePath}/empleos` });
    });
  }

  publish(vacancy: VacancyData): Promise<PublishResult> {
    return this.withPage(async (page) => {
      await page.goto(`${this.root}/empleos/nuevo`);
      await this.guard(page);
      await this.fillForm(page, vacancy);
      await this.clickKey(page, "boton_enviar");
      await page.locator(`${this.sel("resultado_publicada")}, ${this.sel("resultado_error")}, ${this.sel("captcha")}`).first().waitFor();
      await this.guard(page);

      if ((await page.locator(this.sel("resultado_error")).count()) > 0) throw new PortalError(ERROR_CODES.publicationRejected);
      const id = this.jobIdFromUrl(page, /\/empleos\/([^/]+)$/);
      return this.published(id, "/empleos/:id");
    });
  }

  withdraw(externalId: string): Promise<void> {
    return this.withPage(async (page) => {
      const response = await page.request.post(`${this.root}/empleos/${encodeURIComponent(externalId)}/retirar`);
      if (new URL(response.url()).pathname === `${this.sitePath}/login`) throw new PortalError(ERROR_CODES.sessionExpired);
      if (!response.ok()) throw new PortalError(ERROR_CODES.pageChanged, `retirar respondió ${response.status()}`);
    });
  }

  listApplicants(publication: ActivePublication): Promise<ApplicantSummary[]> {
    return this.withPage(async (page) => {
      await page.goto(`${this.root}/empleos/${encodeURIComponent(publication.externalId ?? "")}/postulantes`);
      await this.guard(page, { offer: true });
      return this.readApplicants(page, "data-id", "selectors");
    });
  }
}

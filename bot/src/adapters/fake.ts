import type { BrowserContext, Page } from "@playwright/test";
import { ERROR_CODES, PortalError } from "../errors";
import type { ActivePublication, ApplicantSummary, PublishResult, VacancyData } from "../types";
import { FakeSiteAdapter, HEALTH_VACANCY, locationOf } from "./fake-base";

/**
 * Adaptador del portal falso original («Trabajos Diarios» ficticio, `src/fake-portal`):
 * una sola pantalla para publicar. Con `sitePath` vacío usa las rutas de la raíz
 * (alias histórico, adaptador `fake`); `FakeTrabajosDiariosAdapter` usa `/trabajos-diarios`.
 * Sirve de modelo para escribir los reales: solo navega el portal; no habla con la app.
 */
export class FakePortalAdapter extends FakeSiteAdapter {
  readonly slug: string = "trabajos-diarios";
  protected readonly captchaSelector = "#captcha";
  protected readonly externalOrigin: string = "https://portal-falso.test";

  constructor(
    context: BrowserContext,
    baseUrl: string,
    timeoutMs = 15_000,
    protected readonly sitePath = "",
  ) {
    super(context, baseUrl, timeoutMs);
  }

  /** Rellena el formulario SIN pulsar «publicar». Con `check`, verifica antes que estén los campos. */
  private async fillForm(page: Page, vacancy: VacancyData, check: boolean): Promise<void> {
    if (check) await this.requireAll(page, ["#titulo", "#descripcion", "#ubicacion"], "el formulario de publicar");
    await page.fill("#titulo", vacancy.title);
    await page.fill("#descripcion", vacancy.description ?? "");
    await page.fill("#ubicacion", locationOf(vacancy));
  }

  healthCheck(): Promise<void> {
    return this.withPage(async (page) => {
      // Nada se envía: pestaña nueva, datos de prueba, se cierra sin pulsar el botón de publicar.
      await this.withScratchPage(async (scratch) => {
        await scratch.goto(`${this.root}/empleos/nuevo`);
        await this.guard(scratch);
        await this.fillForm(scratch, HEALTH_VACANCY, true);
        await this.assertSubmittable(scratch, "button[type=submit]", "el formulario de publicar");
      });

      // Este portal retira con una petición directa (sin botón): no hay control de retiro que comprobar.
      await this.checkOfferScreens(page, {
        homePath: `${this.sitePath}/empleos`,
        homeSelector: "#mis-empleos",
        linkSelector: "a.ver-postulantes",
        listSelector: "#postulantes",
        rowSelector: "tr.postulante",
        resumeSelector: "a.cv",
      });
    });
  }

  publish(vacancy: VacancyData): Promise<PublishResult> {
    return this.withPage(async (page) => {
      await page.goto(`${this.root}/empleos/nuevo`);
      await this.guard(page);
      await this.fillForm(page, vacancy, false);
      await page.click("button[type=submit]");
      await page.locator(`#publicada, #error, ${this.captchaSelector}`).first().waitFor();
      await this.guard(page);

      if ((await page.locator("#error").count()) > 0) throw new PortalError(ERROR_CODES.publicationRejected);
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
      await this.guard(page);
      // «attached»: una tabla sin filas cuenta como oculta y no es un cambio de página.
      await page.locator("#postulantes").waitFor({ state: "attached" });

      // Sin funciones con nombre dentro del callback: tsx (esbuild) les agrega un
      // ayudante `__name` que no existe en el navegador y la lectura falla.
      return page.locator("tr.postulante").evaluateAll((rows) =>
        rows.map((row) => ({
          externalId: row.getAttribute("data-id") ?? "",
          fullName: row.querySelector(".nombre")?.textContent?.trim() ?? "",
          email: row.querySelector(".correo")?.textContent?.trim() || undefined,
          phone: row.querySelector(".telefono")?.textContent?.trim() || undefined,
          resumeRef: row.querySelector("a.cv")?.getAttribute("href") ?? "",
        })),
      );
    });
  }
}

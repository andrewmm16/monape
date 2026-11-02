import type { Page } from "@playwright/test";
import { ERROR_CODES, PortalError } from "../errors";
import type { ActivePublication, ApplicantSummary, PublishResult, VacancyData } from "../types";
import { DEMO_COMPANY, DEMO_CONTACT_EMAIL, FakeSiteAdapter, HEALTH_VACANCY, descriptionOf, locationOf } from "./fake-base";

/** «Indeed (simulación)»: publicar en 2 pasos (describe el empleo → descripción y contacto), selectores `data-testid`. */
export class FakeIndeedAdapter extends FakeSiteAdapter {
  readonly slug = "indeed";
  protected readonly sitePath = "/indeed";
  protected readonly captchaSelector = "#cf-challenge";
  protected readonly externalOrigin = "https://indeed.fake.test";

  private async next(page: Page): Promise<void> {
    await page.click("[data-testid=continuar]");
    await page.locator(`[data-testid=paso-2], ${this.captchaSelector}`).first().waitFor();
    await this.guard(page);
  }

  /**
   * Rellena los 2 pasos SIN pulsar «Publicar empleo». Con `check`, además verifica
   * en cada paso que estén los elementos que usa `publish`.
   */
  private async fillJob(page: Page, vacancy: VacancyData, check: boolean): Promise<void> {
    if (check) await this.requireAll(page, ["#input-jobtitle", "#input-companyname", "#input-jobcity", "[data-testid=continuar]"], "el paso 1 de publicar");
    await page.fill("#input-jobtitle", vacancy.title);
    await page.fill("#input-companyname", DEMO_COMPANY);
    await page.fill("#input-jobcity", locationOf(vacancy));
    await this.next(page);

    if (check) await this.requireAll(page, ["#input-jobdesc", "#input-applyemail", "[data-testid=volver]"], "el paso 2 de publicar");
    await page.fill("#input-jobdesc", descriptionOf(vacancy));
    await page.fill("#input-applyemail", DEMO_CONTACT_EMAIL);
  }

  healthCheck(): Promise<void> {
    return this.withPage(async (page) => {
      // Nada se guarda hasta «Publicar empleo», que NO se pulsa: pestaña nueva, datos de prueba, se cierra sin enviar.
      await this.withScratchPage(async (scratch) => {
        await scratch.goto(`${this.root}/empleador/publicar`);
        await this.guard(scratch);
        await this.fillJob(scratch, HEALTH_VACANCY, true);
        await this.assertSubmittable(scratch, "[data-testid=publicar-empleo]", "el paso 2 de publicar");
      });

      await this.checkOfferScreens(page, {
        homePath: "/indeed/empleador",
        homeSelector: "[data-testid=employer-jobs]",
        linkSelector: "a[data-testid=ver-candidatos]",
        listSelector: "[data-testid=candidates]",
        rowSelector: "[data-testid=candidate-row]",
        resumeSelector: "[data-testid=candidate-resume]",
        closeSelector: "[data-testid=cerrar-empleo]",
        closeText: "Cerrar empleo",
      });
    });
  }

  publish(vacancy: VacancyData): Promise<PublishResult> {
    return this.withPage(async (page) => {
      await page.goto(`${this.root}/empleador/publicar`);
      await this.guard(page);
      await this.fillJob(page, vacancy, false);
      await page.click("[data-testid=publicar-empleo]");
      await page.locator(`[data-testid=job-title], [data-testid=error-publicacion], ${this.captchaSelector}`).first().waitFor();
      await this.guard(page);

      if ((await page.locator("[data-testid=error-publicacion]").count()) > 0) throw new PortalError(ERROR_CODES.publicationRejected);
      return this.published(this.jobIdFromUrl(page, /\/empleador\/empleos\/([^/]+)$/), "/empleo/:id");
    });
  }

  withdraw(externalId: string): Promise<void> {
    return this.withPage((page) =>
      this.closeJob(page, `/indeed/empleador/empleos/${encodeURIComponent(externalId)}`, "[data-testid=cerrar-empleo]", "[data-testid=job-status]", "Cerrado"),
    );
  }

  listApplicants(publication: ActivePublication): Promise<ApplicantSummary[]> {
    return this.withPage(async (page) => {
      await page.goto(`${this.root}/empleador/empleos/${encodeURIComponent(publication.externalId ?? "")}/candidatos`);
      await this.guard(page);
      await page.locator("[data-testid=candidates]").waitFor({ state: "attached" });
      // Sin funciones con nombre dentro del callback (problema `__name` de tsx).
      return page.locator("[data-testid=candidate-row]").evaluateAll((rows) =>
        rows.map((row) => ({
          externalId: row.getAttribute("data-candidate-id") ?? "",
          fullName: row.querySelector("[data-testid=candidate-name]")?.textContent?.trim() ?? "",
          email: row.querySelector("[data-testid=candidate-email]")?.textContent?.trim() || undefined,
          phone: row.querySelector("[data-testid=candidate-phone]")?.textContent?.trim() || undefined,
          resumeRef: row.querySelector("[data-testid=candidate-resume]")?.getAttribute("href") ?? "",
        })),
      );
    });
  }
}

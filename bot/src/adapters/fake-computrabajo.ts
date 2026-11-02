import type { Page } from "@playwright/test";
import { ERROR_CODES, PortalError } from "../errors";
import type { ActivePublication, ApplicantSummary, PublishResult, VacancyData } from "../types";
import { FakeSiteAdapter, HEALTH_VACANCY, descriptionOf, locationOf } from "./fake-base";

/** «Computrabajo (simulación)»: formulario único de oferta (campos `oferta_*`) y candidatos en tarjetas. */
export class FakeComputrabajoAdapter extends FakeSiteAdapter {
  readonly slug = "computrabajo";
  protected readonly sitePath = "/computrabajo";
  protected readonly captchaSelector = "[data-testid=captcha]";
  protected readonly externalOrigin = "https://computrabajo.fake.test";

  /** Rellena el formulario único SIN pulsar «Publicar oferta». Con `check`, verifica antes que estén los campos. */
  private async fillOffer(page: Page, vacancy: VacancyData, check: boolean): Promise<void> {
    if (check) await this.requireAll(page, ["#oferta_titulo", "#oferta_categoria", "#oferta_descripcion", "#oferta_ciudad"], "el formulario de la oferta");
    await page.fill("#oferta_titulo", vacancy.title);
    await page.selectOption("#oferta_categoria", "general");
    await page.fill("#oferta_descripcion", descriptionOf(vacancy));
    await page.fill("#oferta_ciudad", locationOf(vacancy));
  }

  healthCheck(): Promise<void> {
    return this.withPage(async (page) => {
      // Nada se envía: pestaña nueva, datos de prueba, se cierra sin pulsar «Publicar oferta».
      await this.withScratchPage(async (scratch) => {
        await scratch.goto(`${this.root}/empresa/ofertas/nueva`);
        await this.guard(scratch);
        await this.fillOffer(scratch, HEALTH_VACANCY, true);
        await this.assertSubmittable(scratch, "#oferta_publicar", "el formulario de la oferta");
      });

      await this.checkOfferScreens(page, {
        homePath: "/computrabajo/empresa/ofertas",
        homeSelector: ".ofertas-empresa",
        linkSelector: "a.lnk-candidatos",
        listSelector: "section.lista-candidatos",
        rowSelector: "section.lista-candidatos article.cand",
        resumeSelector: "a.bajar-cv",
        closeSelector: "#desactivar",
        closeText: "Desactivar oferta",
      });
    });
  }

  publish(vacancy: VacancyData): Promise<PublishResult> {
    return this.withPage(async (page) => {
      await page.goto(`${this.root}/empresa/ofertas/nueva`);
      await this.guard(page);
      await this.fillOffer(page, vacancy, false);
      await page.click("#oferta_publicar");
      await page.locator(`.titulo-oferta, .msg-error, ${this.captchaSelector}`).first().waitFor();
      await this.guard(page);

      if ((await page.locator(".msg-error").count()) > 0) throw new PortalError(ERROR_CODES.publicationRejected);
      return this.published(this.jobIdFromUrl(page, /\/empresa\/ofertas\/([^/]+)$/), "/empleo/:id");
    });
  }

  withdraw(externalId: string): Promise<void> {
    return this.withPage((page) =>
      this.closeJob(page, `/computrabajo/empresa/ofertas/${encodeURIComponent(externalId)}`, "#desactivar", ".estado-oferta", "Desactivada"),
    );
  }

  listApplicants(publication: ActivePublication): Promise<ApplicantSummary[]> {
    return this.withPage(async (page) => {
      await page.goto(`${this.root}/empresa/ofertas/${encodeURIComponent(publication.externalId ?? "")}/candidatos`);
      await this.guard(page);
      await page.locator("section.lista-candidatos").waitFor({ state: "attached" });
      // Sin funciones con nombre dentro del callback (problema `__name` de tsx).
      return page.locator("section.lista-candidatos article.cand").evaluateAll((cards) =>
        cards.map((card) => ({
          externalId: card.getAttribute("data-cid") ?? "",
          fullName: card.querySelector("h3")?.textContent?.trim() ?? "",
          email: card.querySelector(".mail")?.textContent?.trim() || undefined,
          phone: card.querySelector(".tel")?.textContent?.trim() || undefined,
          resumeRef: card.querySelector("a.bajar-cv")?.getAttribute("href") ?? "",
        })),
      );
    });
  }
}

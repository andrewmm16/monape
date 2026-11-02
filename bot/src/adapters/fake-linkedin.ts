import type { Page } from "@playwright/test";
import { ERROR_CODES, PortalError } from "../errors";
import type { ActivePublication, ApplicantSummary, PublishResult, VacancyData } from "../types";
import { DEMO_COMPANY, DEMO_CONTACT_EMAIL, FakeSiteAdapter, HEALTH_VACANCY, contractOf, descriptionOf, locationOf, modalityOf, questionOf } from "./fake-base";

/**
 * «Linkedin (simulación)»: portal ficticio con asistente de 4 pasos para publicar
 * (detalles → descripción y preguntas → cómo recibir candidatos → revisar y publicar).
 */
export class FakeLinkedinAdapter extends FakeSiteAdapter {
  readonly slug = "linkedin";
  protected readonly sitePath = "/linkedin";
  protected readonly captchaSelector = "#challenge-dialog";
  protected readonly externalOrigin = "https://linkedin.fake.test";

  /** Pulsa «Siguiente» y espera a estar en el paso indicado. */
  private async next(page: Page, step: number): Promise<void> {
    await page.click("#li-siguiente");
    await page.locator(`#li-paso-${step}, ${this.captchaSelector}`).first().waitFor();
    await this.guard(page);
  }

  /**
   * Rellena el asistente paso a paso hasta el 4 («Revisar y publicar») SIN pulsar «Publicar empleo».
   * Con `check`, además verifica en cada paso que estén los elementos que usa `publish`.
   */
  private async fillWizard(page: Page, vacancy: VacancyData, check: boolean): Promise<void> {
    // 1. Detalles del empleo
    if (check) await this.requireAll(page, ["#li-titulo", "#li-empresa", "#li-ubicacion", "#li-modalidad", "#li-contrato", "#li-siguiente"], "el paso 1 del asistente");
    await page.fill("#li-titulo", vacancy.title);
    await page.fill("#li-empresa", DEMO_COMPANY);
    await page.fill("#li-ubicacion", locationOf(vacancy));
    await page.selectOption("#li-modalidad", modalityOf(vacancy.modality));
    await page.selectOption("#li-contrato", contractOf(vacancy.contract_type));
    await this.next(page, 2);

    // 2. Descripción y preguntas de selección
    if (check) await this.requireAll(page, ["#li-descripcion", "#li-pregunta-1", "#li-pregunta-2", "#li-atras", "#li-siguiente"], "el paso 2 del asistente");
    await page.fill("#li-descripcion", descriptionOf(vacancy));
    await page.fill("#li-pregunta-1", questionOf(vacancy, 0));
    await page.fill("#li-pregunta-2", questionOf(vacancy, 1));
    await this.next(page, 3);

    // 3. Cómo recibir candidatos: por la plataforma (Postulación sencilla)
    if (check) await this.requireAll(page, ["#li-recepcion-plataforma", "#li-correo", "#li-atras", "#li-siguiente"], "el paso 3 del asistente");
    await page.check("#li-recepcion-plataforma");
    await page.fill("#li-correo", DEMO_CONTACT_EMAIL);
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
        await this.requireAll(scratch, ["#li-paso-4 dl.resumen", "#li-atras"], "el paso 4 del asistente");
        await this.assertSubmittable(scratch, "#li-publicar", "el paso 4 del asistente");
        // «Atrás» también forma parte de la navegación del asistente.
        await scratch.click("#li-atras");
        await scratch.locator("#li-paso-3").waitFor();
      });

      await this.checkOfferScreens(page, {
        homePath: "/linkedin/empleos",
        homeSelector: "#li-lista-empleos",
        linkSelector: "a.li-ver-candidatos",
        listSelector: "#li-candidatos",
        rowSelector: "#li-candidatos li.candidato",
        resumeSelector: "a.c-cv",
        closeSelector: "#li-cerrar",
        closeText: "Cerrar empleo",
      });
    });
  }

  publish(vacancy: VacancyData): Promise<PublishResult> {
    return this.withPage(async (page) => {
      await page.goto(`${this.root}/empleos/publicar`);
      await this.guard(page);
      await this.fillWizard(page, vacancy, false);

      // 4. Revisar y publicar
      await page.click("#li-publicar");
      await page.locator(`#li-publicada, #li-error, ${this.captchaSelector}`).first().waitFor();
      await this.guard(page);

      if ((await page.locator("#li-error").count()) > 0) throw new PortalError(ERROR_CODES.publicationRejected);
      return this.published(this.jobIdFromUrl(page, /\/empleos\/([^/]+)$/), "/empleos/:id");
    });
  }

  withdraw(externalId: string): Promise<void> {
    return this.withPage((page) =>
      this.closeJob(page, `/linkedin/empleos/${encodeURIComponent(externalId)}`, "#li-cerrar", "#li-estado", "Cerrado"),
    );
  }

  listApplicants(publication: ActivePublication): Promise<ApplicantSummary[]> {
    return this.withPage(async (page) => {
      await page.goto(`${this.root}/empleos/${encodeURIComponent(publication.externalId ?? "")}/candidatos`);
      await this.guard(page);
      await page.locator("#li-candidatos").waitFor({ state: "attached" });
      // Sin funciones con nombre dentro del callback (problema `__name` de tsx).
      return page.locator("#li-candidatos li.candidato").evaluateAll((items) =>
        items.map((item) => ({
          externalId: item.getAttribute("data-candidato-id") ?? "",
          fullName: item.querySelector(".c-nombre")?.textContent?.trim() ?? "",
          email: item.querySelector(".c-correo")?.textContent?.trim() || undefined,
          phone: item.querySelector(".c-telefono")?.textContent?.trim() || undefined,
          resumeRef: item.querySelector("a.c-cv")?.getAttribute("href") ?? "",
        })),
      );
    });
  }
}

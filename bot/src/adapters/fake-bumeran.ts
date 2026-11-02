import type { Page } from "@playwright/test";
import { ERROR_CODES, PortalError } from "../errors";
import type { ActivePublication, ApplicantSummary, PublishResult, VacancyData } from "../types";
import { FakeSiteAdapter, HEALTH_VACANCY, descriptionOf, locationOf } from "./fake-base";

/** «Bumeran (simulación)»: aviso en 3 pasos (datos → descripción → publicación), campos por `name`. */
export class FakeBumeranAdapter extends FakeSiteAdapter {
  readonly slug = "bumeran";
  protected readonly sitePath = "/bumeran";
  protected readonly captchaSelector = ".recaptcha-caja";
  protected readonly externalOrigin = "https://bumeran.fake.test";

  /** Pulsa «Continuar» y espera a estar en el paso indicado. */
  private async next(page: Page, step: number): Promise<void> {
    await page.click(".btn-continuar");
    await page.locator(`[data-step="${step}"], ${this.captchaSelector}`).first().waitFor();
    await this.guard(page);
  }

  /**
   * Rellena el aviso paso a paso hasta el 3 («Publicación») SIN pulsar «Publicar aviso».
   * Con `check`, además verifica en cada paso que estén los elementos que usa `publish`.
   */
  private async fillNotice(page: Page, vacancy: VacancyData, check: boolean): Promise<void> {
    // 1. Datos del aviso
    if (check) await this.requireAll(page, ["[name=puesto]", "[name=area]", "[name=zona]", "[name=jornada]", ".btn-continuar"], "el paso 1 del aviso");
    await page.fill("[name=puesto]", vacancy.title);
    await page.selectOption("[name=area]", "operaciones");
    await page.fill("[name=zona]", locationOf(vacancy));
    await page.selectOption("[name=jornada]", "completa");
    await this.next(page, 2);

    // 2. Descripción del puesto
    if (check) await this.requireAll(page, ["[name=detalle]", "[name=requisitos]", ".btn-volver", ".btn-continuar"], "el paso 2 del aviso");
    await page.fill("[name=detalle]", descriptionOf(vacancy));
    await page.fill("[name=requisitos]", vacancy.requirements.map((r) => `- ${r.description}`).join("\n"));
    await this.next(page, 3);

    // 3. Publicación (aquí se queda la prueba)
    if (check) await this.requireAll(page, ["[name=vigencia]", "[name=acepto]", ".btn-volver"], "el paso 3 del aviso");
    await page.selectOption("[name=vigencia]", "30");
    await page.check("[name=acepto]");
  }

  healthCheck(): Promise<void> {
    return this.withPage(async (page) => {
      // Nada se guarda hasta «Publicar aviso», que NO se pulsa: pestaña nueva, datos de prueba, se cierra sin enviar.
      await this.withScratchPage(async (scratch) => {
        await scratch.goto(`${this.root}/avisos/nuevo`);
        await this.guard(scratch);
        await this.fillNotice(scratch, HEALTH_VACANCY, true);
        await this.assertSubmittable(scratch, ".btn-publicar-aviso", "el paso 3 del aviso");
      });

      await this.checkOfferScreens(page, {
        homePath: "/bumeran/avisos",
        homeSelector: ".mis-avisos",
        linkSelector: "a.ver-postulaciones",
        listSelector: "table.tabla-postulantes",
        rowSelector: "table.tabla-postulantes tbody tr[data-postulante]",
        resumeSelector: "a.descargar-cv",
        closeSelector: ".btn-baja",
        closeText: "Dar de baja el aviso",
      });
    });
  }

  publish(vacancy: VacancyData): Promise<PublishResult> {
    return this.withPage(async (page) => {
      await page.goto(`${this.root}/avisos/nuevo`);
      await this.guard(page);
      await this.fillNotice(page, vacancy, false);
      await page.click(".btn-publicar-aviso");
      await page.locator(`.aviso-titulo, .alerta-error, ${this.captchaSelector}`).first().waitFor();
      await this.guard(page);

      if ((await page.locator(".alerta-error").count()) > 0) throw new PortalError(ERROR_CODES.publicationRejected);
      return this.published(this.jobIdFromUrl(page, /\/avisos\/([^/]+)$/), "/avisos/:id");
    });
  }

  withdraw(externalId: string): Promise<void> {
    return this.withPage((page) =>
      this.closeJob(page, `/bumeran/avisos/${encodeURIComponent(externalId)}`, ".btn-baja", ".aviso-estado", "dado de baja"),
    );
  }

  listApplicants(publication: ActivePublication): Promise<ApplicantSummary[]> {
    return this.withPage(async (page) => {
      await page.goto(`${this.root}/avisos/${encodeURIComponent(publication.externalId ?? "")}/postulaciones`);
      await this.guard(page);
      await page.locator("table.tabla-postulantes").waitFor({ state: "attached" });
      // Las celdas se leen por posición: nombre, correo, teléfono, CV. Sin funciones con nombre (problema `__name` de tsx).
      return page.locator("table.tabla-postulantes tbody tr[data-postulante]").evaluateAll((rows) =>
        rows.map((row) => ({
          externalId: row.getAttribute("data-postulante") ?? "",
          fullName: row.children[0]?.textContent?.trim() ?? "",
          email: row.children[1]?.textContent?.trim() || undefined,
          phone: row.children[2]?.textContent?.trim() || undefined,
          resumeRef: row.querySelector("a.descargar-cv")?.getAttribute("href") ?? "",
        })),
      );
    });
  }
}

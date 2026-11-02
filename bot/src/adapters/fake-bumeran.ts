import type { Page } from "@playwright/test";
import { ERROR_CODES, PortalError } from "../errors";
import { AVISO_COOKIES, estricto, registerBook, tolerante } from "../selectors";
import type { ActivePublication, ApplicantSummary, PublishResult, VacancyData } from "../types";
import { FakeSiteAdapter, HEALTH_VACANCY, descriptionOf, locationOf } from "./fake-base";

/**
 * Libro de selectores de «Bumeran (simulación)». Tolerantes: campos, navegación y lectura de
 * postulantes; estrictos: «Publicar aviso», «Dar de baja el aviso» y las marcas de resultado (ver `selectors.ts`).
 */
export const BUMERAN_BOOK = registerBook("bumeran", {
  captcha: estricto("Aviso de verificación humana (CAPTCHA)", ".recaptcha-caja"),
  aviso_cookies: AVISO_COOKIES,
  campo_titulo: tolerante("Campo del puesto (título del aviso)", "[name=puesto]", [{ etiqueta: ["Puesto", "Título", "Titulo", "Cargo"] }, { css: "[name^=puesto]" }]),
  campo_area: tolerante("Lista del área", "[name=area]", [{ etiqueta: ["Área", "Area"] }, { css: "[name^=area]" }]),
  campo_ubicacion: tolerante("Campo de la zona de trabajo", "[name=zona]", [{ etiqueta: ["Zona de trabajo", "Zona", "Ubicación"] }, { css: "[name^=zona]" }]),
  campo_jornada: tolerante("Lista de la jornada", "[name=jornada]", [{ etiqueta: ["Jornada"] }, { css: "[name^=jornada]" }]),
  campo_descripcion: tolerante("Campo del detalle del puesto", "[name=detalle]", [{ etiqueta: ["Detalle del puesto", "Descripción", "Descripcion"] }, { css: "[name^=detalle]" }]),
  campo_requisitos: tolerante("Campo de requisitos", "[name=requisitos]", [{ etiqueta: ["Requisitos"] }, { css: "[name^=requisitos]" }]),
  campo_vigencia: tolerante("Lista de la vigencia del aviso", "[name=vigencia]", [{ etiqueta: ["Vigencia"] }, { css: "[name^=vigencia]" }]),
  campo_acepto: tolerante("Casilla de aceptar las condiciones", "[name=acepto]", [{ etiqueta: ["Acepto las condiciones", "Acepto"] }, { css: "[name^=acepto]" }]),
  boton_siguiente: tolerante("Botón «Continuar»", ".btn-continuar", [{ rol: "button", nombre: ["Continuar", "Siguiente", "Next"] }]),
  boton_atras: tolerante("Botón «Volver»", ".btn-volver", [{ rol: "button", nombre: ["Volver", "Atrás", "Atras", "Back"] }]),
  boton_enviar: estricto("Botón «Publicar aviso»", ".btn-publicar-aviso"),
  marca_paso: estricto("Marca del paso {n} del aviso", "[data-step='{n}']"),
  resultado_publicada: estricto("Título del aviso publicado", ".aviso-titulo"),
  resultado_error: estricto("Mensaje de error al publicar", ".alerta-error"),
  panel_ofertas: tolerante("Lista de avisos del empleador", ".mis-avisos", [{ css: "[class*='avisos']" }]),
  enlace_ver_candidatos: tolerante("Enlace «Ver postulaciones» de cada aviso", "a.ver-postulaciones", [
    { css: "a[href$='/postulaciones']" },
    { rol: "link", nombre: ["Ver postulaciones"] },
  ]),
  lista_postulantes: tolerante("Tabla de postulantes", "table.tabla-postulantes", [{ css: "table[class*='postulantes']" }]),
  fila_postulante: tolerante("Fila de un postulante", "table.tabla-postulantes tbody tr[data-postulante]", [{ css: "tr[data-postulante]" }]),
  enlace_cv: tolerante("Enlace al CV del postulante", "a.descargar-cv", [{ css: "a[href*='/cv/']" }, { rol: "link", nombre: ["Descargar", "Currículum", "Curriculum", "CV"] }]),
  boton_retirar: estricto("Botón «Dar de baja el aviso»", ".btn-baja"),
  estado_oferta: estricto("Estado del aviso", ".aviso-estado"),
});

/** «Bumeran (simulación)»: aviso en 3 pasos (datos → descripción → publicación), campos por `name`. */
export class FakeBumeranAdapter extends FakeSiteAdapter {
  readonly slug = "bumeran";
  protected readonly sitePath = "/bumeran";
  protected readonly externalOrigin = "https://bumeran.fake.test";

  /** Pulsa «Continuar» y espera a estar en el paso indicado. */
  private async next(page: Page, step: number): Promise<void> {
    await this.clickKey(page, "boton_siguiente");
    await page.locator(`${this.sel("marca_paso", { n: step })}, ${this.sel("captcha")}`).first().waitFor();
    await this.guard(page);
  }

  /**
   * Rellena el aviso paso a paso hasta el 3 («Publicación») SIN pulsar «Publicar aviso».
   * Con `check`, además verifica en cada paso que estén los botones de navegación que usa `publish`
   * (los campos se verifican al rellenarlos).
   */
  private async fillNotice(page: Page, vacancy: VacancyData, check: boolean): Promise<void> {
    // 1. Datos del aviso
    if (check) await this.requireKeys(page, ["boton_siguiente"], "el paso 1 del aviso");
    await this.fillField(page, "campo_titulo", vacancy.title);
    await this.selectField(page, "campo_area", "operaciones");
    await this.fillField(page, "campo_ubicacion", locationOf(vacancy));
    await this.selectField(page, "campo_jornada", "completa");
    await this.next(page, 2);

    // 2. Descripción del puesto
    if (check) await this.requireKeys(page, ["boton_atras", "boton_siguiente"], "el paso 2 del aviso");
    await this.fillField(page, "campo_descripcion", descriptionOf(vacancy));
    await this.fillField(page, "campo_requisitos", vacancy.requirements.map((r) => `- ${r.description}`).join("\n"));
    await this.next(page, 3);

    // 3. Publicación (aquí se queda la prueba)
    if (check) await this.requireKeys(page, ["boton_atras"], "el paso 3 del aviso");
    await this.selectField(page, "campo_vigencia", "30");
    await this.checkField(page, "campo_acepto");
  }

  healthCheck(): Promise<void> {
    return this.withPage(async (page) => {
      // Nada se guarda hasta «Publicar aviso», que NO se pulsa: pestaña nueva, datos de prueba, se cierra sin enviar.
      await this.withScratchPage(async (scratch) => {
        await scratch.goto(`${this.root}/avisos/nuevo`);
        await this.guard(scratch);
        await this.fillNotice(scratch, HEALTH_VACANCY, true);
        await this.assertSubmittable(scratch, "el paso 3 del aviso");
      });

      await this.checkOfferScreens(page, { homePath: "/bumeran/avisos", closeText: "Dar de baja el aviso" });
    });
  }

  publish(vacancy: VacancyData): Promise<PublishResult> {
    return this.withPage(async (page) => {
      await page.goto(`${this.root}/avisos/nuevo`);
      await this.guard(page);
      await this.fillNotice(page, vacancy, false);
      await this.clickKey(page, "boton_enviar");
      await page.locator(`${this.sel("resultado_publicada")}, ${this.sel("resultado_error")}, ${this.sel("captcha")}`).first().waitFor();
      await this.guard(page);

      if ((await page.locator(this.sel("resultado_error")).count()) > 0) throw new PortalError(ERROR_CODES.publicationRejected);
      return this.published(this.jobIdFromUrl(page, /\/avisos\/([^/]+)$/), "/avisos/:id");
    });
  }

  withdraw(externalId: string): Promise<void> {
    return this.withPage((page) => this.closeJob(page, `/bumeran/avisos/${encodeURIComponent(externalId)}`, "dado de baja"));
  }

  listApplicants(publication: ActivePublication): Promise<ApplicantSummary[]> {
    return this.withPage(async (page) => {
      await page.goto(`${this.root}/avisos/${encodeURIComponent(publication.externalId ?? "")}/postulaciones`);
      await this.guard(page, { offer: true });
      // Las celdas se leen por posición: nombre, correo, teléfono, CV.
      return this.readApplicants(page, "data-postulante", "cells");
    });
  }
}

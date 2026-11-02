import type { BrowserContext, Page } from "@playwright/test";
import { ERROR_CODES, PortalError } from "../errors";
import type { ApplicantSummary, ActivePublication, PortalAdapter, PublishResult, ResumeFile, VacancyData } from "../types";

/**
 * Base de los adaptadores de los portales FICTICIOS. Solo reúne lo que no
 * depende de la estructura de cada portal (pestaña propia, detección de sesión
 * y CAPTCHA, descarga del CV). Los selectores NO se comparten: cada portal
 * tiene los suyos, como pasa con los reales.
 */

/** Pestañas ya asignadas por contexto: con un navegador compartido cada adaptador usa la suya. */
const claimedPages = new WeakMap<BrowserContext, Set<Page>>();

async function claimPage(context: BrowserContext): Promise<Page> {
  const claimed = claimedPages.get(context) ?? new Set<Page>();
  claimedPages.set(context, claimed);
  const page = context.pages().find((open) => !open.isClosed() && !claimed.has(open)) ?? (await context.newPage());
  claimed.add(page);
  return page;
}

/** Ofertas que la prueba de estructura recorre como máximo para encontrar postulantes o una oferta activa. */
const MAX_OFFERS = 10;

/** Datos de prueba para recorrer el formulario de publicar en la prueba de estructura (nunca se envían). */
export const HEALTH_VACANCY: VacancyData = {
  id: "prueba-de-estructura",
  title: "Prueba de estructura",
  department: null,
  description: "Prueba de estructura: este formulario no se envía.",
  responsibilities: null,
  location: null,
  city: "Lima",
  region: "Lima",
  modality: null,
  contract_type: null,
  closing_date: null,
  requirements: [],
};

export const DEMO_COMPANY = "Empresa de demostración";
export const DEMO_CONTACT_EMAIL = "reclutamiento@empresa-demo.test";

export const locationOf = (vacancy: VacancyData) => [vacancy.city, vacancy.region].filter(Boolean).join(", ") || vacancy.location || "Lima";

export const descriptionOf = (vacancy: VacancyData) =>
  [vacancy.description, vacancy.responsibilities].filter(Boolean).join("\n\n");

export function modalityOf(modality: string | null): "presencial" | "hibrido" | "remoto" {
  const text = (modality ?? "").toLowerCase();
  if (text.includes("remot")) return "remoto";
  if (text.includes("hibr") || text.includes("híbr") || text.includes("mixt")) return "hibrido";
  return "presencial";
}

export function contractOf(contract: string | null): "tiempo_completo" | "medio_tiempo" | "contrato" | "practicas" {
  const text = (contract ?? "").toLowerCase();
  if (text.includes("practic") || text.includes("prácti")) return "practicas";
  if (text.includes("medio") || text.includes("parcial") || text.includes("part")) return "medio_tiempo";
  if (text.includes("plazo") || text.includes("contrato") || text.includes("temporal")) return "contrato";
  return "tiempo_completo";
}

/** Texto corto de un requisito, para usarlo como pregunta de selección. */
export const questionOf = (vacancy: VacancyData, index: number) => {
  const requirement = vacancy.requirements[index]?.description;
  return requirement ? `¿Cumples con este requisito? ${requirement}`.slice(0, 160) : "";
};

export abstract class FakeSiteAdapter implements PortalAdapter {
  abstract readonly slug: string;
  /** Prefijo del sitio en el servidor ficticio, por ejemplo "/linkedin" ("" para el alias de la raíz). */
  protected abstract readonly sitePath: string;
  /** Elemento que aparece cuando el portal pide verificar que se es humano. */
  protected abstract readonly captchaSelector: string;
  /** Origen ficticio (https, dominio .test) para el enlace que se informa a la app. */
  protected abstract readonly externalOrigin: string;

  private page: Page | undefined;

  constructor(
    protected readonly context: BrowserContext,
    protected readonly baseUrl: string,
    timeoutMs = 15_000,
  ) {
    context.setDefaultTimeout(timeoutMs);
  }

  protected get root(): string {
    return `${this.baseUrl}${this.sitePath}`;
  }

  /** Detecta lo que solo una persona puede resolver y se detiene. */
  protected async guard(page: Page): Promise<void> {
    if (new URL(page.url()).pathname === `${this.sitePath}/login`) throw new PortalError(ERROR_CODES.sessionExpired);
    if ((await page.locator(this.captchaSelector).count()) > 0) throw new PortalError(ERROR_CODES.verificationRequired);
  }

  /** Una sola pestaña por adaptador: no se abren y cierran pestañas por cada oferta ni se mezclan con las de otros portales. */
  protected async withPage<T>(run: (page: Page) => Promise<T>): Promise<T> {
    if (!this.page || this.page.isClosed()) this.page = await claimPage(this.context);
    return run(this.page);
  }

  /** Falla con pagina_cambio si falta alguno de los elementos que el adaptador usa. */
  protected async requireAll(page: Page, selectors: string[], where: string): Promise<void> {
    for (const selector of selectors) {
      if ((await page.locator(selector).count()) === 0) {
        throw new PortalError(ERROR_CODES.pageChanged, `falta ${selector} en ${where}`);
      }
    }
  }

  /** Id de la oferta a partir de la dirección donde terminó la publicación. */
  protected jobIdFromUrl(page: Page, pattern: RegExp): string {
    const match = pattern.exec(new URL(page.url()).pathname);
    if (!match) throw new PortalError(ERROR_CODES.pageChanged, "no se obtuvo el id de la oferta");
    return match[1]!;
  }

  protected published(externalId: string, path: string): PublishResult {
    // La app solo acepta enlaces https y el portal ficticio corre en http local:
    // el enlace informado usa un dominio ficticio (.test) solo para mostrarse.
    return { externalId, externalUrl: `${this.externalOrigin}${path.replace(":id", encodeURIComponent(externalId))}` };
  }

  /** Pasos de la última prueba de estructura que no se pudieron verificar (no hay ofertas o postulantes en el portal). */
  private gaps: string[] = [];

  healthCheckGaps(): string[] {
    return [...this.gaps];
  }

  /** Pestaña nueva y desechable (se cierra siempre): para recorrer formularios sin tocar la pestaña de trabajo. */
  protected async withScratchPage<T>(run: (page: Page) => Promise<T>): Promise<T> {
    const scratch = await this.context.newPage();
    try {
      return await run(scratch);
    } finally {
      await scratch.close().catch(() => undefined);
    }
  }

  /**
   * Último control antes del envío final, SIN enviar: el botón existe, nada lo tapa
   * (se comprueba con un clic «de prueba» que no pulsa) y el formulario no pide
   * ningún campo que el robot no rellene.
   */
  protected async assertSubmittable(page: Page, submitSelector: string, where: string): Promise<void> {
    await this.guard(page);
    await this.requireAll(page, [submitSelector], where);
    try {
      await page.click(submitSelector, { trial: true });
    } catch {
      throw new PortalError(ERROR_CODES.pageChanged, `no se puede pulsar ${submitSelector} en ${where}`);
    }
    const valid = await page.locator(submitSelector).evaluate((button) => (button as HTMLButtonElement).form?.checkValidity() ?? true);
    if (!valid) throw new PortalError(ERROR_CODES.pageChanged, `${where} pide un campo que el robot no rellena`);
  }

  /**
   * Prueba SIN efectos de las pantallas que dependen de que haya ofertas: abre el
   * panel y recorre las ofertas existentes (hasta MAX_OFFERS). Comprueba la lista de
   * candidatos de la primera, el enlace al CV del primer postulante (sin descargarlo)
   * y, en una oferta activa, el botón de retirar con su texto (sin pulsarlo). Lo que no
   * se pueda verificar por falta de ofertas o postulantes queda en `healthCheckGaps()`.
   */
  protected async checkOfferScreens(
    page: Page,
    o: {
      homePath: string;
      homeSelector: string;
      linkSelector: string;
      listSelector: string;
      rowSelector: string;
      resumeSelector: string;
      /** Portales que retiran sin pantalla (sin botón) lo omiten. */
      closeSelector?: string;
      closeText?: string;
    },
  ): Promise<void> {
    this.gaps = [];
    await page.goto(`${this.baseUrl}${o.homePath}`);
    await this.guard(page);
    await this.requireAll(page, [o.homeSelector], "el panel de ofertas");
    const hrefs = (await page.locator(o.linkSelector).evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? "")))
      .filter(Boolean)
      .slice(0, MAX_OFFERS)
      .map((href) => new URL(href, this.baseUrl).toString());
    if (hrefs.length === 0) {
      this.gaps.push("lista de candidatos", "enlace al CV");
      if (o.closeSelector) this.gaps.push("botón de retirar");
      return; // sin ofertas todavía: nada que abrir
    }

    // Lista de candidatos (de la primera oferta) y enlace al CV del primer postulante que aparezca.
    let resumeChecked = false;
    for (const url of hrefs) {
      await page.goto(url);
      await this.guard(page);
      // «attached»: una lista sin filas cuenta como oculta y no es un cambio de página.
      await page.locator(o.listSelector).waitFor({ state: "attached" });
      const first = page.locator(o.rowSelector).first();
      if ((await first.count()) === 0) continue;
      const href = await first.locator(o.resumeSelector).first().getAttribute("href", { timeout: 500 }).catch(() => null);
      if (!href) throw new PortalError(ERROR_CODES.pageChanged, `falta ${o.resumeSelector} (con enlace) en el primer postulante`);
      resumeChecked = true;
      break;
    }
    if (!resumeChecked) this.gaps.push("enlace al CV");

    // Botón de retirar de una oferta activa: la página de la oferta es la de candidatos sin su último tramo.
    if (!o.closeSelector) return;
    for (const url of hrefs) {
      await page.goto(url.replace(/\/[^/]+$/, ""));
      await this.guard(page);
      if ((await page.locator(o.closeSelector).count()) === 0) continue; // cerrada
      if ((await page.locator(o.closeSelector, { hasText: o.closeText }).count()) === 0) {
        throw new PortalError(ERROR_CODES.pageChanged, `${o.closeSelector} ya no dice «${o.closeText}»`);
      }
      return;
    }
    this.gaps.push("botón de retirar (no hay ofertas activas)");
  }

  /** Cierra la oferta con el botón de su página y confirma el nuevo estado. */
  protected async closeJob(page: Page, jobPath: string, closeSelector: string, statusSelector: string, closedText: string): Promise<void> {
    await page.goto(`${this.baseUrl}${jobPath}`);
    await this.guard(page);
    if ((await page.locator(closeSelector).count()) === 0) {
      // Ya estaba cerrada: retirar es idempotente.
      if ((await page.locator(statusSelector, { hasText: closedText }).count()) > 0) return;
      throw new PortalError(ERROR_CODES.pageChanged, `falta ${closeSelector} para retirar la oferta`);
    }
    await page.click(closeSelector);
    await page.locator(statusSelector, { hasText: closedText }).waitFor();
  }

  async downloadResume(_publication: ActivePublication, applicant: ApplicantSummary): Promise<ResumeFile> {
    // Sin enlace al CV (el portal cambió esa parte de la lista), pedir la dirección vacía bajaría la portada del sitio como si fuera el CV.
    if (!applicant.resumeRef) throw new PortalError(ERROR_CODES.pageChanged, "el postulante no trae enlace al CV");
    // Mismo contexto que el navegador: usa las cookies de la sesión iniciada.
    const response = await this.context.request.get(new URL(applicant.resumeRef, this.baseUrl).toString());
    if (new URL(response.url()).pathname === `${this.sitePath}/login`) throw new PortalError(ERROR_CODES.sessionExpired);
    if (!response.ok()) throw new PortalError(ERROR_CODES.pageChanged, `CV respondió ${response.status()}`);
    return { filename: `cv-${applicant.externalId}.pdf`, bytes: new Uint8Array(await response.body()) };
  }

  async close(): Promise<void> {
    await this.context.close();
  }

  abstract healthCheck(): Promise<void>;
  abstract publish(vacancy: VacancyData): Promise<PublishResult>;
  abstract withdraw(externalId: string): Promise<void>;
  abstract listApplicants(publication: ActivePublication): Promise<ApplicantSummary[]>;
}

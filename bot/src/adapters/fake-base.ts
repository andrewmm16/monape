import type { BrowserContext, Locator, Page } from "@playwright/test";
import { ERROR_CODES, PortalError } from "../errors";
import { activeSelector, probeElement, resolveCss, resolveElement, type Raiz, type ResolveOptions, type Vars } from "../selectors";
import { captureStructure } from "../structure";
import type { ApplicantSummary, ActivePublication, PortalAdapter, PublishResult, ResumeFile, VacancyData } from "../types";

/**
 * Base de los adaptadores de los portales FICTICIOS. Solo reúne lo que no
 * depende de la estructura de cada portal (pestaña propia, detección de sesión
 * y CAPTCHA, descarga del CV). Los selectores NO se comparten: cada portal
 * declara su propio «libro de selectores» (ver `selectors.ts`), como pasa con los reales.
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
  /** Origen ficticio (https, dominio .test) para el enlace que se informa a la app. */
  protected abstract readonly externalOrigin: string;

  private page: Page | undefined;
  /** Tiempo máximo por cada forma de buscar un elemento del libro (las páginas ya están cargadas). */
  private readonly resolveTimeoutMs: number;

  constructor(
    protected readonly context: BrowserContext,
    protected readonly baseUrl: string,
    timeoutMs = 15_000,
  ) {
    context.setDefaultTimeout(timeoutMs);
    this.resolveTimeoutMs = Math.min(timeoutMs, 1_500);
  }

  protected get root(): string {
    return `${this.baseUrl}${this.sitePath}`;
  }

  // ---------------------------------------------------------------- libro de selectores

  /** Encuentra una clave del libro del portal (ver `selectors.ts`): override → defecto → alternativas si no es estricta. */
  protected el(page: Raiz, clave: string, options: ResolveOptions = {}): Promise<Locator> {
    return resolveElement(page, this.slug, clave, { timeoutMs: this.resolveTimeoutMs, ...options });
  }

  /** Busca sin esperar; `null` si no hay nada (con `all`, todos los que cumplen). */
  protected probe(page: Raiz, clave: string, options: { vars?: Vars; all?: boolean } = {}): Promise<Locator | null> {
    return probeElement(page, this.slug, clave, options);
  }

  /** Selector CSS vigente de una clave (para combinar claves estrictas en una espera). */
  protected sel(clave: string, vars?: Vars): string {
    return activeSelector(this.slug, clave, vars);
  }

  protected async fillField(page: Page, clave: string, value: string): Promise<void> {
    await (await this.el(page, clave)).fill(value);
  }

  protected async selectField(page: Page, clave: string, value: string): Promise<void> {
    await (await this.el(page, clave)).selectOption(value);
  }

  protected async checkField(page: Page, clave: string): Promise<void> {
    await (await this.el(page, clave)).check();
  }

  protected async clickKey(page: Page, clave: string): Promise<void> {
    await (await this.el(page, clave)).click();
  }

  /** Falla con pagina_cambio si falta alguno de los elementos que el adaptador usa. */
  protected async requireKeys(page: Page, claves: string[], where: string): Promise<void> {
    for (const clave of claves) await this.el(page, clave, { state: "attached", where });
  }

  /** Detecta lo que solo una persona puede resolver y se detiene; acepta un aviso de cookies si tapa la página. */
  protected async guard(page: Page, options: { offer?: boolean } = {}): Promise<void> {
    if (new URL(page.url()).pathname === `${this.sitePath}/login`) throw new PortalError(ERROR_CODES.sessionExpired);
    if ((await page.locator(this.sel("captcha")).count()) > 0) throw new PortalError(ERROR_CODES.verificationRequired);
    // Página «No existe» al abrir una oferta concreta: la oferta ya no está en el portal (no es un cambio de su estructura).
    if (options.offer && (await page.title()).startsWith("No existe")) throw new PortalError(ERROR_CODES.offerNotFound, "la oferta ya no existe en el portal (404)");
    // Aviso de cookies (tolerante): si tapa la página se acepta; si no hay, no se hace nada.
    const cookies = await this.probe(page, "aviso_cookies");
    if (cookies) await cookies.click({ timeout: 2_000 }).catch(() => undefined);
  }

  // ---------------------------------------------------------------- pestañas y diagnóstico

  /** Esquema de la pantalla donde falló la última operación (se captura al fallar, antes de cerrar la pestaña desechable). */
  private failureStructure: string | null = null;

  private async rememberFailure(page: Page): Promise<void> {
    if (this.failureStructure) return;
    try {
      this.failureStructure = await Promise.race([
        captureStructure(page),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 3_000).unref()),
      ]);
    } catch {
      // Sin esquema: el incidente se guarda igual.
    }
  }

  async captureStructure(): Promise<string> {
    if (this.failureStructure) return this.failureStructure;
    if (!this.page || this.page.isClosed()) throw new Error("no hay una pantalla abierta que capturar");
    return captureStructure(this.page);
  }

  /** Una sola pestaña por adaptador: no se abren y cierran pestañas por cada oferta ni se mezclan con las de otros portales. */
  protected async withPage<T>(run: (page: Page) => Promise<T>): Promise<T> {
    if (!this.page || this.page.isClosed()) this.page = await claimPage(this.context);
    this.failureStructure = null;
    try {
      return await run(this.page);
    } catch (error) {
      await this.rememberFailure(this.page);
      throw error;
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
    } catch (error) {
      await this.rememberFailure(scratch);
      throw error;
    } finally {
      await scratch.close().catch(() => undefined);
    }
  }

  /**
   * Último control antes del envío final, SIN enviar: el botón existe, nada lo tapa
   * (se comprueba con un clic «de prueba» que no pulsa) y el formulario no pide
   * ningún campo que el robot no rellene. El botón de enviar es ESTRICTO (ver `selectors.ts`).
   */
  protected async assertSubmittable(page: Page, where: string): Promise<void> {
    await this.guard(page);
    const button = await this.el(page, "boton_enviar", { where });
    try {
      await button.click({ trial: true });
    } catch {
      throw new PortalError(ERROR_CODES.pageChanged, `no se puede pulsar el botón de enviar [boton_enviar] en ${where}`);
    }
    const valid = await button.evaluate((element) => (element as HTMLButtonElement).form?.checkValidity() ?? true);
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
      /** Texto del botón de retirar. Los portales que retiran sin pantalla (sin botón) lo omiten. */
      closeText?: string;
    },
  ): Promise<void> {
    this.gaps = [];
    await page.goto(`${this.baseUrl}${o.homePath}`);
    await this.guard(page);
    await this.requireKeys(page, ["panel_ofertas"], "el panel de ofertas");
    const links = await this.probe(page, "enlace_ver_candidatos", { all: true });
    const hrefs = (links ? await links.evaluateAll((items) => items.map((link) => link.getAttribute("href") ?? "")) : [])
      .filter(Boolean)
      .slice(0, MAX_OFFERS)
      .map((href) => new URL(href, this.baseUrl).toString());
    if (hrefs.length === 0) {
      this.gaps.push("lista de candidatos", "enlace al CV");
      if (o.closeText) this.gaps.push("botón de retirar");
      return; // sin ofertas todavía: nada que abrir
    }

    // Lista de candidatos (de la primera oferta) y enlace al CV del primer postulante que aparezca.
    let resumeChecked = false;
    for (const url of hrefs) {
      await page.goto(url);
      await this.guard(page);
      // «attached»: una lista sin filas cuenta como oculta y no es un cambio de página.
      await this.el(page, "lista_postulantes", { state: "attached", where: "la lista de candidatos" });
      const rows = await this.probe(page, "fila_postulante", { all: true });
      if (!rows) continue;
      const link = await this.probe(rows.first(), "enlace_cv");
      const href = await link?.getAttribute("href", { timeout: 500 }).catch(() => null);
      if (!href) throw new PortalError(ERROR_CODES.pageChanged, "falta el enlace al CV (con dirección) en el primer postulante [enlace_cv]");
      resumeChecked = true;
      break;
    }
    if (!resumeChecked) this.gaps.push("enlace al CV");

    // Botón de retirar de una oferta activa: la página de la oferta es la de candidatos sin su último tramo.
    if (!o.closeText) return;
    for (const url of hrefs) {
      await page.goto(url.replace(/\/[^/]+$/, ""));
      await this.guard(page);
      const button = await this.probe(page, "boton_retirar");
      if (!button) continue; // cerrada
      if ((await button.filter({ hasText: o.closeText }).count()) === 0) {
        throw new PortalError(ERROR_CODES.pageChanged, `el botón de retirar [boton_retirar] ya no dice «${o.closeText}»`);
      }
      return;
    }
    this.gaps.push("botón de retirar (no hay ofertas activas)");
  }

  /**
   * Lee la lista de postulantes de la página actual. Los subcampos (nombre, correo, teléfono, CV)
   * se buscan con los selectores del libro dentro de la primera fila. Con `cells`, el portal
   * entrega nombre, correo y teléfono por posición de celda (solo el CV y el id usan selector/atributo).
   */
  protected async readApplicants(page: Page, idAttribute: string, mode: "selectors" | "cells"): Promise<ApplicantSummary[]> {
    await this.el(page, "lista_postulantes", { state: "attached", where: "la lista de candidatos" });
    const rows = await this.probe(page, "fila_postulante", { all: true });
    if (!rows) return [];
    const first = rows.first();
    const cv = await resolveCss(first, this.slug, "enlace_cv");
    if (mode === "cells") {
      // Sin funciones con nombre dentro del callback (problema `__name` de tsx).
      return rows.evaluateAll(
        (items, args) =>
          items.map((row) => ({
            externalId: row.getAttribute(args.id) ?? "",
            fullName: row.children[0]?.textContent?.trim() ?? "",
            email: row.children[1]?.textContent?.trim() || undefined,
            phone: row.children[2]?.textContent?.trim() || undefined,
            resumeRef: row.querySelector(args.cv)?.getAttribute("href") ?? "",
          })),
        { id: idAttribute, cv },
      );
    }
    const selectors = {
      id: idAttribute,
      cv,
      name: await resolveCss(first, this.slug, "postulante_nombre"),
      email: await resolveCss(first, this.slug, "postulante_correo"),
      phone: await resolveCss(first, this.slug, "postulante_telefono"),
    };
    // Sin funciones con nombre dentro del callback: tsx (esbuild) les agrega un ayudante `__name` que no existe en el navegador.
    return rows.evaluateAll(
      (items, args) =>
        items.map((item) => ({
          externalId: item.getAttribute(args.id) ?? "",
          fullName: item.querySelector(args.name)?.textContent?.trim() ?? "",
          email: item.querySelector(args.email)?.textContent?.trim() || undefined,
          phone: item.querySelector(args.phone)?.textContent?.trim() || undefined,
          resumeRef: item.querySelector(args.cv)?.getAttribute("href") ?? "",
        })),
      selectors,
    );
  }

  /** Cierra la oferta con el botón de su página (ESTRICTO) y confirma el nuevo estado. */
  protected async closeJob(page: Page, jobPath: string, closedText: string): Promise<void> {
    await page.goto(`${this.baseUrl}${jobPath}`);
    await this.guard(page);
    const status = () => page.locator(this.sel("estado_oferta"), { hasText: closedText });
    const button = await this.probe(page, "boton_retirar");
    if (!button) {
      // Ya estaba cerrada: retirar es idempotente.
      if ((await status().count()) > 0) return;
      throw new PortalError(ERROR_CODES.pageChanged, "falta el botón de retirar la oferta [boton_retirar]");
    }
    await button.click();
    await status().waitFor();
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

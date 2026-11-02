import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import {
  EASY_APPLY_STEPS,
  renderCaptcha,
  renderEasyApplyStep,
  renderLanding,
  renderLogin,
  renderMessage,
  renderPublicJob,
  type ApplyDraft,
} from "./candidate";
import { PORTAL_SLUGS, type FakeApplicant, type FakeJob, type PortalFlags, type PortalSlug } from "./model";
import { listIncidentsSync } from "../incidents";
import { buildReport, renderHtml, renderMarkdown, writeFileAtomic, type Informe } from "../training-report";
import { createMutator, type AutoRestoreOptions, type Cambio, type Mutator } from "./mutator";
import { fill, layout, renderApplicants, renderEmployerHome, renderEmployerJob, renderStep, type Site } from "./sites";
import { esc, minimalPdf, readBody, type UploadedFile } from "./util";

export type { FakeApplicant, FakeJob, PortalSlug } from "./model";
export { PORTAL_SLUGS } from "./model";

/**
 * Portales de empleo FALSOS (LinkedIn, Bumeran, Trabajos Diarios, Indeed y
 * Computrabajo, solo de nombre) para probar el robot y hacer la demostración sin
 * tocar un portal real. Un solo servidor monta cinco sitios en `/<slug>`.
 * Las rutas de la raíz `/login`, `/empleos…` y `/cv/…` son un alias de
 * `/trabajos-diarios` (el portal falso original) por compatibilidad.
 */
export interface FakePortal {
  url: string;
  /** Todas las ofertas, de cualquier portal (los ids son únicos en todo el servidor). */
  jobs: Map<string, FakeJob>;
  /** Simula una sesión no iniciada (el portal redirige a su /login). Sin `portal`, en los cinco. */
  setLoggedIn(value: boolean, portal?: PortalSlug): void;
  /** Simula que el portal pide un CAPTCHA. */
  setCaptcha(value: boolean, portal?: PortalSlug): void;
  /** Simula que el portal cambió su formulario. */
  setChanged(value: boolean, portal?: PortalSlug): void;
  /** Simula que el portal rechaza la oferta. */
  setRejecting(value: boolean, portal?: PortalSlug): void;
  /** Cambios de estructura de los portales (variantes, diario y programador). */
  mutator: Mutator;
  close(): Promise<void>;
}

/** Opciones de `startFakePortal`. Sin ellas no hay temporizador ni diario en disco. */
export interface FakePortalOptions {
  mutation?: {
    /** Cada cuántos minutos cambia un portal solo (puede ser decimal). Sin él, el mutador solo cambia con `/__fake/mutaciones/aplicar`. */
    everyMinutes?: number;
    /** Semilla de la elección de mutaciones (misma semilla, misma secuencia). */
    seed?: number;
    /** Diario de cambios en disco (por ejemplo `bot/.state/mutaciones.json`). */
    diaryFile?: string;
    /** Modo continuo: restablece solo los estructurales (al ser detectados o al vencer su vida máxima). Sin él, se quedan hasta resolverlos. */
    autoRestore?: AutoRestoreOptions;
    /** Carpeta de incidentes del robot: la usan el modo continuo y el informe. Sin ella, se asume que no hay incidentes. */
    incidentsDir?: string;
    /** Informe en Markdown que se regenera solo (por ejemplo `bot/.state/informe-entrenamiento.md`). Sin él no hay regeneración periódica. */
    reportFile?: string;
    /** Cada cuántos minutos se regenera el informe (por defecto 15). */
    reportMinutes?: number;
    /** Reloj del mutador (pruebas). */
    now?: () => number;
    /** Registro de lo que hace el mutador; sin él, silencioso. */
    log?: (message: string) => void;
  };
}

/** Meta de la demostración (2 ofertas por portal) y cada cuánto se refresca el panel. */
const DEMO_GOAL = 10;
const REFRESH_SECONDS = 20;
const MAX_DRAFTS = 200;

const DASHBOARD_CSS = `*{box-sizing:border-box}body{margin:0;padding-top:34px;background:#f3f4f6;color:#1f2937;font-family:system-ui,sans-serif}
.sim-banner{position:fixed;top:0;left:0;right:0;height:34px;line-height:34px;background:#fde68a;color:#78350f;text-align:center;font:600 13px system-ui,sans-serif;z-index:1000;border-bottom:1px solid #f59e0b}
main{max-width:1100px;margin:1.5rem auto;padding:0 1rem}h1{margin:.2rem 0}.aviso{background:#fef3c7;padding:.75rem;border-radius:6px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:1rem}.card{background:#fff;border-radius:10px;padding:1rem 1.2rem;border-top:6px solid var(--c);box-shadow:0 1px 3px rgba(0,0,0,.12)}
.card h2{margin:.1rem 0}.card a{color:var(--c);font-weight:600;margin-right:.8rem}.small{font-size:.8rem;color:#6b7280}
table{width:100%;border-collapse:collapse;margin-top:.5rem;font-size:.9rem}td,th{border-bottom:1px solid #e5e7eb;padding:.35rem;text-align:left}
.sim a{font-weight:400;font-size:.8rem;margin-right:.5rem}`;

const html = (status: number, body: string) => ({ status, body });

const SITES_LABEL: Record<PortalSlug, string> = {
  linkedin: "LinkedIn",
  bumeran: "Bumeran",
  "trabajos-diarios": "Trabajos Diarios",
  indeed: "Indeed",
  computrabajo: "Computrabajo",
};

export async function startFakePortal(port = 0, options: FakePortalOptions = {}): Promise<FakePortal> {
  const mutation = options.mutation ?? {};
  const readIncidents = () => (mutation.incidentsDir ? listIncidentsSync(mutation.incidentsDir) : []);
  const mutator = createMutator({
    intervalMs: mutation.everyMinutes ? mutation.everyMinutes * 60_000 : undefined,
    seed: mutation.seed,
    diaryFile: mutation.diaryFile,
    autoRestore: mutation.autoRestore,
    incidents: readIncidents,
    now: mutation.now,
    log: mutation.log,
  });

  // Informe del entrenamiento: se regenera cada cierto tiempo (y bajo demanda) y se guarda en disco si hay archivo.
  let lastReport: { at: string; report: Informe } | null = null;
  function regenerateReport(): { at: string; report: Informe } {
    const at = new Date((mutation.now ?? Date.now)()).toISOString();
    const report = buildReport(mutator.state().cambios, readIncidents() as Parameters<typeof buildReport>[1]);
    lastReport = { at, report };
    if (mutation.reportFile) {
      try {
        writeFileAtomic(mutation.reportFile, renderMarkdown(report, { generadoEn: at }));
      } catch (error) {
        mutation.log?.(`No se pudo escribir el informe de entrenamiento: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return lastReport;
  }
  const reportMs = (mutation.reportMinutes ?? 15) * 60_000;
  let reportTimer: NodeJS.Timeout | undefined;
  /** Con regeneración periódica se muestra la última; sin ella (sin archivo), cada consulta calcula la actual. */
  const currentReport = (forceNew = false) => (forceNew || !lastReport || !reportTimer ? regenerateReport() : lastReport);
  const jobs = new Map<string, FakeJob>();
  const freshFlags = (): PortalFlags => ({ loggedIn: true, captcha: false, changed: false, rejecting: false });
  const flags = Object.fromEntries(PORTAL_SLUGS.map((slug) => [slug, freshFlags()])) as Record<PortalSlug, PortalFlags>;
  const drafts = new Map<string, ApplyDraft>();
  let jobCounter = 0;
  let applicantCounter = 0;
  let draftCounter = 0;

  const targets = (portal?: PortalSlug) => (portal ? [portal] : [...PORTAL_SLUGS]);
  const isSlug = (value: string | null | undefined): value is PortalSlug => PORTAL_SLUGS.includes(value as PortalSlug);

  const jobsOf = (slug: PortalSlug) => [...jobs.values()].filter((job) => job.portal === slug);

  /** Bloque «Entrenamiento» del panel: próximo cambio, últimos cambios y los estructurales sin resolver. */
  function trainingBlock(): string {
    const state = mutator.state();
    const when = (iso: string) => new Date(iso).toLocaleTimeString("es-PE");
    const row = (c: Cambio) =>
      `<tr><td>#${c.id}</td><td>${when(c.timestamp)}</td><td>${esc(SITES_LABEL[c.portal])}</td><td>${esc(c.mutacion)}</td><td>${c.tipo === "estructural" ? "estructural" : "cosmética"}</td><td>${c.estado}</td></tr>`;
    const next = state.proximoCambio
      ? `Próximo cambio en <strong data-hasta="${new Date(state.proximoCambio).getTime()}">…</strong> (cada ${state.cadaMinutos} min, semilla ${state.semilla}).`
      : "Cambios automáticos apagados (arranque con <code>--entrenar</code> o <code>BOT_FAKE_MUTATE_MINUTES</code>).";
    const pending = state.activas.filter((c) => c.tipo === "estructural");
    const pendingRows = pending
      .map(
        (c) =>
          `<li><strong>${esc(SITES_LABEL[c.portal])}</strong>: ${esc(c.mutacion)} (#${c.id}, ${when(c.timestamp)}). Debe notarlo: ${esc(c.esperado.join(", "))}. <a href="/__fake/mutaciones/resolver?portal=${c.portal}&volver=/">Aceptar como nuevo original (resuelto)</a> · <a href="/__fake/modo?portal=${c.portal}&restablecer=1&volver=/">Restablecer</a></li>`,
      )
      .join("");
    const latest = state.cambios.slice(-8).reverse().map(row).join("");
    const auto = state.restablecimientoAuto
      ? `Modo continuo: cada estructural se restablece solo ${state.restablecimientoAuto.graciaMin} min después de que el robot lo detecta, o a los ${state.restablecimientoAuto.vidaMaxMin} min si no lo detecta.`
      : "Modo continuo apagado: un estructural dura hasta resolverlo o restablecerlo.";
    const { at, report } = currentReport();
    const t = report.totales;
    const minutes = (value: number | null) => (value === null ? "–" : `${value} min`);
    const informe = `<p class="small">Informe (<a href="/__fake/informe">ver</a>), generado ${new Date(at).toLocaleTimeString("es-PE")}: detectados ${t.detectados} · escapados ${t.escapados} · falsas alarmas ${t.falsasAlarmas} · tiempo medio de detección ${minutes(t.tiempoMedioMin)} · reanudaciones ${report.resumenReanudaciones.total}.</p>`;
    return `<section class="card entrenamiento" style="--c:#7c3aed"><h2>Entrenamiento</h2><p>${next}</p>
<p class="small">${auto} Como máximo ${state.tope} portales con un cambio estructural sin resolver. Diario completo: <a href="/__fake/mutaciones">/__fake/mutaciones</a></p>${informe}
<h3>Estructurales sin resolver (${pending.length})</h3>${pendingRows ? `<ul>${pendingRows}</ul>` : '<p class="small">Ninguno.</p>'}
<h3>Últimos cambios</h3><table><thead><tr><th>N.º</th><th>Hora</th><th>Portal</th><th>Cambio</th><th>Tipo</th><th>Estado</th></tr></thead><tbody>${latest || '<tr><td colspan="6">Aún no hubo cambios.</td></tr>'}</tbody></table>
<script>(function(){var el=document.querySelector("[data-hasta]");if(!el)return;function t(){var s=Math.max(0,Math.round((Number(el.dataset.hasta)-Date.now())/1000));el.textContent=Math.floor(s/60)+" min "+(s%60)+" s"}t();setInterval(t,1000)})()</script></section>`;
  }

  function dashboard(): string {
    const list = [...jobs.values()];
    const reached = list.length >= DEMO_GOAL;
    const cards = PORTAL_SLUGS.map((slug) => {
      const site = mutator.siteOf(slug);
      const own = jobsOf(slug);
      const f = flags[slug];
      const rows = own
        .map(
          (job) =>
            `<tr><td><a href="/${slug}/empleo/${encodeURIComponent(job.id)}">${esc(job.title)}</a></td><td>${esc(site.statusText(job.status))}</td><td>${new Date(job.createdAt).toLocaleTimeString("es-PE")}</td><td>${job.applicants.length}</td></tr>`,
        )
        .join("");
      const modo = (query: string, label: string) => `<a href="/__fake/modo?portal=${slug}&${query}&volver=/">${label}</a>`;
      const state = [f.captcha && "CAPTCHA", !f.loggedIn && "sesión caída", f.changed && "formulario cambiado", f.rejecting && "rechaza ofertas"].filter(Boolean);
      return `<section class="card" style="--c:${site.accent}"><h2>${esc(site.wordmark)}</h2><p class="small">${esc(site.blurb)}</p>
<p><a href="/${slug}">Ver el sitio</a><a href="/${slug}${site.path.home}">Panel de empleador</a></p>
<p class="small sim">Simular: ${modo("captcha=1", "CAPTCHA")}${modo("sesion=0", "sesión caída")}${modo("cambiado=1", "formulario cambiado")}${modo("rechazar=1", "rechazar ofertas")}${modo("restablecer=1", "restablecer")}${state.length ? `<br><strong>Activo: ${state.join(", ")}</strong>` : ""}</p>
<table><thead><tr><th>Puesto</th><th>Estado</th><th>Hora</th><th>Postulantes</th></tr></thead><tbody>${rows || '<tr><td colspan="4">El robot aún no ha publicado ofertas aquí.</td></tr>'}</tbody></table></section>`;
    }).join("");
    return `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Panel de la demo · portales ficticios</title><meta http-equiv="refresh" content="${REFRESH_SECONDS}"><style>${DASHBOARD_CSS}</style><body><div class="sim-banner">Portal ficticio · simulación para demostración</div><main><h1>Ofertas publicadas por el robot</h1>
<p class="aviso">${reached ? "✔ Meta alcanzada: " : ""}${list.length} de ${DEMO_GOAL} · este panel se actualiza solo cada ${REFRESH_SECONDS} segundos (última actualización ${new Date().toLocaleTimeString("es-PE")}).</p><div class="grid">${cards}</div><div class="grid" style="margin-top:1rem">${trainingBlock()}</div></main></body></html>`;
  }

  function createJob(site: Site, values: Record<string, string>): FakeJob {
    const id = `fp-${++jobCounter}`;
    const { map } = site;
    const questions = [map.q1, map.q2].map((key) => (key ? (values[key] ?? "").trim() : "")).filter(Boolean);
    const job: FakeJob = {
      id,
      portal: site.slug,
      title: values[map.title] ?? "",
      description: values[map.description] ?? "",
      status: "activa",
      createdAt: new Date().toISOString(),
      applicants: [],
      company: map.company ? values[map.company] || undefined : undefined,
      location: values[map.location] || undefined,
      questions,
    };
    jobs.set(id, job);
    return job;
  }

  function validateCv(file: UploadedFile | undefined): string | null {
    if (file && Buffer.from(file.bytes.subarray(0, 4)).toString("latin1") !== "%PDF") return "El CV debe ser un archivo PDF.";
    return null;
  }

  function addApplicant(job: FakeJob, data: { nombre: string; correo: string; telefono: string; cv?: UploadedFile }): FakeApplicant {
    const applicant: FakeApplicant = {
      id: `c${++applicantCounter}`,
      fullName: data.nombre.trim(),
      email: data.correo.trim() || undefined,
      phone: data.telefono.trim() || undefined,
      resume:
        data.cv?.bytes ??
        minimalPdf([data.nombre.trim(), "Curriculum generado por la simulacion", `Postulacion a: ${job.title}`, "Datos ficticios para demostracion"]),
    };
    job.applicants.push(applicant);
    return applicant;
  }

  /** Un envío del formulario de publicar: devuelve la oferta creada o la página a mostrar. */
  function publishStep(site: Site, base: string, fields: Record<string, string>, flag: PortalFlags): { job: FakeJob } | { status: number; body: string } {
    const values = { ...fields };
    delete values.paso;
    delete values.accion;
    const total = site.steps.length;
    const step = Math.min(Math.max(Number(fields.paso) || 1, 1), total);
    const action = total === 1 ? "publicar" : fields.accion;
    const titleMissing = !flag.changed && !(values[site.map.title] ?? "").trim();
    // Campos obligatorios (variante «campo nuevo obligatorio»): los del paso actual al avanzar; todos al publicar.
    const missing = (action === "siguiente" ? site.steps[step - 1]!.fields : site.steps.flatMap((s) => s.fields)).find(
      (field) => field.required && !(values[field.name] ?? "").trim(),
    );
    if (action === "atras") return html(200, renderStep(site, base, Math.max(1, step - 1), values, { changed: flag.changed }));
    if (action === "siguiente") {
      if (step === 1 && titleMissing) {
        return html(200, renderStep(site, base, 1, values, { changed: flag.changed, error: "Completa el título del puesto para continuar." }));
      }
      if (missing) return html(200, renderStep(site, base, step, values, { changed: flag.changed, error: `Completa «${missing.label}».` }));
      return html(200, renderStep(site, base, Math.min(total, step + 1), values, { changed: flag.changed }));
    }
    if (titleMissing) {
      return html(200, renderStep(site, base, 1, values, { changed: flag.changed, error: "Completa el título del puesto." }));
    }
    if (missing) return html(200, renderStep(site, base, 1, values, { changed: flag.changed, error: `Completa «${missing.label}».` }));
    if (flag.rejecting) {
      return html(
        200,
        layout(site, base, "Oferta rechazada", `<section class="card"><h1>No se pudo publicar</h1><div class="err"><p ${site.attrs.error}>Contenido no permitido</p></div></section>`),
      );
    }
    return { job: createJob(site, values) };
  }

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", "http://fake.local");
    const method = request.method ?? "GET";
    const pathname = url.pathname;
    const send = (status: number, body: string, headers: Record<string, string> = {}) => {
      response.writeHead(status, { "content-type": "text/html; charset=utf-8", ...headers });
      response.end(body);
    };
    const sendPage = (page: { status: number; body: string }) => send(page.status, page.body);
    const redirect = (status: number, location: string) => send(status, "", { location });
    const jsonHeaders = { "content-type": "application/json" };

    // ---- Solo para pruebas manuales y la demo: dañar o arreglar un portal.
    // /__fake/modo?portal=linkedin&cambiado=1&captcha=0&sesion=1&rechazar=0&restablecer=1&volver=/
    if (pathname === "/__fake/modo" && (method === "POST" || method === "GET")) {
      const portal = url.searchParams.get("portal");
      if (portal && !isSlug(portal)) return send(400, JSON.stringify({ error: "portal desconocido" }), jsonHeaders);
      const param = (name: string) => url.searchParams.get(name);
      for (const slug of targets(portal as PortalSlug | undefined)) {
        const f = flags[slug];
        if (param("restablecer") === "1") Object.assign(f, freshFlags());
        if (param("cambiado") !== null) f.changed = param("cambiado") === "1";
        if (param("captcha") !== null) f.captcha = param("captcha") === "1";
        if (param("sesion") !== null) f.loggedIn = param("sesion") === "1";
        if (param("rechazar") !== null) f.rejecting = param("rechazar") === "1";
      }
      // «Restablecer» también devuelve la estructura del portal al original y marca el cambio como restablecido.
      if (param("restablecer") === "1") mutator.restore(isSlug(portal) ? portal : undefined);
      const back = param("volver");
      if (back && back.startsWith("/") && !back.startsWith("//")) return redirect(303, back);
      return send(200, JSON.stringify(flags), jsonHeaders);
    }

    // ---- Informe del entrenamiento (HTML). `?actualizar=1` lo regenera ahora; si no, muestra el último generado.
    if (pathname === "/__fake/informe" && method === "GET") {
      const { at, report } = currentReport(url.searchParams.get("actualizar") === "1");
      return send(200, renderHtml(report, { generadoEn: at, refreshSeconds: 60 }));
    }

    // ---- Entrenamiento: diario y estado, forzar un cambio, aceptar el estado actual como original.
    // /__fake/mutaciones · /__fake/mutaciones/aplicar?portal=X&cambio=<id> · /__fake/mutaciones/resolver?portal=X
    if (pathname.startsWith("/__fake/mutaciones") && (method === "POST" || method === "GET")) {
      const fail = (status: number, error: string) => send(status, JSON.stringify({ error }), jsonHeaders);
      const portal = url.searchParams.get("portal");
      const back = url.searchParams.get("volver");
      const done = (body: unknown) =>
        back && back.startsWith("/") && !back.startsWith("//") ? redirect(303, back) : send(200, JSON.stringify(body, null, 2), jsonHeaders);
      if (pathname === "/__fake/mutaciones") return send(200, JSON.stringify(mutator.state(), null, 2), jsonHeaders);
      if (pathname === "/__fake/mutaciones/aplicar" || pathname === "/__fake/mutaciones/resolver") {
        if (!isSlug(portal)) return fail(400, "portal desconocido o ausente");
        if (pathname.endsWith("/resolver")) return done(mutator.resolve(portal));
        try {
          return done(mutator.apply(portal, url.searchParams.get("cambio") ?? ""));
        } catch (error) {
          return fail(400, error instanceof Error ? error.message : String(error));
        }
      }
      return fail(404, "ruta desconocida");
    }

    // Solo para pruebas manuales: agrega un postulante a una oferta.
    // Cuerpo JSON: { id, fullName, email?, phone?, resumeBase64 }.
    const seed = /^\/__fake\/empleos\/([^/]+)\/postulantes$/.exec(pathname);
    if (method === "POST" && seed) {
      const job = jobs.get(seed[1]!);
      if (!job) return send(404, "{}", jsonHeaders);
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk as Buffer);
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as FakeApplicant & { resumeBase64: string };
      job.applicants.push({
        id: body.id,
        fullName: body.fullName,
        email: body.email,
        phone: body.phone,
        resume: new Uint8Array(Buffer.from(body.resumeBase64, "base64")),
      });
      return send(200, "{}", jsonHeaders);
    }

    if (method === "GET" && pathname === "/") return send(200, dashboard());

    // ---- Elegir el sitio: /<slug>/… o el alias de la raíz (portal falso original).
    const first = pathname.split("/")[1] ?? "";
    let site: Site;
    let base = "";
    let rel = pathname;
    if (isSlug(first)) {
      site = mutator.siteOf(first);
      base = `/${first}`;
      rel = pathname.slice(base.length) || "/";
    } else if (/^\/(login|empleos|cv)(\/|$)/.test(pathname)) {
      site = mutator.siteOf("trabajos-diarios");
    } else {
      return send(404, `<!doctype html><meta charset="utf-8"><title>No existe</title><p>No existe. <a href="/">Panel de la demo</a></p>`);
    }
    const f = flags[site.slug];
    const p = site.path;
    const notFound = () => send(404, renderMessage(site, base, "No existe", "La página no existe.", "err"));
    const match = (template: string) => new RegExp(`^${template.replace(/:[a-z]+/g, "([^/]+)")}$`).exec(rel)?.slice(1).map(decodeURIComponent);

    // ---- Lado público (candidato)
    if (method === "GET" && rel === "/") return send(200, renderLanding(site, base, jobsOf(site.slug)));
    if (rel === p.login) {
      if (method === "POST") {
        f.loggedIn = true;
        return redirect(303, `${base}${p.home}`);
      }
      return send(200, renderLogin(site, base));
    }
    const publicRoute = /^\/empleo\/([^/]+)(\/postular)?$/.exec(rel);
    if (publicRoute) {
      const job = jobs.get(decodeURIComponent(publicRoute[1]!));
      if (!job || job.portal !== site.slug) return notFound();
      if (!publicRoute[2]) return send(200, renderPublicJob(site, base, job));
      if (job.status !== "activa") return send(410, renderPublicJob(site, base, job));
      return sendPage(await handleApply(site, base, job, method, request));
    }

    // ---- Lado empleador (lo usa el robot)
    if (!f.loggedIn) return redirect(302, `${base}${p.login}`);

    const resume = match(p.resume);
    if (method === "GET" && resume) {
      const applicant = jobs.get(resume[0]!)?.applicants.find((a) => a.id === resume[1]);
      if (!applicant) return notFound();
      response.writeHead(200, {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="cv-${applicant.id}.pdf"`,
      });
      return void response.end(Buffer.from(applicant.resume));
    }

    if (f.captcha) return send(200, renderCaptcha(site, base, `${base}${rel}`));

    if (method === "GET" && rel === p.home) return send(200, renderEmployerHome(site, base, jobsOf(site.slug)));
    if (method === "GET" && rel === p.publishForm) return send(200, renderStep(site, base, 1, {}, { changed: f.changed }));
    if (method === "POST" && rel === p.publishPost) {
      const { fields } = await readBody(request);
      const result = publishStep(site, base, fields, f);
      return "job" in result ? redirect(303, `${base}${fill(p.job, result.job.id)}`) : sendPage(result);
    }

    const detail = method === "GET" ? match(p.job) : undefined;
    if (detail) {
      const job = jobs.get(detail[0]!);
      return job && job.portal === site.slug ? send(200, renderEmployerJob(site, base, job)) : notFound();
    }
    const list = method === "GET" ? match(p.applicants) : undefined;
    if (list) {
      const job = jobs.get(list[0]!);
      return job && job.portal === site.slug ? send(200, renderApplicants(site, base, job, Number(url.searchParams.get("pagina")) || 1)) : notFound();
    }
    const close = method === "POST" ? match(p.close) : undefined;
    if (close) {
      const job = jobs.get(close[0]!);
      if (!job || job.portal !== site.slug) return notFound();
      job.status = "retirada";
      return redirect(303, `${base}${fill(p.job, job.id)}`);
    }
    return notFound();
  }

  /** Lado candidato: postular (formulario simple, o «Postulación sencilla» en LinkedIn). */
  async function handleApply(
    site: Site,
    base: string,
    job: FakeJob,
    method: string,
    request: IncomingMessage,
  ): Promise<{ status: number; body: string }> {
    if (site.slug !== "linkedin") {
      if (method !== "POST") return html(200, renderPublicJob(site, base, job));
      const { fields, files } = await readBody(request);
      const nombre = (fields.nombre ?? "").trim();
      const error = !nombre ? "Escribe tu nombre completo." : validateCv(files.cv);
      if (error) return html(200, renderPublicJob(site, base, job, error));
      addApplicant(job, { nombre, correo: fields.correo ?? "", telefono: fields.telefono ?? "", cv: files.cv });
      return html(200, renderMessage(site, base, "Postulación enviada", `Tu postulación a «${job.title}» fue enviada (simulación).`));
    }

    // LinkedIn ficticio: datos de contacto → CV → preguntas → revisar → enviar → confirmación.
    if (method !== "POST") return html(200, renderEasyApplyStep(site, base, job, 1, "", { jobId: job.id, nombre: "", correo: "", telefono: "", respuestas: [] }));
    const { fields, files } = await readBody(request);
    let draftId = fields.borrador ?? "";
    let draft = drafts.get(draftId);
    if (!draft || draft.jobId !== job.id) {
      if (drafts.size >= MAX_DRAFTS) drafts.delete(drafts.keys().next().value!);
      draftId = `b${++draftCounter}`;
      draft = { jobId: job.id, nombre: "", correo: "", telefono: "", respuestas: [] };
      drafts.set(draftId, draft);
    }
    const step = Math.min(Math.max(Number(fields.paso) || 1, 1), EASY_APPLY_STEPS.length);
    if (step === 1) {
      draft.nombre = fields.nombre ?? "";
      draft.correo = fields.correo ?? "";
      draft.telefono = fields.telefono ?? "";
    } else if (step === 2 && files.cv) {
      const cvError = validateCv(files.cv);
      if (cvError) return html(200, renderEasyApplyStep(site, base, job, 2, draftId, draft, cvError));
      draft.cv = files.cv;
    } else if (step === 3) {
      draft.respuestas = (job.questions ?? []).map((_, index) => fields[`r${index}`] ?? "");
    }

    if (fields.accion === "atras") return html(200, renderEasyApplyStep(site, base, job, Math.max(1, step - 1), draftId, draft));
    const contactMissing = !draft.nombre.trim() || !draft.correo.trim();
    if (contactMissing && step >= 1) {
      return html(200, renderEasyApplyStep(site, base, job, 1, draftId, draft, "Escribe tu nombre y correo para continuar."));
    }
    if (fields.accion === "enviar") {
      addApplicant(job, draft);
      drafts.delete(draftId);
      return html(200, renderMessage(site, base, "Postulación enviada", `Tu postulación a «${job.title}» fue enviada (simulación).`));
    }
    return html(200, renderEasyApplyStep(site, base, job, Math.min(EASY_APPLY_STEPS.length, step + 1), draftId, draft));
  }

  const server: Server = createServer((request, response) => {
    handle(request, response).catch((error) => {
      if (!response.headersSent) response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end(`Error del portal ficticio: ${error instanceof Error ? error.message : String(error)}`);
    });
  });

  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const { port: actual } = server.address() as AddressInfo;

  const setFlag = (key: keyof PortalFlags) => (value: boolean, portal?: PortalSlug) => {
    for (const slug of targets(portal)) flags[slug][key] = value;
  };

  mutator.start();
  if (mutation.reportFile && reportMs > 0) {
    regenerateReport();
    reportTimer = setInterval(regenerateReport, reportMs);
    reportTimer.unref();
  }

  return {
    url: `http://127.0.0.1:${actual}`,
    jobs,
    mutator,
    setLoggedIn: setFlag("loggedIn"),
    setCaptcha: setFlag("captcha"),
    setChanged: setFlag("changed"),
    setRejecting: setFlag("rejecting"),
    close: () =>
      new Promise<void>((resolve, reject) => {
        mutator.stop();
        if (reportTimer) clearInterval(reportTimer);
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

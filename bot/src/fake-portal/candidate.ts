import type { FakeJob } from "./model";
import { layout, type Site } from "./sites";
import { esc, type UploadedFile } from "./util";

/** Lado público (candidato) de los portales ficticios y pantallas sueltas (inicio, ingreso, CAPTCHA). */

export function renderLanding(site: Site, base: string, jobs: FakeJob[]): string {
  const open = jobs.filter((job) => job.status === "activa");
  const cards = open
    .map(
      (job) =>
        `<li class="card"><strong>${esc(job.title)}</strong><br>${esc([job.company, job.location].filter(Boolean).join(" · "))}<br><a href="${base}/empleo/${encodeURIComponent(job.id)}">Ver la oferta y postular</a></li>`,
    )
    .join("");
  return layout(
    site,
    base,
    "Empleos",
    `<h1>Empleos publicados</h1><p>${esc(site.blurb)}</p><p><a class="btn" href="${base}${site.path.home}">Entrar como empleador</a></p><ul class="lista">${cards || '<li class="card">Aún no hay ofertas publicadas por el robot.</li>'}</ul>`,
  );
}

export function renderLogin(site: Site, base: string): string {
  return layout(
    site,
    base,
    "Ingresar",
    `<section class="card"><h1>Ingresar</h1><p>Simulación: el robot nunca escribe usuario ni contraseña. Una persona inicia sesión a mano y la sesión queda guardada.</p>
<form method="post" action="${base}${site.path.login}"><input type="text" placeholder="Correo (no se usa)" disabled><input type="text" placeholder="Contraseña (no se usa)" disabled><button type="submit">Simular inicio de sesión</button></form></section>`,
  );
}

export function renderCaptcha(site: Site, base: string, returnTo: string): string {
  const action = `/__fake/modo?portal=${site.slug}&captcha=0&volver=${encodeURIComponent(returnTo)}`;
  return layout(
    site,
    base,
    "Verificación",
    `<section class="card"><div ${site.attrs.captcha}><h1>Verificación de seguridad</h1><p>Demuestra que eres humano (simulación). El robot no intenta resolver esto: se detiene y avisa.</p></div>
<form method="post" action="${action}"><button type="submit">Ya lo resolví (simulación)</button></form></section>`,
  );
}

export function renderMessage(site: Site, base: string, title: string, message: string, kind: "ok" | "err" = "ok"): string {
  return layout(site, base, title, `<section class="card"><h1>${esc(title)}</h1><p class="${kind}">${esc(message)}</p><p><a href="${base || "/" + site.slug}">Volver a los empleos</a></p></section>`);
}

export function renderPublicJob(site: Site, base: string, job: FakeJob, error?: string): string {
  const header = `<section class="card"><h1>${esc(job.title)}</h1><p>${esc([job.company, job.location].filter(Boolean).join(" · "))}</p><p>${esc(job.description)}</p></section>`;
  if (job.status !== "activa") {
    return layout(site, base, job.title, `${header}<p class="err">Esta oferta ya no está disponible.</p>`);
  }
  const apply =
    site.slug === "linkedin"
      ? `<p><a class="btn" id="li-postular" href="${base}/empleo/${encodeURIComponent(job.id)}/postular">Postulación sencilla</a></p>`
      : `<section class="card"><h2>Postular a esta oferta</h2>${error ? `<p class="err">${esc(error)}</p>` : ""}
<form method="post" enctype="multipart/form-data" action="${base}/empleo/${encodeURIComponent(job.id)}/postular">
<label>Nombre completo<input type="text" name="nombre" required></label>
<label>Correo<input type="text" name="correo"></label>
<label>Teléfono<input type="text" name="telefono"></label>
<label>CV en PDF (opcional: si no adjuntas, se genera uno con tu nombre)<input type="file" name="cv" accept="application/pdf,.pdf"></label>
<button type="submit">Postular</button></form></section>`;
  return layout(site, base, job.title, header + apply);
}

/** Estado del flujo «Postulación sencilla» (LinkedIn ficticio); vive en el servidor porque incluye el archivo. */
export interface ApplyDraft {
  jobId: string;
  nombre: string;
  correo: string;
  telefono: string;
  cv?: UploadedFile;
  respuestas: string[];
}

export const EASY_APPLY_STEPS = ["Datos de contacto", "Currículum", "Preguntas de selección", "Revisar tu postulación"] as const;

export function renderEasyApplyStep(
  site: Site,
  base: string,
  job: FakeJob,
  step: number,
  draftId: string,
  draft: ApplyDraft,
  error?: string,
): string {
  const questions = job.questions ?? [];
  let fields = "";
  if (step === 1) {
    fields = `<div class="campo"><label for="ea-nombre">Nombre completo</label><input type="text" id="ea-nombre" name="nombre" value="${esc(draft.nombre)}"></div>
<div class="campo"><label for="ea-correo">Correo electrónico</label><input type="text" id="ea-correo" name="correo" value="${esc(draft.correo)}"></div>
<div class="campo"><label for="ea-telefono">Teléfono</label><input type="text" id="ea-telefono" name="telefono" value="${esc(draft.telefono)}"></div>`;
  } else if (step === 2) {
    fields = `<p>${draft.cv ? `CV adjunto: <strong id="ea-cv-actual">${esc(draft.cv.filename)}</strong>` : "Aún no adjuntas un CV. Si lo dejas vacío, se genera un PDF mínimo con tu nombre."}</p>
<div class="campo"><label for="ea-cv">Subir CV (PDF)</label><input type="file" id="ea-cv" name="cv" accept="application/pdf,.pdf"></div>`;
  } else if (step === 3) {
    fields = questions.length
      ? questions
          .map(
            (question, index) =>
              `<div class="campo"><label for="ea-r${index}">${esc(question)}</label><input type="text" id="ea-r${index}" name="r${index}" value="${esc(draft.respuestas[index] ?? "")}"></div>`,
          )
          .join("")
      : "<p>Esta oferta no tiene preguntas de selección.</p>";
  } else {
    fields = `<dl class="resumen"><dt>Nombre</dt><dd>${esc(draft.nombre)}</dd><dt>Correo</dt><dd>${esc(draft.correo)}</dd><dt>Teléfono</dt><dd>${esc(draft.telefono || "—")}</dd><dt>CV</dt><dd>${esc(draft.cv?.filename ?? "se generará un PDF con tu nombre")}</dd></dl>`;
  }
  const last = step === EASY_APPLY_STEPS.length;
  const buttons = [
    step > 1 ? '<button type="submit" class="sec" name="accion" value="atras" id="ea-atras" formnovalidate>Atrás</button>' : "",
    last
      ? '<button type="submit" name="accion" value="enviar" id="ea-enviar">Enviar postulación</button>'
      : '<button type="submit" name="accion" value="siguiente" id="ea-siguiente">Siguiente</button>',
  ].join("");
  return layout(
    site,
    base,
    "Postulación sencilla",
    `<section class="card" id="ea-paso-${step}"><p class="progreso">Postulación sencilla · paso ${step} de ${EASY_APPLY_STEPS.length}</p><h1>${esc(EASY_APPLY_STEPS[step - 1]!)}</h1><p>${esc(job.title)}</p>${error ? `<p class="err">${esc(error)}</p>` : ""}
<form method="post" enctype="multipart/form-data" action="${base}/empleo/${encodeURIComponent(job.id)}/postular"><input type="hidden" name="paso" value="${step}"><input type="hidden" name="borrador" value="${esc(draftId)}">${fields}<div class="acciones">${buttons}</div></form></section>`,
  );
}

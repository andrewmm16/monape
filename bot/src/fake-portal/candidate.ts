import { PALABRA_DESAFIO, SLIDER_OBJETIVO, SLIDER_TOLERANCIA, type Desafio, type FakeJob } from "./model";
import { layout, type Site } from "./sites";
import { esc, type UploadedFile } from "./util";

/** Lado público (candidato) de los portales ficticios y pantallas sueltas (inicio, ingreso, desafío). */

export { PALABRA_DESAFIO };

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

/** Campo oculto (honeypot): un humano no lo rellena; un bot ingenuo sí. Si llega con valor, la verificación falla. */
const HONEYPOT = `<input data-desafio-trampa name="trampa" type="text" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0">`;

/**
 * Pantalla de desafío de verificación (simulación). El robot la resuelve con lógica
 * interna (`utils/captcha-solver.ts`), SIN intervención humana: lee el dato del DOM
 * (que nosotros controlamos) y actúa según el tipo. Cada tipo imita la mecánica de un
 * captcha real (casilla, cuadrícula de imágenes, slider, rotar, texto/aritmética, OTP).
 */
export function renderDesafio(site: Site, base: string, desafio: Desafio, returnTo: string, error?: string): string {
  const action = `/__fake/desafio?portal=${site.slug}&volver=${encodeURIComponent(returnTo)}`;
  let pregunta: string;
  let campo: string;
  let script = "";

  if (desafio.tipo === "suma") {
    pregunta = `¿Cuánto es ${desafio.a} + ${desafio.b}? (simulación)`;
    campo = `<input data-desafio-respuesta name="respuesta" type="text" autocomplete="off" inputmode="numeric">${HONEYPOT}`;
  } else if (desafio.tipo === "texto") {
    pregunta = `Escribe la palabra «${desafio.palabra ?? PALABRA_DESAFIO}» para continuar (simulación).`;
    campo = `<input data-desafio-respuesta name="respuesta" type="text" autocomplete="off">${HONEYPOT}`;
  } else if (desafio.tipo === "casilla") {
    pregunta = "Marca la casilla para confirmar que no eres un robot (simulación).";
    campo = `<label style="display:flex;align-items:center;gap:.5rem;cursor:pointer;user-select:none"><span data-desafio-casilla role="checkbox" aria-checked="false" tabindex="0" style="display:inline-block;width:24px;height:24px;border:2px solid #6b7280;border-radius:4px;background:#fff"></span> No soy un robot</label>
<input data-desafio-respuesta name="respuesta" type="hidden" value="">
<input data-desafio-tiempo name="tiempo" type="hidden" value="0">${HONEYPOT}`;
    script = `<script>(function(){var t0=Date.now(),b=document.querySelector('[data-desafio-casilla]'),r=document.querySelector('[data-desafio-respuesta]'),ti=document.querySelector('[data-desafio-tiempo]');if(!b||!r)return;b.addEventListener('click',function(){r.value='ok';if(ti)ti.value=String(Date.now()-t0);b.setAttribute('aria-checked','true');b.style.background='#2563eb';b.style.borderColor='#2563eb';});})();</script>`;
  } else if (desafio.tipo === "imagenes") {
    pregunta = `Selecciona todas las casillas marcadas con «${desafio.categoria ?? "✓"}» (simulación).`;
    const celdas = (desafio.celdas ?? [])
      .map(
        (correcta, i) =>
          `<button type="button" data-desafio-celda data-indice="${i}" data-correcta="${correcta ? "true" : "false"}" aria-label="casilla ${i + 1}" style="width:48px;height:48px;font-size:1.3rem;border:1px solid #cbd5e1;background:#f8fafc;cursor:pointer">${correcta ? esc(desafio.categoria ?? "✓") : "·"}</button>`,
      )
      .join("");
    campo = `<div data-desafio-grilla style="display:grid;grid-template-columns:repeat(3,48px);gap:6px;margin:.6rem 0">${celdas}</div>
<input data-desafio-respuesta name="respuesta" type="hidden" value="">${HONEYPOT}`;
    script = `<script>(function(){var sel=[],r=document.querySelector('[data-desafio-respuesta]');document.querySelectorAll('[data-desafio-celda]').forEach(function(c){c.addEventListener('click',function(){var i=Number(c.getAttribute('data-indice')),k=sel.indexOf(i);if(k<0){sel.push(i);c.style.outline='3px solid #2563eb';}else{sel.splice(k,1);c.style.outline='';}r.value=sel.slice().sort(function(a,b){return a-b;}).join(',');});});})();</script>`;
  } else if (desafio.tipo === "rotar") {
    const angulo = desafio.angulo ?? 0;
    pregunta = "Gira la imagen con el botón hasta dejar la flecha apuntando hacia arriba (simulación).";
    campo = `<div style="width:80px;height:80px;display:flex;align-items:center;justify-content:center;border:1px solid #cbd5e1;margin:.6rem 0"><div data-desafio-rotar data-angulo="${angulo}" data-objetivo="${desafio.anguloObjetivo ?? 0}" style="font-size:2.5rem;transform:rotate(${angulo}deg)">⬆</div></div>
<button type="button" data-desafio-girar>Girar 90°</button>
<input data-desafio-respuesta name="respuesta" type="hidden" value="${angulo}">${HONEYPOT}`;
    script = `<script>(function(){var img=document.querySelector('[data-desafio-rotar]'),g=document.querySelector('[data-desafio-girar]'),r=document.querySelector('[data-desafio-respuesta]');if(!img||!g||!r)return;g.addEventListener('click',function(){var a=(Number(img.getAttribute('data-angulo'))+90)%360;img.setAttribute('data-angulo',String(a));img.style.transform='rotate('+a+'deg)';r.value=String(a);});})();</script>`;
  } else if (desafio.tipo === "otp") {
    pregunta = "Ingresa el código de 6 dígitos que enviamos a tu correo (simulación).";
    campo = `<p data-desafio-otp class="small">Se envió un código al correo de la cuenta. El robot lo lee de su buzón.</p>
<input data-desafio-respuesta name="respuesta" type="text" autocomplete="off" inputmode="numeric" maxlength="6">${HONEYPOT}`;
  } else {
    // slider
    const objetivo = desafio.objetivo ?? SLIDER_OBJETIVO;
    const tolerancia = desafio.tolerancia ?? SLIDER_TOLERANCIA;
    pregunta = "Arrastra el control hasta el recuadro marcado (simulación).";
    campo = `<div data-desafio-pista data-objetivo="${objetivo}" data-tolerancia="${tolerancia}" style="position:relative;width:300px;height:40px;background:#e5e7eb;border-radius:6px;margin:.6rem 0">
<div style="position:absolute;top:0;left:${objetivo}px;width:40px;height:40px;border:2px dashed #9ca3af;border-radius:6px;box-sizing:border-box"></div>
<div data-desafio-slider style="position:absolute;left:0;top:0;width:40px;height:40px;background:#6b7280;border-radius:6px;cursor:grab;touch-action:none"></div></div>
<input data-desafio-respuesta name="respuesta" type="hidden" value="0">${HONEYPOT}`;
    script = `<script>(function(){var t=document.querySelector('[data-desafio-pista]'),h=document.querySelector('[data-desafio-slider]'),o=document.querySelector('[data-desafio-respuesta]');if(!t||!h||!o)return;var d=false;function set(cx){var rb=t.getBoundingClientRect(),m=rb.width-h.offsetWidth,x=Math.max(0,Math.min(m,cx-rb.left-h.offsetWidth/2));h.style.left=x+'px';o.value=String(Math.round(x));}h.addEventListener('pointerdown',function(){d=true;});window.addEventListener('pointermove',function(e){if(d)set(e.clientX);});window.addEventListener('pointerup',function(){d=false;});})();</script>`;
  }

  return layout(
    site,
    base,
    "Verificación",
    `<section class="card"><div data-desafio><h1>Verificación de seguridad</h1>
<p>Desafío automático (simulación). El robot lo resuelve con lógica interna, sin servicios externos ni intervención humana.</p>
${error ? `<p class="err">${esc(error)}</p>` : ""}
<form method="post" action="${action}"><p data-desafio-pregunta>${esc(pregunta)}</p>${campo}
<button data-desafio-enviar type="submit">Verificar</button></form></div></section>${script}`,
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

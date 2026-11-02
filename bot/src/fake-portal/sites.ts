import type { FakeJob, PortalSlug } from "./model";
import { esc } from "./util";
import type { Variant } from "./variants";

/**
 * Los cinco sitios FICTICIOS de la demostración. Cada uno tiene identidad visual
 * propia inspirada (colores y tipografía aproximados, nombre propio en texto; sin
 * logos, imágenes ni textos de marca) y, a propósito, ids, clases y estructura
 * distintos, como pasa entre portales reales: por eso cada uno tiene su adaptador.
 */
export interface Field {
  name: string;
  id?: string;
  label: string;
  kind: "text" | "textarea" | "select" | "radio" | "checkbox";
  options?: [string, string][];
  /** Campo obligatorio: el navegador y el servidor no dejan avanzar si está vacío. */
  required?: boolean;
}

export interface Step {
  title: string;
  fields: Field[];
  /** Muestra el resumen de todo lo escrito antes de publicar. */
  review?: boolean;
}

export interface Site {
  slug: PortalSlug;
  /** Nombre en texto del sitio (no es un logo). */
  wordmark: string;
  blurb: string;
  /** Color de la tarjeta en el panel de la demo. */
  accent: string;
  css: string;
  steps: Step[];
  /** Nombres de los campos del formulario que alimentan la oferta. */
  map: { title: string; description: string; location: string; company?: string; q1?: string; q2?: string };
  /** Rutas relativas al sitio; `:id`, `:job` y `:app` son parámetros. */
  path: {
    home: string;
    login: string;
    publishForm: string;
    publishPost: string;
    job: string;
    applicants: string;
    resume: string;
    close: string;
  };
  /** Atributos HTML de los elementos que el adaptador de ESTE portal busca. */
  attrs: {
    title: string;
    status: string;
    close: string;
    error: string;
    captcha: string;
    home: string;
    view: string;
    next: string;
    back: string;
    publish: string;
  };
  stepAttrs(n: number): string;
  field(field: Field, value: string): string;
  applicants(job: FakeJob, base: string): string;
  statusText(status: FakeJob["status"]): string;
  labels: { next: string; back: string; publish: string; close: string; view: string };
  /** Cambios de estructura vigentes (solo en un sitio ya resuelto con `resolveSite`); sin él, el sitio es el original. */
  variant?: Variant;
}

export const fill = (template: string, ...values: string[]) => {
  let index = 0;
  return template.replace(/:[a-z]+/g, () => encodeURIComponent(values[index++] ?? ""));
};

function control(field: Field, value: string, id: string | undefined): string {
  const idAttr = id ? ` id="${id}"` : "";
  const name = ` name="${field.name}"${field.required ? " required" : ""}`;
  switch (field.kind) {
    case "textarea":
      return `<textarea${idAttr}${name} rows="5">${esc(value)}</textarea>`;
    case "select":
      return `<select${idAttr}${name}>${(field.options ?? [])
        .map(([v, label]) => `<option value="${esc(v)}"${v === value ? " selected" : ""}>${esc(label)}</option>`)
        .join("")}</select>`;
    case "radio": {
      const selected = value || field.options?.[0]?.[0];
      return (field.options ?? [])
        .map(
          ([v, label]) =>
            `<label class="opt"><input type="radio"${name} value="${esc(v)}" id="${id}-${esc(v)}"${v === selected ? " checked" : ""}> ${esc(label)}</label>`,
        )
        .join("");
    }
    case "checkbox":
      return `<input type="checkbox"${idAttr}${name} value="1"${value === "1" ? " checked" : ""}>`;
    default:
      return `<input type="text"${idAttr}${name} value="${esc(value)}">`;
  }
}

const OPEN = (status: FakeJob["status"], open: string, closed: string) => (status === "activa" ? open : closed);

const MODALIDADES: [string, string][] = [
  ["presencial", "Presencial"],
  ["hibrido", "Híbrido"],
  ["remoto", "Remoto"],
];

// ---------------------------------------------------------------- LinkedIn
const linkedin: Site = {
  slug: "linkedin",
  wordmark: "Linkedin (simulación)",
  blurb: "Red profesional: asistente de 4 pasos para publicar y «Postulación sencilla» para candidatos.",
  accent: "#0a66c2",
  css: `body.linkedin{background:#f3f2ef;color:#191919;font-family:-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
.linkedin .hd{background:#fff;border-bottom:1px solid #e0dfdc}.linkedin .logo{color:#0a66c2;font-weight:700;font-size:1.25rem}.linkedin .hd a{color:#444}
.linkedin .card{background:#fff;border:1px solid #e0dfdc;border-radius:8px}
.linkedin input[type=text],.linkedin textarea,.linkedin select{border:1px solid #666;border-radius:4px}
.linkedin button,.linkedin .btn{background:#0a66c2;color:#fff;border:0;border-radius:999px;font-weight:600}.linkedin .sec{background:#fff;color:#0a66c2;border:1px solid #0a66c2}
.linkedin .progreso{color:#666;font-size:.85rem;margin:0}.linkedin h1{font-weight:600;font-size:1.4rem}.linkedin .chip{background:#e8f3ff;color:#0a66c2}`,
  steps: [
    {
      title: "Detalles del empleo",
      fields: [
        { name: "titulo", id: "li-titulo", label: "Cargo", kind: "text" },
        { name: "empresa", id: "li-empresa", label: "Empresa", kind: "text" },
        { name: "ubicacion", id: "li-ubicacion", label: "Ubicación del empleo", kind: "text" },
        { name: "modalidad", id: "li-modalidad", label: "Modalidad del lugar de trabajo", kind: "select", options: MODALIDADES },
        {
          name: "contrato",
          id: "li-contrato",
          label: "Tipo de empleo",
          kind: "select",
          options: [
            ["tiempo_completo", "Tiempo completo"],
            ["medio_tiempo", "Medio tiempo"],
            ["contrato", "Por contrato"],
            ["practicas", "Prácticas"],
          ],
        },
      ],
    },
    {
      title: "Descripción y preguntas de selección",
      fields: [
        { name: "descripcion", id: "li-descripcion", label: "Descripción del empleo", kind: "textarea" },
        { name: "pregunta1", id: "li-pregunta-1", label: "Pregunta de selección 1 (opcional)", kind: "text" },
        { name: "pregunta2", id: "li-pregunta-2", label: "Pregunta de selección 2 (opcional)", kind: "text" },
      ],
    },
    {
      title: "Cómo recibir candidatos",
      fields: [
        {
          name: "recepcion",
          id: "li-recepcion",
          label: "Recibir candidatos por",
          kind: "radio",
          options: [
            ["plataforma", "Esta plataforma (Postulación sencilla)"],
            ["correo", "Correo electrónico"],
          ],
        },
        { name: "correo", id: "li-correo", label: "Correo de contacto", kind: "text" },
      ],
    },
    { title: "Revisar y publicar", fields: [], review: true },
  ],
  map: { title: "titulo", description: "descripcion", location: "ubicacion", company: "empresa", q1: "pregunta1", q2: "pregunta2" },
  path: {
    home: "/empleos",
    login: "/login",
    publishForm: "/empleos/publicar",
    publishPost: "/empleos/publicar",
    job: "/empleos/:id",
    applicants: "/empleos/:id/candidatos",
    resume: "/cv/:job/:app",
    close: "/empleos/:id/cerrar",
  },
  attrs: {
    title: 'id="li-publicada"',
    status: 'id="li-estado"',
    close: 'id="li-cerrar"',
    error: 'id="li-error" role="alert"',
    captcha: 'id="challenge-dialog"',
    home: 'id="li-lista-empleos"',
    view: 'class="li-ver-candidatos"',
    next: 'id="li-siguiente" name="accion" value="siguiente"',
    back: 'id="li-atras" class="sec" name="accion" value="atras" formnovalidate',
    publish: 'id="li-publicar" name="accion" value="publicar"',
  },
  stepAttrs: (n) => `id="li-paso-${n}" class="li-paso" data-paso="${n}"`,
  field: (f, v) => `<div class="campo"><label for="${f.id}">${esc(f.label)}</label>${control(f, v, f.id)}</div>`,
  applicants: (job, base) =>
    `<ul id="li-candidatos" class="lista">${job.applicants
      .map(
        (a) =>
          `<li class="candidato card" data-candidato-id="${esc(a.id)}"><strong class="c-nombre">${esc(a.fullName)}</strong> <span class="c-correo">${esc(a.email ?? "")}</span> <span class="c-telefono">${esc(a.phone ?? "")}</span> <a class="c-cv" href="${base}${fill(linkedin.path.resume, job.id, a.id)}">Descargar CV</a></li>`,
      )
      .join("")}</ul>`,
  statusText: (s) => OPEN(s, "Activo", "Cerrado"),
  labels: { next: "Siguiente", back: "Atrás", publish: "Publicar empleo", close: "Cerrar empleo", view: "Ver candidatos" },
};

// ---------------------------------------------------------------- Bumeran
const bumeran: Site = {
  slug: "bumeran",
  wordmark: "Bumeran (simulación)",
  blurb: "Bolsa de trabajo: aviso en 3 pasos, formulario con etiquetas flotantes y postulaciones en tabla.",
  accent: "#d6006f",
  css: `body.bumeran{background:#fff;color:#2b2b2b;font-family:"Nunito","Trebuchet MS",Arial,sans-serif}
.bumeran .hd{background:#d6006f;color:#fff}.bumeran .logo{color:#fff;font-weight:800;font-size:1.3rem;letter-spacing:.5px}.bumeran .hd a{color:#fff}
.bumeran .card{background:#fff6fa;border:2px solid #f3b6d3;border-radius:16px}
.bumeran .campo{display:block;margin-bottom:1rem}.bumeran .campo span{display:block;font-weight:700;color:#d6006f;font-size:.85rem}
.bumeran input[type=text],.bumeran textarea,.bumeran select{border:2px solid #f3b6d3;border-radius:12px;background:#fff}
.bumeran button,.bumeran .btn{background:#d6006f;color:#fff;border:0;border-radius:24px;padding:.65rem 1.6rem;font-weight:800}.bumeran .sec{background:#fff;color:#d6006f;border:2px solid #d6006f}
.bumeran .progreso{color:#d6006f;font-weight:700;margin:0}.bumeran .chip{background:#fde0ee;color:#a10052}`,
  steps: [
    {
      title: "Datos del aviso",
      fields: [
        { name: "puesto", label: "Puesto", kind: "text" },
        {
          name: "area",
          label: "Área",
          kind: "select",
          options: [
            ["operaciones", "Operaciones"],
            ["administracion", "Administración"],
            ["ventas", "Ventas"],
            ["servicios", "Servicios generales"],
          ],
        },
        { name: "zona", label: "Zona de trabajo", kind: "text" },
        {
          name: "jornada",
          label: "Jornada",
          kind: "select",
          options: [
            ["completa", "Jornada completa"],
            ["parcial", "Jornada parcial"],
            ["practicas", "Prácticas"],
          ],
        },
      ],
    },
    {
      title: "Descripción del puesto",
      fields: [
        { name: "detalle", label: "Detalle del puesto", kind: "textarea" },
        { name: "requisitos", label: "Requisitos", kind: "textarea" },
      ],
    },
    {
      title: "Publicación",
      fields: [
        {
          name: "vigencia",
          label: "Vigencia del aviso",
          kind: "select",
          options: [
            ["15", "15 días"],
            ["30", "30 días"],
            ["60", "60 días"],
          ],
        },
        { name: "acepto", label: "Acepto las condiciones de publicación (simuladas)", kind: "checkbox" },
      ],
    },
  ],
  map: { title: "puesto", description: "detalle", location: "zona" },
  path: {
    home: "/avisos",
    login: "/login",
    publishForm: "/avisos/nuevo",
    publishPost: "/avisos/nuevo",
    job: "/avisos/:id",
    applicants: "/avisos/:id/postulaciones",
    resume: "/descargas/cv/:job/:app",
    close: "/avisos/:id/dar-de-baja",
  },
  attrs: {
    title: 'class="aviso-titulo"',
    status: 'class="aviso-estado"',
    close: 'class="btn-baja"',
    error: 'class="alerta-error" role="alert"',
    captcha: 'class="recaptcha-caja"',
    home: 'class="mis-avisos"',
    view: 'class="ver-postulaciones"',
    next: 'class="btn-continuar" name="accion" value="siguiente"',
    back: 'class="btn-volver sec" name="accion" value="atras" formnovalidate',
    publish: 'class="btn-publicar-aviso" name="accion" value="publicar"',
  },
  stepAttrs: (n) => `class="bm-paso" data-step="${n}"`,
  field: (f, v) =>
    f.kind === "checkbox"
      ? `<label class="campo">${control(f, v, undefined)} ${esc(f.label)}</label>`
      : `<label class="campo"><span>${esc(f.label)}</span>${control(f, v, undefined)}</label>`,
  applicants: (job, base) =>
    `<table class="tabla-postulantes"><thead><tr><th>Nombre</th><th>Correo</th><th>Teléfono</th><th>CV</th></tr></thead><tbody>${job.applicants
      .map(
        (a) =>
          `<tr data-postulante="${esc(a.id)}"><td>${esc(a.fullName)}</td><td>${esc(a.email ?? "")}</td><td>${esc(a.phone ?? "")}</td><td><a class="descargar-cv" href="${base}${fill(bumeran.path.resume, job.id, a.id)}">Descargar</a></td></tr>`,
      )
      .join("")}</tbody></table>`,
  statusText: (s) => OPEN(s, "Aviso publicado", "Aviso dado de baja"),
  labels: { next: "Continuar", back: "Volver", publish: "Publicar aviso", close: "Dar de baja el aviso", view: "Ver postulaciones" },
};

// ---------------------------------------------------------------- Trabajos Diarios
const trabajosDiarios: Site = {
  slug: "trabajos-diarios",
  wordmark: "Trabajos Diarios (simulación)",
  blurb: "Avisos rápidos: una sola pantalla para publicar (modelo del primer portal falso).",
  accent: "#0f766e",
  css: `body.trabajos-diarios{background:#f4faf9;color:#1f2937;font-family:system-ui,sans-serif}
.trabajos-diarios .hd{background:#0f766e;color:#fff}.trabajos-diarios .logo{color:#fff;font-weight:700;font-size:1.2rem}.trabajos-diarios .hd a{color:#fff}
.trabajos-diarios .card{background:#fff;border:1px solid #cde5e2;border-radius:6px}
.trabajos-diarios input[type=text],.trabajos-diarios textarea,.trabajos-diarios select{border:1px solid #9ca3af;border-radius:6px}
.trabajos-diarios button,.trabajos-diarios .btn{background:#0f766e;color:#fff;border:0;border-radius:6px}.trabajos-diarios .sec{background:#fff;color:#0f766e;border:1px solid #0f766e}
.trabajos-diarios .chip{background:#d1fae5;color:#065f46}`,
  steps: [
    {
      title: "Nueva oferta",
      fields: [
        { name: "titulo", id: "titulo", label: "Título del puesto", kind: "text" },
        { name: "descripcion", id: "descripcion", label: "Descripción", kind: "textarea" },
        { name: "ubicacion", id: "ubicacion", label: "Ubicación", kind: "text" },
      ],
    },
  ],
  map: { title: "titulo", description: "descripcion", location: "ubicacion" },
  path: {
    home: "/empleos",
    login: "/login",
    publishForm: "/empleos/nuevo",
    publishPost: "/empleos",
    job: "/empleos/:id",
    applicants: "/empleos/:id/postulantes",
    resume: "/cv/:job/:app",
    close: "/empleos/:id/retirar",
  },
  attrs: {
    title: 'id="publicada"',
    status: 'id="estado"',
    close: 'id="retirar"',
    error: 'id="error"',
    captcha: 'id="captcha"',
    home: 'id="mis-empleos"',
    view: 'class="ver-postulantes"',
    next: "",
    back: "",
    publish: "",
  },
  stepAttrs: () => "",
  field: (f, v) => `<div class="campo"><label for="${f.id}">${esc(f.label)}</label>${control(f, v, f.id)}</div>`,
  applicants: (job, base) =>
    `<table id="postulantes"><tbody>${job.applicants
      .map(
        (a) =>
          `<tr class="postulante" data-id="${esc(a.id)}"><td class="nombre">${esc(a.fullName)}</td><td class="correo">${esc(a.email ?? "")}</td><td class="telefono">${esc(a.phone ?? "")}</td><td><a class="cv" href="${base}${fill(trabajosDiarios.path.resume, job.id, a.id)}">CV</a></td></tr>`,
      )
      .join("")}</tbody></table>`,
  statusText: (s) => s,
  labels: { next: "Siguiente", back: "Atrás", publish: "Publicar", close: "Retirar oferta", view: "Ver postulantes" },
};

// ---------------------------------------------------------------- Indeed
const indeed: Site = {
  slug: "indeed",
  wordmark: "Indeed (simulación)",
  blurb: "Buscador de empleos: publicar en 2 pasos y candidatos en tarjetas.",
  accent: "#2557a7",
  css: `body.indeed{background:#fff;color:#2d2d2d;font-family:"Noto Sans",Helvetica,Arial,sans-serif}
.indeed .hd{background:#fff;border-bottom:1px solid #d4d2d0}.indeed .logo{color:#2557a7;font-weight:800;font-size:1.35rem;letter-spacing:-.5px}.indeed .hd a{color:#2d2d2d}
.indeed .card{background:#fff;border:1px solid #d4d2d0;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.12)}
.indeed .campo label{font-weight:700;font-size:.9rem}
.indeed input[type=text],.indeed textarea,.indeed select{border:1px solid #767676;border-radius:6px}
.indeed button,.indeed .btn{background:#2557a7;color:#fff;border:0;border-radius:8px;font-weight:700}.indeed .sec{background:#fff;color:#2557a7;border:1px solid #2557a7}
.indeed .chip{background:#e4ecf7;color:#2557a7}`,
  steps: [
    {
      title: "Describe el empleo",
      fields: [
        { name: "jobtitle", id: "input-jobtitle", label: "Título del empleo", kind: "text" },
        { name: "companyname", id: "input-companyname", label: "Nombre de la empresa", kind: "text" },
        { name: "jobcity", id: "input-jobcity", label: "Ciudad", kind: "text" },
        { name: "salary", id: "input-salary", label: "Sueldo mensual (opcional)", kind: "text" },
      ],
    },
    {
      title: "Descripción y contacto",
      fields: [
        { name: "jobdesc", id: "input-jobdesc", label: "Descripción completa", kind: "textarea" },
        { name: "applyemail", id: "input-applyemail", label: "Correo para recibir candidatos", kind: "text" },
      ],
    },
  ],
  map: { title: "jobtitle", description: "jobdesc", location: "jobcity", company: "companyname" },
  path: {
    home: "/empleador",
    login: "/login",
    publishForm: "/empleador/publicar",
    publishPost: "/empleador/publicar",
    job: "/empleador/empleos/:id",
    applicants: "/empleador/empleos/:id/candidatos",
    resume: "/empleador/cv/:job/:app",
    close: "/empleador/empleos/:id/cerrar",
  },
  attrs: {
    title: 'data-testid="job-title"',
    status: 'data-testid="job-status"',
    close: 'data-testid="cerrar-empleo"',
    error: 'data-testid="error-publicacion" role="alert"',
    captcha: 'id="cf-challenge"',
    home: 'data-testid="employer-jobs"',
    view: 'data-testid="ver-candidatos"',
    next: 'data-testid="continuar" name="accion" value="siguiente"',
    back: 'data-testid="volver" class="sec" name="accion" value="atras" formnovalidate',
    publish: 'data-testid="publicar-empleo" name="accion" value="publicar"',
  },
  stepAttrs: (n) => `class="ia-step" data-testid="paso-${n}"`,
  field: (f, v) => `<div class="campo"><label for="${f.id}">${esc(f.label)}</label>${control(f, v, f.id)}</div>`,
  applicants: (job, base) =>
    `<div data-testid="candidates">${job.applicants
      .map(
        (a) =>
          `<div class="card" data-testid="candidate-row" data-candidate-id="${esc(a.id)}"><h3 data-testid="candidate-name">${esc(a.fullName)}</h3><span data-testid="candidate-email">${esc(a.email ?? "")}</span> · <span data-testid="candidate-phone">${esc(a.phone ?? "")}</span> <a data-testid="candidate-resume" href="${base}${fill(indeed.path.resume, job.id, a.id)}">Ver currículum</a></div>`,
      )
      .join("")}</div>`,
  statusText: (s) => OPEN(s, "Abierto", "Cerrado"),
  labels: { next: "Continuar", back: "Volver", publish: "Publicar empleo", close: "Cerrar empleo", view: "Ver candidatos" },
};

// ---------------------------------------------------------------- Computrabajo
const computrabajo: Site = {
  slug: "computrabajo",
  wordmark: "Computrabajo (simulación)",
  blurb: "Bolsa de empleo latinoamericana: formulario único de oferta y candidatos en lista.",
  accent: "#1a4f9c",
  css: `body.computrabajo{background:#eef2f7;color:#222;font-family:Arial,Helvetica,sans-serif}
.computrabajo .hd{background:#1a4f9c;color:#fff;border-bottom:4px solid #f58220}.computrabajo .logo{color:#fff;font-weight:700;font-size:1.25rem;text-transform:uppercase}.computrabajo .hd a{color:#fff}
.computrabajo .card{background:#fff;border:1px solid #c9d3e0;border-radius:2px}
.computrabajo .fila{margin:0 0 .5rem}.computrabajo h1{text-transform:uppercase;font-size:1.15rem;color:#1a4f9c}
.computrabajo input[type=text],.computrabajo textarea,.computrabajo select{border:1px solid #8794a8;border-radius:2px}
.computrabajo button,.computrabajo .btn{background:#f58220;color:#fff;border:0;border-radius:2px;font-weight:700;text-transform:uppercase}.computrabajo .sec{background:#fff;color:#1a4f9c;border:1px solid #1a4f9c}
.computrabajo .chip{background:#fde8d2;color:#9a4a07}`,
  steps: [
    {
      title: "Nueva oferta de empleo",
      fields: [
        { name: "oferta_titulo", id: "oferta_titulo", label: "Nombre de la oferta", kind: "text" },
        {
          name: "oferta_categoria",
          id: "oferta_categoria",
          label: "Categoría",
          kind: "select",
          options: [
            ["general", "General"],
            ["produccion", "Producción y operarios"],
            ["comercial", "Comercial y ventas"],
            ["administrativo", "Administración"],
          ],
        },
        { name: "oferta_descripcion", id: "oferta_descripcion", label: "Descripción de la oferta", kind: "textarea" },
        { name: "oferta_ciudad", id: "oferta_ciudad", label: "Ciudad", kind: "text" },
        { name: "oferta_sueldo", id: "oferta_sueldo", label: "Sueldo (opcional)", kind: "text" },
      ],
    },
  ],
  map: { title: "oferta_titulo", description: "oferta_descripcion", location: "oferta_ciudad" },
  path: {
    home: "/empresa/ofertas",
    login: "/login",
    publishForm: "/empresa/ofertas/nueva",
    publishPost: "/empresa/ofertas",
    job: "/empresa/ofertas/:id",
    applicants: "/empresa/ofertas/:id/candidatos",
    resume: "/empresa/cv/:job/:app",
    close: "/empresa/ofertas/:id/desactivar",
  },
  attrs: {
    title: 'class="titulo-oferta"',
    status: 'class="estado-oferta"',
    close: 'id="desactivar"',
    error: 'class="msg-error" role="alert"',
    captcha: 'data-testid="captcha"',
    home: 'class="ofertas-empresa"',
    view: 'class="lnk-candidatos"',
    next: "",
    back: "",
    publish: 'id="oferta_publicar"',
  },
  stepAttrs: () => "",
  field: (f, v) => `<p class="fila"><label for="${f.id}">${esc(f.label)}</label>${control(f, v, f.id)}</p>`,
  applicants: (job, base) =>
    `<section class="lista-candidatos">${job.applicants
      .map(
        (a) =>
          `<article class="cand card" data-cid="${esc(a.id)}"><h3>${esc(a.fullName)}</h3><p class="mail">${esc(a.email ?? "")}</p><p class="tel">${esc(a.phone ?? "")}</p><a class="bajar-cv" href="${base}${fill(computrabajo.path.resume, job.id, a.id)}">Bajar hoja de vida</a></article>`,
      )
      .join("")}</section>`,
  statusText: (s) => OPEN(s, "Activa", "Desactivada"),
  labels: { next: "Siguiente", back: "Atrás", publish: "Publicar oferta", close: "Desactivar oferta", view: "Ver candidatos" },
};

export const SITES: Record<PortalSlug, Site> = {
  linkedin,
  bumeran,
  "trabajos-diarios": trabajosDiarios,
  indeed,
  computrabajo,
};

// ------------------------------------------------------------------ páginas
const BASE_CSS = `*{box-sizing:border-box}body{margin:0;padding-top:34px}
.sim-banner{position:fixed;top:0;left:0;right:0;height:34px;line-height:34px;background:#fde68a;color:#78350f;text-align:center;font:600 13px system-ui,sans-serif;z-index:1000;border-bottom:1px solid #f59e0b}
.hd{display:flex;align-items:center;gap:1.5rem;padding:.7rem 1.25rem}.hd nav{display:flex;gap:1rem;margin-left:auto}.hd a{text-decoration:none}.logo{text-decoration:none}
.wrap{max-width:780px;margin:1.5rem auto;padding:0 1rem}.card{padding:1.1rem 1.4rem;margin-bottom:1rem}
input[type=text],input[type=email],input[type=file],textarea,select{display:block;width:100%;padding:.55rem;margin:.25rem 0 1rem;font:inherit}
.opt{display:block;margin:.3rem 0}button,.btn{cursor:pointer;font:inherit;padding:.55rem 1.2rem;text-decoration:none;display:inline-block;margin-right:.5rem}
table{width:100%;border-collapse:collapse}td,th{padding:.5rem;text-align:left;border-bottom:1px solid #e5e7eb}
ul.lista{list-style:none;padding:0}.chip{display:inline-block;padding:.1rem .7rem;border-radius:999px;font-size:.8rem}
.err{background:#fee2e2;color:#991b1b;padding:.7rem;border-radius:6px;margin:.5rem 0}.ok{background:#dcfce7;color:#166534;padding:.7rem;border-radius:6px}
dl.resumen dt{font-weight:700;margin-top:.5rem}dl.resumen dd{margin:0}.acciones{margin-top:1rem}.btn a{color:inherit;text-decoration:none}`;

export function layout(site: Site, base: string, title: string, body: string): string {
  return `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · ${esc(site.wordmark)}</title><style>${BASE_CSS}${site.css}</style><body class="${site.slug}"><div class="sim-banner">Portal ficticio · simulación para demostración</div><header class="hd"><a class="logo" href="${base || "/" + site.slug}">${esc(site.wordmark)}</a><nav><a href="${base || "/" + site.slug}">Empleos</a><a href="${base}${site.path.home}">Soy empleador</a><a href="/">Panel de la demo</a></nav></header><main class="wrap">${body}</main></body></html>`;
}

export interface StepOptions {
  /** Simula que el portal cambió el formulario: desaparece el campo del título. */
  changed?: boolean;
  error?: string;
}

/** Un paso del asistente (o el formulario único). El estado viaja en campos ocultos: el servidor no guarda borradores. */
export function renderStep(site: Site, base: string, n: number, values: Record<string, string>, options: StepOptions = {}): string {
  const step = site.steps[n - 1]!;
  const total = site.steps.length;
  const shown = new Set(step.fields.map((f) => f.name));
  const hidden = site.steps
    .flatMap((s) => s.fields)
    .filter((f) => !shown.has(f.name) && values[f.name] !== undefined)
    .map((f) => `<input type="hidden" name="${f.name}" value="${esc(values[f.name]!)}">`)
    .join("");
  const fields = step.fields
    .filter((f) => !(options.changed && n === 1 && f.name === site.map.title))
    .map((f) => site.field(f, values[f.name] ?? ""))
    .join("");
  const review = step.review
    ? `<dl class="resumen">${site.steps
        .flatMap((s) => s.fields)
        .map((f) => `<dt>${esc(f.label)}</dt><dd>${esc(values[f.name] ?? "—") || "—"}</dd>`)
        .join("")}</dl>`
    : "";
  const buttons = [
    n > 1 ? `<button type="submit" ${site.attrs.back}>${esc(site.labels.back)}</button>` : "",
    n < total ? `<button type="submit" ${site.attrs.next}>${esc(site.labels.next)}</button>` : "",
    n === total ? `<button type="submit" ${site.attrs.publish}>${esc(site.labels.publish)}</button>` : "",
  ].join("");
  const variant = site.variant;
  // Variante «botón en un menú»: los botones no existen hasta abrir «Más acciones».
  const actions = variant?.botonEnMenu
    ? `<button type="button" class="menu-acciones" aria-haspopup="true" data-html="${esc(buttons)}" onclick="this.insertAdjacentHTML('afterend',this.dataset.html);this.remove()">Más acciones ▾</button>`
    : buttons;
  // Variante «aviso de cookies»: una ventana que tapa todo el formulario hasta aceptarla.
  const cookies = variant?.avisoCookies
    ? `<div class="cookies-aviso" style="position:fixed;inset:0;z-index:900;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center"><div style="background:#fff;color:#111;padding:1.5rem;border-radius:8px;max-width:420px"><p>Usamos cookies para mejorar tu experiencia (simulación).</p><button type="button" onclick="this.closest('.cookies-aviso').remove()">Aceptar todas</button></div></div>`
    : "";
  const progress = total > 1 ? `<p class="progreso">Paso ${n} de ${total}</p>` : "";
  const error = options.error ? `<p class="err">${esc(options.error)}</p>` : "";
  return layout(
    site,
    base,
    step.title,
    `<div class="card"><section ${site.stepAttrs(n)}>${progress}<h1>${esc(step.title)}</h1>${error}<form method="post" action="${base}${site.path.publishPost}"><input type="hidden" name="paso" value="${n}">${hidden}${fields}${review}<div class="acciones">${actions}</div></form></section></div>${cookies}`,
  );
}

export function renderEmployerJob(site: Site, base: string, job: FakeJob): string {
  const open = job.status === "activa";
  return layout(
    site,
    base,
    job.title,
    `<section class="card"><span class="chip"><span ${site.attrs.status}>${esc(site.statusText(job.status))}</span></span><h1 ${site.attrs.title}>${esc(job.title)}</h1><p>${esc([job.company, job.location].filter(Boolean).join(" · "))}</p><p>${esc(job.description)}</p>
<p><span class="btn"><a ${site.attrs.view} href="${base}${fill(site.path.applicants, job.id)}">${esc(site.labels.view)} (${job.applicants.length})</a></span> <a class="btn sec" href="${base}/empleo/${encodeURIComponent(job.id)}" target="_blank">Ver como candidato</a></p>
${open ? `<form method="post" action="${base}${fill(site.path.close, job.id)}"><button type="submit" ${site.attrs.close}>${esc(site.labels.close)}</button></form>` : ""}</section>`,
  );
}

export function renderEmployerHome(site: Site, base: string, jobs: FakeJob[]): string {
  const rows = jobs
    .map(
      (job) =>
        `<li class="card"><strong>${esc(job.title)}</strong> <span class="chip">${esc(site.statusText(job.status))}</span><br><a href="${base}${fill(site.path.job, job.id)}">Abrir</a> · <a ${site.attrs.view} href="${base}${fill(site.path.applicants, job.id)}">${esc(site.labels.view)} (${job.applicants.length})</a></li>`,
    )
    .join("");
  return layout(
    site,
    base,
    "Mis ofertas",
    `<h1>Mis ofertas</h1><p><a class="btn" href="${base}${site.path.publishForm}">Publicar una oferta</a></p><div ${site.attrs.home}><ul class="lista">${rows || "<li>Aún no hay ofertas publicadas.</li>"}</ul></div>`,
  );
}

/** Postulantes por página en la variante «paginación». */
export const PAGE_SIZE = 5;

/** Lista de postulantes paginada con marcas genéricas: ninguno de los selectores propios del portal sigue valiendo. */
function paginatedApplicants(job: FakeJob, base: string, page: number, resumePath: string): string {
  const pages = Math.max(1, Math.ceil(job.applicants.length / PAGE_SIZE));
  const current = Math.min(Math.max(page, 1), pages);
  const rows = job.applicants
    .slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)
    .map(
      (a) =>
        `<li class="fila-postulante" data-ref="${esc(a.id)}"><span>${esc(a.fullName)}</span> <span>${esc(a.email ?? "")}</span> <span>${esc(a.phone ?? "")}</span> <a class="enlace-doc" href="${base}${fill(resumePath, job.id, a.id)}">CV</a></li>`,
    )
    .join("");
  const nav = [
    current > 1 ? `<a href="?pagina=${current - 1}">Anterior</a>` : "",
    `<span>Página ${current} de ${pages}</span>`,
    current < pages ? `<a href="?pagina=${current + 1}">Siguiente</a>` : "",
  ].join(" ");
  return `<div class="resultados-paginados"><ul class="lista">${rows}</ul><nav class="paginacion">${nav}</nav></div>`;
}

export function renderApplicants(site: Site, base: string, job: FakeJob, page = 1): string {
  const variant = site.variant;
  let list = variant?.paginarPostulantes ? paginatedApplicants(job, base, page, site.path.resume) : site.applicants(job, base);
  // Variante «descarga del CV»: el enlace se vuelve un botón que navega con JavaScript (ya no es un <a> con el selector de siempre).
  if (variant?.enlaceCv) {
    list = list.replace(
      /<a\b[^>]*\bhref="([^"]*\/cv\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/g,
      '<button type="button" class="btn-descarga" data-url="$1" onclick="location.href=this.dataset.url">$2</button>',
    );
  }
  return layout(
    site,
    base,
    "Postulantes",
    `<h1>Postulantes de «${esc(job.title)}»</h1>${list}${job.applicants.length === 0 ? '<p class="card">Aún no hay postulantes.</p>' : ""}`,
  );
}

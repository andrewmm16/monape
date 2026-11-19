// Comprobación automática después de un despliegue (docs/despliegue.md,
// «Comprobaciones posteriores al despliegue»).
//
// Solo lectura y sin secretos: hace peticiones SIN sesión ni credenciales y
// revisa que la app responda como debe. No crea usuarios, no postula, no envía
// correos ni ejecuta las tareas programadas. Con la URL y la clave PUBLICABLE de
// Supabase (que ya es pública: va en el navegador) revisa además que un visitante
// anónimo no pueda leer tablas, funciones ni archivos.
//
// Uso:
//   npm run verificar:despliegue -- https://staging.ejemplo.pe
//   npm run verificar:despliegue -- https://staging.ejemplo.pe --supabase-url https://xxxx.supabase.co --supabase-key sb_publishable_xxx
// La URL y la clave de Supabase también se leen de NEXT_PUBLIC_SUPABASE_URL y
// NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY. Sale con código 1 si algo falla.
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { argv, env, exit, stdout } from "node:process";

type Estado = "ok" | "falla" | "aviso" | "info";
type Resultado = { estado: Estado; grupo: string; texto: string };

const RAIZ = resolve(import.meta.dirname, "..");
const TIEMPO_MAXIMO_MS = 20_000;
const resultados: Resultado[] = [];
const anotar = (grupo: string, estado: Estado, texto: string) => resultados.push({ estado, grupo, texto });

function opcion(nombre: string): string | undefined {
  const i = argv.indexOf(nombre);
  return i >= 0 ? argv[i + 1] : undefined;
}

const urlBase = argv.slice(2).find((a, i, lista) => !a.startsWith("--") && !(lista[i - 1] ?? "").startsWith("--supabase"));
if (!urlBase || !/^https?:\/\//.test(urlBase)) {
  stdout.write("Uso: npm run verificar:despliegue -- https://<dominio> [--supabase-url <url>] [--supabase-key <clave publicable>]\n");
  exit(2);
}
const BASE = new URL(urlBase);
const ORIGEN = BASE.origin;
const ES_HTTPS = BASE.protocol === "https:";
const SUPABASE_URL = (opcion("--supabase-url") ?? env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
const SUPABASE_KEY = opcion("--supabase-key") ?? env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

type Respuesta = { status: number; headers: Headers; texto: string };

async function pedir(url: string, init: RequestInit = {}): Promise<Respuesta | Error> {
  try {
    const r = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS), ...init });
    return { status: r.status, headers: r.headers, texto: await r.text() };
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

const app = (ruta: string, init?: RequestInit) => pedir(`${ORIGEN}${ruta}`, init);
const redirigeA = (r: Respuesta) => (r.status >= 300 && r.status < 400 ? new URL(r.headers.get("location") ?? "", ORIGEN) : null);
const fallo = (r: Respuesta | Error) => (r instanceof Error ? `sin respuesta (${r.message})` : `respondió ${r.status}`);

// --- Sesión: lo privado exige ingresar ---------------------------------------

async function sesion(): Promise<void> {
  const G = "Sesión";
  for (const ruta of ["/", "/panel"]) {
    const r = await app(ruta);
    const destino = r instanceof Error ? null : redirigeA(r);
    if (destino?.pathname === "/ingresar") anotar(G, "ok", `${ruta} sin sesión redirige a /ingresar.`);
    else anotar(G, "falla", `${ruta} sin sesión debería redirigir a /ingresar y ${fallo(r)}${destino ? ` hacia ${destino.pathname}` : ""}.`);
    if (ruta === "/panel" && !(r instanceof Error) && !/no-store/.test(r.headers.get("cache-control") ?? "")) {
      anotar(G, "falla", "La redirección de /panel no lleva «Cache-Control: no-store».");
    }
  }

  const privadas: [string, string][] = [
    ["GET", "/api/notificaciones"],
    ["GET", "/api/reportes/export"],
    ["GET", `/api/resumes/${randomUUID()}/download`],
    ["POST", "/api/sesion/actividad"],
    ["GET", "/api/lugares/buscar?q=lima"],
  ];
  const mal: string[] = [];
  for (const [metodo, ruta] of privadas) {
    const r = await app(ruta, { method: metodo });
    if (r instanceof Error || r.status !== 401) mal.push(`${metodo} ${ruta} ${fallo(r)}`);
  }
  if (mal.length) anotar(G, "falla", `APIs privadas sin sesión deberían responder 401: ${mal.join("; ")}.`);
  else anotar(G, "ok", `Las ${privadas.length} APIs privadas responden 401 sin sesión.`);

  const confirmar = await app("/auth/confirm");
  const destino = confirmar instanceof Error ? null : redirigeA(confirmar);
  if (destino?.pathname === "/ingresar") anotar(G, "ok", "/auth/confirm sin enlace válido vuelve a /ingresar (sin error 500).");
  else anotar(G, "falla", `/auth/confirm sin enlace debería volver a /ingresar y ${fallo(confirmar)}.`);
}

// --- Cabeceras de seguridad ----------------------------------------------------

async function cabeceras(): Promise<void> {
  const G = "Cabeceras";
  const r = await app("/ingresar");
  if (r instanceof Error || r.status !== 200) {
    anotar(G, "falla", `/ingresar debería responder 200 y ${fallo(r)}: no se pudieron revisar las cabeceras.`);
    return;
  }
  const h = r.headers;
  const csp = h.get("content-security-policy") ?? "";
  const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
  if (!csp) anotar(G, "falla", "Falta Content-Security-Policy.");
  else {
    const faltan = ["frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'"].filter((d) => !csp.includes(d));
    if (!nonce) anotar(G, "falla", "La Content-Security-Policy no lleva nonce.");
    if (faltan.length) anotar(G, "falla", `A la Content-Security-Policy le falta: ${faltan.join(", ")}.`);
    if (csp.includes("'unsafe-eval'")) anotar(G, "falla", "La Content-Security-Policy permite 'unsafe-eval': ¿es un build de desarrollo?");
    const otra = await app("/ingresar");
    const otroNonce = otra instanceof Error ? undefined : /'nonce-([^']+)'/.exec(otra.headers.get("content-security-policy") ?? "")?.[1];
    if (nonce && otroNonce === nonce) anotar(G, "falla", "El nonce se repite entre solicitudes: debe ser nuevo en cada una.");
    if (nonce && !r.texto.includes(`nonce="${nonce}"`)) anotar(G, "aviso", "Los <script> de la página no llevan el nonce de la cabecera.");
    if (nonce && !faltan.length && !csp.includes("'unsafe-eval'") && otroNonce !== nonce) {
      anotar(G, "ok", "Content-Security-Policy con nonce nuevo en cada solicitud.");
    }
  }

  const esperadas: [string, (v: string) => boolean, string][] = [
    ["x-frame-options", (v) => v.toUpperCase() === "DENY", "DENY"],
    ["x-content-type-options", (v) => v.toLowerCase() === "nosniff", "nosniff"],
    ["referrer-policy", (v) => v === "strict-origin-when-cross-origin", "strict-origin-when-cross-origin"],
    ["permissions-policy", (v) => v.includes("camera=()") && v.includes("microphone=()"), "camera=(), microphone=()…"],
    ["cross-origin-opener-policy", (v) => v === "same-origin", "same-origin"],
  ];
  const mal = esperadas.filter(([nombre, valida]) => !valida(h.get(nombre) ?? "")).map(([nombre, , valor]) => `${nombre} (esperada: ${valor})`);
  if (mal.length) anotar(G, "falla", `Cabeceras ausentes o distintas: ${mal.join("; ")}.`);
  else anotar(G, "ok", "X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy y COOP correctas.");
  if (h.get("x-powered-by")) anotar(G, "aviso", `La respuesta anuncia el servidor (X-Powered-By: ${h.get("x-powered-by")}).`);

  if (!ES_HTTPS) {
    anotar(G, "info", "Sin https: Strict-Transport-Security y la redirección desde http solo se revisan contra el dominio real.");
    return;
  }
  const maxAge = Number(/max-age=(\d+)/.exec(h.get("strict-transport-security") ?? "")?.[1] ?? 0);
  if (maxAge >= 31_536_000) anotar(G, "ok", `Strict-Transport-Security con max-age=${maxAge}.`);
  else anotar(G, "falla", "Falta Strict-Transport-Security (o dura menos de un año).");
  const plano = await pedir(`http://${BASE.host}/ingresar`);
  const destino = plano instanceof Error ? null : redirigeA(plano);
  if (destino?.protocol === "https:") anotar(G, "ok", "http:// redirige a https://.");
  else anotar(G, "aviso", `http://${BASE.host} no redirige a https (${fallo(plano)}).`);
}

// --- APIs de máquina: sin el secreto no existen --------------------------------

function tareasProgramadas(): string[] {
  try {
    const vercel = JSON.parse(readFileSync(resolve(RAIZ, "vercel.json"), "utf8")) as { crons?: { path: string }[] };
    return (vercel.crons ?? []).map((c) => c.path.split("?")[0]!);
  } catch {
    return [];
  }
}

async function apisDeMaquina(): Promise<void> {
  const G = "APIs de máquina";
  const id = randomUUID();
  const token = randomBytes(24).toString("hex");
  const crons = tareasProgramadas();
  if (!crons.length) anotar(G, "aviso", "No se encontraron tareas programadas en vercel.json.");
  const rutas: [string, string][] = [
    ...crons.map((ruta): [string, string] => ["GET", ruta]),
    ["POST", "/api/evaluar-cv"],
    ["POST", "/api/bot/estado"],
    ["POST", "/api/bot/postulantes"],
    ["POST", "/api/bot/publicaciones/siguiente"],
    ["GET", "/api/bot/publicaciones/activas"],
    ["GET", "/api/bot/resumen-diario"],
    ["POST", `/api/bot/publicaciones/${id}/resultado`],
    ["POST", `/api/bot/publicaciones/${id}/sincronizada`],
    ["POST", "/api/ia/estado"],
    ["POST", "/api/ia/trabajos/siguiente"],
    ["POST", "/api/ia/vigilancia"],
    ["POST", `/api/ia/trabajos/${id}/resultado`],
    ["GET", `/api/integraciones/talent/feed/${token}`],
    ["POST", `/api/integraciones/talent/postular/${token.slice(0, 8)}/${token}`],
    ["GET", `/seguimiento/${token}`],
  ];
  const graves: string[] = [];
  const distintas: string[] = [];
  const conCookie: string[] = [];
  for (const [metodo, ruta] of rutas) {
    for (const autorizacion of [undefined, `Bearer ${token}`]) {
      const r = await app(ruta, { method: metodo, headers: autorizacion ? { authorization: autorizacion } : {} });
      const caso = `${metodo} ${ruta}${autorizacion ? " (secreto falso)" : ""}`;
      if (r instanceof Error || r.status < 300 || r.status >= 500) graves.push(`${caso} ${fallo(r)}`);
      else if (r.status !== 404) distintas.push(`${caso} ${r.status}`);
      if (!(r instanceof Error) && r.headers.get("set-cookie")) conCookie.push(caso);
    }
  }
  if (graves.length) anotar(G, "falla", `Sin el secreto deberían responder 404: ${graves.join("; ")}.`);
  if (distintas.length) anotar(G, "aviso", `Responden distinto de 404 (no revelan nada, pero delatan que existen): ${distintas.join("; ")}.`);
  if (conCookie.length) anotar(G, "falla", `Envían cookies sin sesión: ${conCookie.join("; ")}.`);
  if (!graves.length && !distintas.length && !conCookie.length) {
    anotar(G, "ok", `Las ${rutas.length} rutas (${crons.length} tareas programadas, robot, IA, Talent, webhook y portal del candidato) responden 404 sin secreto y con uno falso.`);
  }
}

// --- Parte pública -------------------------------------------------------------

async function partePublica(): Promise<void> {
  const G = "Parte pública";
  const empleos = await app("/empleos");
  if (!(empleos instanceof Error) && empleos.status === 404) {
    anotar(G, "info", "La parte pública está apagada (/empleos responde 404; PUBLIC_JOBS_ENABLED no es «true»).");
    return;
  }
  const rutas = ["/empleos", "/robots.txt", "/sitemap.xml", "/empleos/feed.xml"];
  const respuestas = new Map<string, Respuesta>();
  const mal: string[] = [];
  for (const ruta of rutas) {
    const r = ruta === "/empleos" ? empleos : await app(ruta);
    if (r instanceof Error || r.status !== 200) mal.push(`${ruta} ${fallo(r)}`);
    else respuestas.set(ruta, r);
  }
  if (mal.length) anotar(G, "falla", `Deberían responder 200: ${mal.join("; ")}.`);
  else anotar(G, "ok", "/empleos, robots.txt, sitemap.xml y el feed responden 200.");

  const conCookie = [...respuestas].filter(([, r]) => r.headers.get("set-cookie")).map(([ruta]) => ruta);
  if (conCookie.length) anotar(G, "falla", `Las páginas públicas no deben enviar cookies: ${conCookie.join(", ")}.`);

  const robots = respuestas.get("/robots.txt")?.texto ?? "";
  const sitemapRobots = /^Sitemap:\s*(\S+)/im.exec(robots)?.[1];
  if (sitemapRobots && new URL(sitemapRobots).host !== BASE.host) {
    anotar(G, "aviso", `robots.txt anuncia el sitemap en otro dominio (${new URL(sitemapRobots).host}): revise PUBLIC_SITE_URL.`);
  }

  const urls = [...(respuestas.get("/sitemap.xml")?.texto ?? "").matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!.trim());
  const ajenas = urls.filter((u) => new URL(u).host !== BASE.host);
  if (ajenas.length) anotar(G, "aviso", `El sitemap apunta a otro dominio (${new URL(ajenas[0]!).host}): revise PUBLIC_SITE_URL si este es el dominio final.`);
  const vacante = urls.map((u) => new URL(u).pathname).find((p) => /^\/empleos\/[^/]+$/.test(p) && p !== "/empleos/feed.xml");
  if (!vacante) {
    anotar(G, "info", "No hay vacantes publicadas en el sitemap: no se probó la página de una vacante.");
    return;
  }
  const pagina = await app(vacante);
  if (pagina instanceof Error || pagina.status !== 200) {
    anotar(G, "falla", `La vacante ${vacante} del sitemap ${fallo(pagina)}.`);
    return;
  }
  if (pagina.headers.get("set-cookie")) anotar(G, "falla", `La página de la vacante envía cookies (${vacante}).`);
  if (/application\/ld\+json/.test(pagina.texto) && /"JobPosting"/.test(pagina.texto)) {
    anotar(G, "ok", `La página de una vacante (${vacante}) responde sin cookies y trae los datos para Google (JobPosting).`);
  } else {
    anotar(G, "aviso", `La página ${vacante} no trae los datos estructurados JobPosting para Google.`);
  }
}

// --- Supabase: un visitante anónimo no ve nada ---------------------------------

function tablasPublicas(): string[] {
  const tipos = readFileSync(resolve(RAIZ, "src/types/database.ts"), "utf8");
  const inicio = tipos.indexOf("public: {");
  const fin = tipos.indexOf("Views:", inicio);
  return [...tipos.slice(inicio, fin).matchAll(/^ {6}([a-z_]+): \{\r?\n {8}Row/gm)].map((m) => m[1]!);
}

async function supabase(): Promise<void> {
  const G = "Supabase";
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    anotar(G, "info", "Sin --supabase-url y --supabase-key (o NEXT_PUBLIC_SUPABASE_*): no se revisó el acceso anónimo a la base.");
    return;
  }
  if (SUPABASE_KEY.startsWith("sb_secret_") || /service_role/.test(SUPABASE_KEY)) {
    anotar(G, "falla", "La clave indicada es SECRETA: use la publicable. No se hizo ninguna petición con ella.");
    return;
  }
  const cabeceras = { apikey: SUPABASE_KEY, "content-type": "application/json" };

  const ajustes = await pedir(`${SUPABASE_URL}/auth/v1/settings`, { headers: cabeceras });
  if (ajustes instanceof Error || ajustes.status !== 200) anotar(G, "falla", `No se pudo leer la configuración de Auth (${fallo(ajustes)}).`);
  else if ((JSON.parse(ajustes.texto) as { disable_signup?: boolean }).disable_signup === true) {
    anotar(G, "ok", "El registro público de cuentas está cerrado (solo por invitación).");
  } else {
    anotar(G, "falla", "El registro público está ABIERTO: desactívelo en Authentication → Sign In / Providers («Allow new users to sign up»).");
  }

  const raiz = await pedir(`${SUPABASE_URL}/rest/v1/`, { headers: cabeceras });
  if (!(raiz instanceof Error) && raiz.status === 200) {
    let rutas: string[] = [];
    try {
      rutas = Object.keys((JSON.parse(raiz.texto) as { paths?: Record<string, unknown> }).paths ?? {}).filter((p) => p !== "/");
    } catch {
      rutas = [];
    }
    if (rutas.length) anotar(G, "falla", `El rol anónimo ve ${rutas.length} tablas o funciones en la API: ${rutas.slice(0, 10).join(", ")}${rutas.length > 10 ? "…" : ""}.`);
    else anotar(G, "ok", "El esquema de la API no muestra ninguna tabla ni función al rol anónimo.");
  } else {
    anotar(G, "info", `El esquema de la API no está disponible con la clave publicable (${fallo(raiz)}); se prueban las tablas una por una.`);
  }

  const tablas = tablasPublicas();
  if (!tablas.length) {
    anotar(G, "falla", "No se pudo leer la lista de tablas de src/types/database.ts.");
    return;
  }
  const conFilas: string[] = [];
  const legibles: string[] = [];
  const raras: string[] = [];
  for (const tabla of tablas) {
    const r = await pedir(`${SUPABASE_URL}/rest/v1/${tabla}?select=*&limit=1`, { headers: cabeceras });
    if (r instanceof Error || r.status >= 500) raras.push(`${tabla} ${fallo(r)}`);
    else if (r.status === 200) (r.texto.trim() === "[]" ? legibles : conFilas).push(tabla);
    else if (![401, 403, 404].includes(r.status)) raras.push(`${tabla} ${r.status}`);
  }
  if (conFilas.length) anotar(G, "falla", `Un visitante anónimo LEE FILAS de: ${conFilas.join(", ")}.`);
  if (legibles.length) anotar(G, "aviso", `El rol anónimo puede consultar (la RLS no devuelve filas, pero no debería tener permiso): ${legibles.join(", ")}.`);
  if (raras.length) anotar(G, "aviso", `Respuestas inesperadas: ${raras.join("; ")}.`);
  if (!conFilas.length && !legibles.length && !raras.length) anotar(G, "ok", `Ninguna de las ${tablas.length} tablas responde al rol anónimo.`);

  const rpc = await pedir(`${SUPABASE_URL}/rest/v1/rpc/list_orphan_resume_files`, { method: "POST", headers: cabeceras, body: "{}" });
  if (!(rpc instanceof Error) && rpc.status === 200) anotar(G, "falla", "El rol anónimo puede ejecutar list_orphan_resume_files.");
  else anotar(G, "ok", "Las funciones internas (p. ej. list_orphan_resume_files) no se ejecutan sin sesión.");

  const cubos = await pedir(`${SUPABASE_URL}/storage/v1/bucket`, { headers: cabeceras });
  const listados = !(cubos instanceof Error) && cubos.status === 200 ? (JSON.parse(cubos.texto) as { name: string }[]) : [];
  if (listados.length) anotar(G, "aviso", `El rol anónimo ve los buckets: ${listados.map((b) => b.name).join(", ")}.`);
  const archivo = await pedir(`${SUPABASE_URL}/storage/v1/object/public/resumes/${randomUUID()}.pdf`, { headers: cabeceras });
  if (!(archivo instanceof Error) && /Bucket not found/i.test(archivo.texto)) {
    anotar(G, "ok", "El bucket de CV no es público (no se sirve por URL pública).");
  } else if (!(archivo instanceof Error) && /Object not found/i.test(archivo.texto)) {
    anotar(G, "falla", "El bucket «resumes» es PÚBLICO: cualquiera con el nombre del archivo podría descargar un CV.");
  } else {
    anotar(G, "aviso", `No se pudo confirmar que el bucket de CV sea privado (${fallo(archivo)}).`);
  }
}

// --- Informe ----------------------------------------------------------------------

const PENDIENTES_A_MANO = [
  "Invitar a un usuario de prueba y recuperar la contraseña (llegan los correos).",
  "RRHH no ve «Usuarios»; una cuenta creada desde el panel de Supabase nace desactivada.",
  "Descargar un CV: URL firmada de corta duración y registro en la auditoría.",
  "tests/e2e/flujo-rrhh.spec.ts contra staging.",
  "Vercel → Cron Jobs: las tareas figuran y su última ejecución respondió 200.",
  "Respaldo de staging restaurado sobre un proyecto vacío.",
  "Lectura de CV, OCR y texto sin contraste en Vercel (subir los PDF de prueba).",
  "Postular desde el celular por el formulario público y ver la postulación evaluada.",
  "Google: prueba de resultados enriquecidos y sitemap en Search Console.",
  "npm run test:secrets con las variables del entorno cargadas.",
];

async function main(): Promise<void> {
  stdout.write(`Verificación del despliegue · ${ORIGEN}${SUPABASE_URL ? ` · Supabase ${new URL(SUPABASE_URL).host}` : ""}\n`);
  await sesion();
  await cabeceras();
  await apisDeMaquina();
  await partePublica();
  await supabase();

  const ICONO: Record<Estado, string> = { ok: "✓", falla: "✗", aviso: "!", info: "·" };
  let grupo = "";
  for (const r of resultados) {
    if (r.grupo !== grupo) {
      grupo = r.grupo;
      stdout.write(`\n${grupo}\n`);
    }
    stdout.write(`  ${ICONO[r.estado]} ${r.texto}\n`);
  }
  const fallas = resultados.filter((r) => r.estado === "falla").length;
  const avisos = resultados.filter((r) => r.estado === "aviso").length;
  stdout.write(`\nQueda por comprobar a mano (docs/despliegue.md):\n${PENDIENTES_A_MANO.map((p) => `  - ${p}`).join("\n")}\n`);
  stdout.write(`\n${fallas ? `✗ ${fallas} comprobaciones fallaron` : "✓ Sin fallas"}${avisos ? ` · ${avisos} avisos` : ""}.\n`);
  if (fallas) exit(1);
}

main().catch((error: unknown) => {
  stdout.write(`\n[verificar-despliegue] ${error instanceof Error ? error.message : String(error)}\n`);
  exit(1);
});

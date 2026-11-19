import type { NextConfig } from "next";

/**
 * Cache Components / Partial Prerendering están desactivados a propósito:
 * la aplicación maneja datos personales y aplica una Content Security Policy
 * con nonce por solicitud (ver src/proxy.ts), que Next.js no admite junto con
 * PPR. Todas las páginas privadas se renderizan por solicitud y nunca se
 * cachean datos de candidatos en el servidor.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]
    : []),
];

/**
 * Archivos que el OCR local lee en tiempo de ejecución (modelo de idioma,
 * núcleo WASM de tesseract.js y el motor de dibujo nativo). Se cargan por ruta
 * o desde un worker, así que el rastreo automático no los ve.
 */
const OCR_RUNTIME_FILES = [
  "./node_modules/tesseract.js/**/*",
  "./node_modules/tesseract.js-core/**/*",
  "./node_modules/@tesseract.js-data/spa/package.json",
  "./node_modules/@tesseract.js-data/spa/index.js",
  "./node_modules/@tesseract.js-data/spa/4.0.0/**/*",
  "./node_modules/@napi-rs/**/*",
];

/**
 * Rutas que ejecutan OCR: carga de CV (candidato y lote), evaluación de pendientes, postulación pública y Talent.
 *
 * Ojo: Next compara estas claves con `contains`, así que también alcanzan a las
 * subrutas. «/vacantes/[id]/comparar» y «/editar» cargan ~88 MB de OCR sin usarlo
 * (94 MB en total, lejos del límite de 250 MB de Vercel). Con Turbopack,
 * `outputFileTracingExcludes` no lo quita: se probó el 19/11/2026 con y sin «./»
 * en los patrones, en un build de Linux.
 */
const OCR_ROUTES = [
  "/candidatos/[id]",
  "/vacantes/[id]",
  "/vacantes/[id]/carga-masiva",
  "/empleos/[slug]",
  "/api/integraciones/talent/postular/[code]/[token]",
];

/**
 * Fuentes estándar y mapas de caracteres de PDF.js (`pdfjs-dist`). `unpdf` los
 * usa si encuentra el paquete; sin ellos, al dibujar un PDF con fuentes estándar
 * no incrustadas depende de las fuentes del servidor (Vercel no tiene), y la
 * detección de texto sin contraste se omite en silencio (ensayo en Linux del
 * 19/11/2026). `unpdf` los busca en tiempo de ejecución: el rastreo no los ve.
 */
const PDF_FONT_FILES = [
  "./node_modules/pdfjs-dist/package.json",
  "./node_modules/pdfjs-dist/standard_fonts/**/*",
  "./node_modules/pdfjs-dist/cmaps/**/*",
];

/** Rutas que leen PDF (extracción y contraste): las de OCR y las que solo extraen. */
const PDF_ROUTES = [...OCR_ROUTES, "/postulaciones/[id]", "/api/bot/postulantes", "/api/evaluar-cv"];

// Los corchetes de las rutas dinámicas se escapan para picomatch.
const routeGlob = (route: string) => route.replace(/[[\]]/g, "\\$&");

const nextConfig: NextConfig = {
  cacheComponents: false,
  partialPrefetching: false,
  poweredByHeader: false,
  // Carpeta de salida configurable por entorno: permite generar un build de
  // producción (`.next-prod`) sin pisar el `.next` del servidor de desarrollo.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // El type-check y el lint se ejecutan por separado (`npm run typecheck` /
  // `npm run lint`), que cubren TODO el repo (incluidos bot, correo, mercado y
  // scripts). El build del sitio web no debe caerse por errores de esos
  // subsistemas Node que no forman parte del bundle web.
  typescript: { ignoreBuildErrors: true },
  // Bibliotecas de extracción de texto que se ejecutan solo en el servidor.
  // tesseract.js y @napi-rs/canvas (OCR local) cargan binarios, WASM y workers por ruta.
  serverExternalPackages: ["unpdf", "mammoth", "tesseract.js", "@napi-rs/canvas"],
  outputFileTracingIncludes: Object.fromEntries(
    PDF_ROUTES.map((route) => [routeGlob(route), [...(OCR_ROUTES.includes(route) ? OCR_RUNTIME_FILES : []), ...PDF_FONT_FILES]]),
  ),
  experimental: {
    serverActions: {
      // CV de hasta 4 MB + margen del multipart. Vercel limita el cuerpo de
      // las funciones a 4,5 MB (ver docs/pendientes.md).
      bodySizeLimit: "4.3mb",
    },
    // Desactivado a propósito. En desarrollo, Next 16 arranca un único proceso
    // hijo ("dev validation worker") que carga el grafo de módulos de la ruta
    // visitada para validarla. En las rutas con OCR (/candidatos/[id],
    // /vacantes/[id], /vacantes/[id]/carga-masiva, /empleos/[slug]) ese grafo
    // arrastra unpdf (pdf.js + WASM) y mammoth; cargarlos en ese worker lo hace
    // caer y se muestra en pantalla "Jest worker encountered N child process
    // exceptions, exceeding retry limit". Es solo un validador de desarrollo:
    // apagarlo no cambia el comportamiento de la app, del build ni de producción.
    devValidationWorker: false,
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;

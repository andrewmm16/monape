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

/** Rutas que ejecutan OCR: carga de CV (candidato y lote), evaluación de pendientes, postulación pública y Talent. */
const OCR_ROUTES = [
  "/candidatos/[id]",
  "/vacantes/[id]",
  "/vacantes/[id]/carga-masiva",
  "/empleos/[slug]",
  "/api/integraciones/talent/postular/[code]/[token]",
];

const nextConfig: NextConfig = {
  cacheComponents: false,
  partialPrefetching: false,
  poweredByHeader: false,
  // Bibliotecas de extracción de texto que se ejecutan solo en el servidor.
  // tesseract.js y @napi-rs/canvas (OCR local) cargan binarios, WASM y workers por ruta.
  serverExternalPackages: ["unpdf", "mammoth", "tesseract.js", "@napi-rs/canvas"],
  outputFileTracingIncludes: Object.fromEntries(
    // Los corchetes de las rutas dinámicas se escapan para picomatch.
    OCR_ROUTES.map((route) => [route.replace(/[[\]]/g, "\\$&"), OCR_RUNTIME_FILES]),
  ),
  experimental: {
    serverActions: {
      // CV de hasta 4 MB + margen del multipart. Vercel limita el cuerpo de
      // las funciones a 4,5 MB (ver docs/pendientes.md).
      bodySizeLimit: "4.3mb",
    },
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

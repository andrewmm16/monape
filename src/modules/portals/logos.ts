import "server-only";
import { existsSync } from "node:fs";
import path from "node:path";

const EXTENSIONS = ["svg", "png", "webp"] as const;

/** «Empleos Perú» → «empleos-peru»: nombre del archivo del logo en `public/portales`. */
function portalSlug(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Ruta pública del logo del portal, o null si no hay archivo (se muestran las iniciales). */
export function portalLogo(name: string): string | null {
  const slug = portalSlug(name);
  const found = EXTENSIONS.find((ext) => existsSync(path.join(process.cwd(), "public", "portales", `${slug}.${ext}`)));
  return found ? `/portales/${slug}.${found}` : null;
}

import type { Page } from "@playwright/test";
import { sanitizeText } from "./incidents";

/**
 * Esquema de la pantalla actual para diagnosticar cambios del portal: campos
 * (tipo, nombre, id, etiqueta, si es obligatorio) y botones (solo su texto si es
 * corto: de 4 palabras o menos). NUNCA incluye valores de campos, títulos,
 * encabezados ni textos de párrafos, tablas o enlaces, porque ahí aparecen datos
 * de postulantes («Postulante: Juan Pérez», «Descargar CV de Juan Pérez»). Aun así
 * se pasa por `sanitizeText` y se queda en la carpeta local del robot.
 *
 * Nota: dentro de `evaluate` no se declaran funciones con nombre, y tampoco
 * `const algo = () => …`: `tsx` (esbuild) las envuelve con `__name` y fallan en el
 * navegador. Con vitest no se nota; solo con `npm run bot`.
 */
export async function captureStructure(page: Page): Promise<string> {
  const raw = await page.evaluate(() => {
    // Nada con nombre aquí dentro: ni `function` ni `const algo = () =>` (tsx también las envuelve con `__name`).
    const fields = Array.from(document.querySelectorAll("input, select, textarea")).map((el) => {
      const id = el.getAttribute("id");
      const byFor = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
      const label = byFor?.textContent ?? el.closest("label")?.textContent ?? el.getAttribute("aria-label") ?? "";
      return {
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute("type") ?? "",
        name: el.getAttribute("name") ?? "",
        id: el.getAttribute("id") ?? "",
        label: label.trim().slice(0, 60),
        required: el.hasAttribute("required"),
      };
    });
    const buttons = Array.from(document.querySelectorAll("button, [role=button], input[type=submit]")).map((el) => {
      const text = ((el as HTMLInputElement).value || el.textContent || "").trim();
      // Un texto largo suele llevar un nombre propio: no se guarda.
      const short = text.split(/\s+/).length <= 4;
      return { id: el.getAttribute("id") ?? "", text: short ? text.slice(0, 40) : "[texto largo]", type: el.getAttribute("type") ?? "" };
    });
    return { url: location.origin + location.pathname, fields, buttons };
  });
  return sanitizeText(JSON.stringify(raw), 20_000);
}

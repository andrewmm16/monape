import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { DeepDiveSectionProps } from "@/components/applications/deep-dive-section";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
  usePathname: () => "/postulaciones/app-1",
  useSearchParams: () => new URLSearchParams(),
}));
// La acción del botón es una Server Action: aquí solo importa que exista.
vi.mock("@/modules/applications/actions", () => ({ requestDeepDiveAction: async () => ({ ok: true, data: { id: "d1" } }) }));

const { DeepDiveSection } = await import("@/components/applications/deep-dive-section");

const base: Omit<DeepDiveSectionProps, "mode"> = { questions: [], canRequest: false, applicationId: "app-1", status: null };

describe("sección «Para profundizar»", () => {
  it("en modo resumida un error muestra su motivo junto a «Intentar de nuevo»", () => {
    const html = renderToStaticMarkup(
      createElement(DeepDiveSection, {
        ...base,
        mode: "resumida",
        canRequest: true,
        status: { message: "No se pudieron generar con IA: el CV no tiene texto legible.", tone: "warning", active: false },
      }),
    );
    expect(html).toContain("No se pudieron generar con IA: el CV no tiene texto legible.");
    expect(html).toContain("Intentar de nuevo");
  });

  it("sin preguntas usa un texto neutro (lo acreditado puede estar ya verificado o en duda)", () => {
    const html = renderToStaticMarkup(createElement(DeepDiveSection, { ...base, mode: "completa" }));
    expect(html).toContain("No hay requisitos acreditados pendientes de profundizar.");
    expect(html).not.toContain("todavía no acredita");
  });
});

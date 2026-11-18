import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Los diálogos de verificación usan el enrutador de Next (fuera de Next no hay contexto).
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
  usePathname: () => "/postulaciones/app-1",
  useSearchParams: () => new URLSearchParams(),
}));

const { EvaluationCard } = await import("@/components/applications/evaluation-card");

/**
 * La segunda opinión de la IA dentro de la tarjeta del motor: el motor es lo
 * principal (su puntaje), la IA se muestra requisito por requisito donde opina
 * distinto, o donde ve un indicio que el motor no encontró.
 */

type Assessment = "acreditado" | "no_cumplido" | "sin_evidencia" | "pendiente_verificacion";

const evaluation = (id: string, method: "reglas" | "ia") => ({
  id,
  method,
  criteria_version: 1,
  level: "parcial",
  score: 50,
  score_potential: 90,
  summary: `Resumen ${method}.`,
  created_at: "2026-11-18T15:00:00Z",
  resume_id: "res-1",
  resume: { version: 1, original_filename: "cv.pdf", resume_extractions: { warnings: [] } },
});

const item = (requirementId: string, assessment: Assessment, rationale: string, verified = false) => ({
  id: `${rationale}-${requirementId}`,
  requirement_id: requirementId,
  description: `Requisito ${requirementId}`,
  priority: "obligatorio",
  is_essential: false,
  assessment,
  evidence: assessment === "acreditado" ? [{ quote: `cita ${rationale}` }] : [],
  rationale,
  verification_source: verified ? "entrevista" : null,
  verification_note: verified ? "Comprobado." : null,
  verified_at: verified ? "2026-11-18T15:00:00Z" : null,
  verifier: verified ? { full_name: "RRHH" } : null,
});

function render(withSecondOpinion: boolean, aiOnA: Assessment = "acreditado") {
  const engine = [
    item("a", "pendiente_verificacion", "motor-a"), // la IA acredita: opina distinto
    item("b", "sin_evidencia", "motor-b"), // la IA ve un indicio
    item("c", "acreditado", "motor-c"), // coinciden
    item("d", "acreditado", "motor-d", true), // verificado por RRHH: ya no se compara
  ];
  const ai = [
    item("a", aiOnA, "ia-a"),
    item("b", "pendiente_verificacion", "ia-b"),
    item("c", "acreditado", "ia-c"),
    item("d", "no_cumplido", "ia-d"),
  ];
  return renderToStaticMarkup(
    createElement(EvaluationCard, {
      applicationId: "app-1",
      evaluation: evaluation("ev-reglas", "reglas") as never,
      items: engine as never,
      history: [evaluation("ev-ia", "ia"), evaluation("ev-reglas", "reglas")] as never,
      isCurrent: true,
      secondOpinion: withSecondOpinion ? ({ evaluation: evaluation("ev-ia", "ia"), items: ai } as never) : null,
      currentCriteriaVersion: 1,
      canReview: true,
    }),
  );
}

describe("tarjeta del motor con la segunda opinión de la IA", () => {
  it("resume dónde opina distinto y dónde ve indicios, sin contar lo verificado por RRHH", () => {
    const html = render(true);
    expect(html).toContain("Segunda opinión de la IA");
    expect(html).toContain("opina distinto en 1 requisito que el motor resolvió sin dudas");
    expect(html).toContain("Además ve indicios en 1 requisito");
    expect(html).toContain("/postulaciones/app-1?evaluacion=ev-ia");
  });

  it("marca cada requisito con la opinión de la IA: distinta (con su cita) o indicio", () => {
    const html = render(true);
    expect(html.match(/La IA opina distinto/g)).toHaveLength(1);
    expect(html).toContain("cita ia-a");
    expect(html).toContain("ia-a");
    expect(html.match(/La IA ve un indicio/g)).toHaveLength(1);
    expect(html).toContain("ia-b");
    // Coincidente y verificado: sin nota de la IA.
    expect(html).not.toContain("ia-c");
    expect(html).not.toContain("ia-d");
  });

  it("sobre la evaluación vigente del motor se puede verificar, aunque la de IA sea más reciente", () => {
    expect(render(true)).toContain("Verificar");
  });

  it("si solo ve indicios, no dice que «coincide» en todo: dice que no contradice al motor", () => {
    const html = render(true, "pendiente_verificacion");
    expect(html).toContain("no contradice al motor en ninguno de los 3 requisitos");
    expect(html).toContain("Además ve indicios en 1 requisito");
    expect(html).not.toContain("La IA opina distinto");
  });

  it("marca lo que resolvió la IA o una regla aprendida, con lo que había dicho el motor", () => {
    const html = renderToStaticMarkup(
      createElement(EvaluationCard, {
        applicationId: "app-1",
        evaluation: evaluation("ev-reglas", "reglas") as never,
        items: [
          { ...item("a", "acreditado", "Resuelto por la IA (el motor lo dejó por confirmar): cargo equivalente."), resolved_by: "ia", engine_assessment: "pendiente_verificacion" },
          { ...item("b", "acreditado", "Regla aprendida: «Asistente de Residencia» cuenta."), resolved_by: "regla_aprendida", engine_assessment: "pendiente_verificacion" },
          item("c", "acreditado", "motor-c"),
        ] as never,
        history: [evaluation("ev-reglas", "reglas")] as never,
        isCurrent: true,
        currentCriteriaVersion: 1,
        canReview: false,
      }),
    );
    expect(html).toContain("La IA resolvió 1 duda del motor y ya cuenta en el puntaje.");
    expect(html).toContain("1 requisito se resolvió con reglas que el motor aprendió de la IA.");
    expect(html).toContain("Resuelto por la IA");
    expect(html).toContain("Regla aprendida");
    expect(html.match(/El motor solo lo había dejado como «por confirmar»/g)).toHaveLength(2);
  });

  it("sin segunda opinión, la tarjeta no menciona a la IA", () => {
    const html = render(false);
    expect(html).not.toContain("Segunda opinión de la IA");
    expect(html).not.toContain("La IA");
  });
});

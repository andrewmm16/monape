import { describe, expect, it } from "vitest";
import { interviewerNoticeLabel, noticeOutcomeOf, summarizeInterviewerNotices } from "@/modules/interviews/notices";

describe("summarizeInterviewerNotices", () => {
  it("cruza los correos vigentes con el último resultado de cada uno (sin distinguir mayúsculas)", () => {
    const summary = summarizeInterviewerNotices(
      ["Ana@empresa.test", "luis@empresa.test", "nuevo@empresa.test"],
      [
        { recipient: "ana@empresa.test", outcome: "enviado" },
        { recipient: "luis@empresa.test", outcome: "no_enviado" },
        // Un correo que ya no está en la entrevista no cuenta.
        { recipient: "antiguo@empresa.test", outcome: "no_enviado" },
      ],
    );
    expect(summary).toEqual({ total: 3, sent: 1, failed: 1, disabled: 0 });
  });

  it("sin correos de entrevistadores, total 0", () => {
    expect(summarizeInterviewerNotices(null, null)).toEqual({ total: 0, sent: 0, failed: 0, disabled: 0 });
  });
});

describe("noticeOutcomeOf", () => {
  it("enviado, desactivado (correo apagado) o no enviado (el servicio lo rechazó)", () => {
    expect(noticeOutcomeOf({ sent: true })).toBe("enviado");
    expect(noticeOutcomeOf({ sent: false, disabled: true })).toBe("desactivado");
    expect(noticeOutcomeOf({ sent: false })).toBe("no_enviado");
  });
});

describe("interviewerNoticeLabel", () => {
  it("no muestra nada sin entrevistadores con correo", () => {
    expect(interviewerNoticeLabel({ total: 0, sent: 0, failed: 0, disabled: 0 })).toBeNull();
  });

  it("no dice que avisó cuando el envío falló", () => {
    const label = interviewerNoticeLabel({ total: 1, sent: 0, failed: 1, disabled: 0 });
    expect(label?.tone).toBe("warning");
    expect(label?.text).toBe("No se pudo avisar a 1 entrevistador");
    expect(label?.text).not.toMatch(/^Avisos? a/);
  });

  it("parcial: cuántos fallaron y a cuántos sí", () => {
    expect(interviewerNoticeLabel({ total: 3, sent: 2, failed: 1, disabled: 0 })?.text).toBe(
      "No se pudo avisar a 1 entrevistador (sí a 2)",
    );
  });

  it("todos enviados", () => {
    const label = interviewerNoticeLabel({ total: 2, sent: 2, failed: 0, disabled: 0 });
    expect(label).toMatchObject({ tone: "ok", text: "Aviso enviado a 2 entrevistadores" });
  });

  it("correo desactivado: lo dice sin hablar de fallo", () => {
    const label = interviewerNoticeLabel({ total: 1, sent: 0, failed: 0, disabled: 1 });
    expect(label).toMatchObject({ tone: "neutral", text: "1 entrevistador con correo · envío de correos desactivado" });
  });

  it("sin resultado aún (enviándose o entrevista anterior al cambio): neutral, sin afirmar que salió", () => {
    expect(interviewerNoticeLabel({ total: 2, sent: 0, failed: 0, disabled: 0 })).toMatchObject({
      tone: "neutral",
      text: "2 entrevistadores con correo",
    });
  });
});

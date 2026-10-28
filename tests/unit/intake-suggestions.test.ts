import { describe, expect, it } from "vitest";
import { suggestName } from "@/modules/resumes/suggestions";

describe("sugerencia de nombre", () => {
  it("toma la primera línea con forma de nombre y la devuelve con su evidencia", () => {
    const text = "Lucía Fernanda Ramos Quispe\nAnalista de datos\nlucia@correo.test\n987 654 321";
    expect(suggestName(text)).toEqual({ value: "Lucía Fernanda Ramos Quispe", evidence: "Lucía Fernanda Ramos Quispe" });
  });

  it("ignora encabezados como «Currículum vitae», «Hoja de vida» o «Perfil profesional»", () => {
    expect(suggestName("CURRÍCULUM VITAE\nJuan Pérez Soto\nLima")?.value).toBe("Juan Pérez Soto");
    expect(suggestName("Curriculum Vitae\nHoja de Vida\nPerfil Profesional\nMaría del Carmen Díaz")?.value).toBe(
      "María del Carmen Díaz",
    );
    expect(suggestName("Hoja de vida\nExperiencia Laboral\nFormación Académica")).toBeUndefined();
    expect(suggestName("Perfil profesional\nDatos Personales")).toBeUndefined();
  });

  it("no toma líneas con cifras, correos o fuera de 2 a 5 palabras", () => {
    expect(suggestName("Calle Los Olivos 123\nana@correo.test\nAna María 2020")).toBeUndefined();
    expect(suggestName("Ana\nUna Línea Con Demasiadas Palabras Para Ser Nombre")).toBeUndefined();
    expect(suggestName("contacto: ana@correo.test\nJuan Soto")?.value).toBe("Juan Soto");
  });

  it("no propone frases en minúscula ni líneas con símbolos", () => {
    expect(suggestName("responsable de las compras de la empresa")).toBeUndefined();
    expect(suggestName("Ventas & Marketing\n- Gestión de cuentas")).toBeUndefined();
  });

  it("sin texto no propone nada", () => {
    expect(suggestName("")).toBeUndefined();
    expect(suggestName("\n\n  \n")).toBeUndefined();
  });
});

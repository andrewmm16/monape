import { describe, expect, it } from "vitest";
import { detectKeywordStuffing, summarizeStuffing } from "@/modules/resumes/keyword-stuffing";
import { suggestFields } from "@/modules/resumes/suggestions";

/**
 * Ajustes tras probar el OCR con CV reales (18/11/2026): la arroba mal leída y los
 * falsos positivos del aviso de relleno en CV de otros idiomas o con la profesión
 * repetida de forma natural.
 */
const aviso = (text: string) => summarizeStuffing(detectKeywordStuffing(text));

describe("correo con la arroba mal leída por el OCR", () => {
  it("reconstruye «2a» antes de un proveedor conocido y cita lo que leyó el OCR", () => {
    const email = suggestFields("Tel: +242 06 515 19 63\n— ngouloucyrille2agmail.com . “ , ,").email!;
    expect(email.value).toBe("ngouloucyrille@gmail.com");
    expect(email.evidence).toContain("ngouloucyrille2agmail.com");
  });

  it("también «©», «(a)» y la arroba separada por espacios", () => {
    expect(suggestFields("Correo: juan.perez © hotmail.com").email?.value).toBe("juan.perez@hotmail.com");
    expect(suggestFields("maria_r (a) Outlook.ES").email?.value).toBe("maria_r@outlook.es");
    expect(suggestFields("lucia.q @ yahoo.com").email?.value).toBe("lucia.q@yahoo.com");
  });

  it("un usuario que termina en «2a» se conserva", () => {
    expect(suggestFields("maria2a2agmail.com").email?.value).toBe("maria2a@gmail.com");
  });

  it("un correo bien leído tiene prioridad", () => {
    expect(suggestFields("ana@empresa.pe · otra2agmail.com").email?.value).toBe("ana@empresa.pe");
  });

  it("no inventa correos fuera de los proveedores conocidos ni en texto corriente", () => {
    expect(suggestFields("ventas2aempresa.com.pe").email).toBeUndefined();
    expect(suggestFields("Experiencia en gmail y outlook como herramientas.").email).toBeUndefined();
  });
});

describe("aviso de relleno con CV de otros idiomas o de una profesión", () => {
  const frase = (i: number) => `Durante el año ${2000 + i} trabajé dando clases de música en una escuela pública local.`;

  it("las palabras vacías de otros idiomas no cuentan («des» en francés)", () => {
    const texto = Array.from({ length: 14 }, (_, i) => `Gestion des projets et des équipes ${i}, suivi des clients`).join("\n");
    expect(aviso(texto)).toBeNull();
  });

  it("la profesión repetida una vez por frase es uso natural", () => {
    expect(aviso(Array.from({ length: 14 }, (_, i) => frase(i)).join("\n"))).toBeNull();
  });

  it("la misma palabra muchas veces en líneas cortas sigue siendo relleno", () => {
    const texto = `${Array.from({ length: 14 }, (_, i) => frase(i)).join("\n")}\n${Array.from({ length: 14 }, () => "SAP experto").join("\n")}`;
    expect(aviso(texto)).toContain("«SAP» 14 veces");
  });

  it("y también muchas veces en una misma frase", () => {
    const texto = `${frase(0)}\n${Array.from({ length: 14 }, () => "Manejo de SAP.").join(" ")}`;
    expect(aviso(texto)).toContain("«SAP» 14 veces");
  });
});

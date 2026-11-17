import { describe, expect, it } from "vitest";
import {
  detectKeywordStuffing,
  isStuffingWarning,
  STUFFING_WARNING_PREFIX,
  summarizeStuffing,
} from "@/modules/resumes/keyword-stuffing";

const aviso = (text: string) => summarizeStuffing(detectKeywordStuffing(text));

const CV_NORMAL = `Diego Martín Chávez Orellana
Asesor Comercial | Ventas y Atención de Cuentas
RESUMEN PROFESIONAL
Asesor comercial con 4 años de experiencia en ventas de productos de consumo masivo.
EXPERIENCIA LABORAL
Asesor Comercial Mar 2022 - Actualidad
Cumplí 104% de la meta trimestral promedio. Registré visitas y pedidos en CRM Zoho.
HABILIDADES
Ventas en campo
CRM Zoho
Negociación básica
Excel intermedio`;

/** N términos sueltos distintos e inventados, que no aparecen en ningún otro lugar. */
const terminos = (n: number) => Array.from({ length: n }, (_, i) => `Herramienta${String.fromCharCode(65 + (i % 26))}${Math.floor(i / 26)}`);

describe("relleno de palabras clave visible", () => {
  it("un CV normal no genera aviso", () => {
    expect(aviso(CV_NORMAL)).toBeNull();
  });

  it("una lista enorme de términos sueltos sin respaldo en el CV genera aviso", () => {
    const texto = `${CV_NORMAL}\nCONOCIMIENTOS\n${terminos(45).join(", ")}`;
    const resultado = aviso(texto);
    // 45 de la lista + los 4 ítems de HABILIDADES del CV base.
    expect(resultado).toContain("49 términos sueltos");
    expect(resultado).toContain("compruebe");
    expect(resultado).toContain("No cambia la evaluación");
  });

  it("también cuenta las listas de un ítem por línea bajo un encabezado de habilidades", () => {
    const texto = `${CV_NORMAL.replace("HABILIDADES", "OTROS")}\nHABILIDADES\n${terminos(45).join("\n")}`;
    expect(aviso(texto)).toContain("términos sueltos");
  });

  it("un perfil técnico que lista 30 tecnologías no genera aviso", () => {
    const texto = `${CV_NORMAL}\nTECNOLOGÍAS\n${terminos(30).join(", ")}`;
    expect(aviso(texto)).toBeNull();
  });

  it("si los términos de la lista aparecen en la experiencia, están respaldados", () => {
    const lista = terminos(45);
    const texto = `${CV_NORMAL}\nEXPERIENCIA\nUsé ${lista.join(" y ")} en proyectos reales.\nCONOCIMIENTOS\n${lista.join(", ")}`;
    expect(aviso(texto)).toBeNull();
  });

  it("una palabra repetida muchas veces genera aviso con su grafía y la cuenta", () => {
    const texto = `${CV_NORMAL}\n${Array.from({ length: 14 }, () => "Manejo de SAP.").join(" ")}`;
    expect(aviso(texto)).toContain("«SAP» 14 veces");
  });

  it("una palabra de dominio repetida unas pocas veces es normal", () => {
    const texto = `${CV_NORMAL}\n${Array.from({ length: 8 }, () => "Ventas corporativas.").join(" ")}`;
    expect(aviso(texto)).toBeNull();
  });

  it("la misma palabra varias veces seguidas genera aviso", () => {
    expect(aviso(`${CV_NORMAL}\nSAP SAP SAP Concar`)).toContain("varias veces seguidas «SAP»");
  });

  it("el aviso se reconoce por su prefijo", () => {
    const resultado = aviso(`${CV_NORMAL}\nSAP SAP SAP`)!;
    expect(resultado.startsWith(STUFFING_WARNING_PREFIX)).toBe(true);
    expect(isStuffingWarning(resultado)).toBe(true);
    expect(isStuffingWarning("El texto superaba 200 000 caracteres y se truncó.")).toBe(false);
  });
});

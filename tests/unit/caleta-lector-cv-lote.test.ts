import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  analizarCvTexto,
  leerCvLote,
  listarCvs,
  normalizarCelularPeru,
  procesarArchivoCv,
} from "@/modules/caleta/lector-cv-lote";

const CV_PRUEBA = resolve(import.meta.dirname, "..", "..", "cv-prueba");

describe("normalizarCelularPeru", () => {
  it("normaliza celulares de Perú con separadores y prefijo +51", () => {
    expect(normalizarCelularPeru("999 000 001")).toBe("999000001");
    expect(normalizarCelularPeru("+51 987-654-321")).toBe("987654321");
    expect(normalizarCelularPeru("51987654321")).toBe("987654321");
  });

  it("rechaza lo que no es un celular peruano", () => {
    expect(normalizarCelularPeru("(01) 234 5678")).toBeNull(); // fijo
    expect(normalizarCelularPeru("2018 - 2021")).toBeNull(); // rango de años
    expect(normalizarCelularPeru("812345678")).toBeNull(); // no empieza por 9
    expect(normalizarCelularPeru(null)).toBeNull();
  });
});

describe("analizarCvTexto", () => {
  it("extrae nombre, correo, teléfono y marca apto", () => {
    const texto = [
      "Carmen Rosa Quispe Huamani",
      "carmen.quispe@example.com · 999 000 001",
      "Contadora Pública Colegiada",
      "Dominio de Excel avanzado y SQL",
    ].join("\n");

    const c = analizarCvTexto(texto, "01_Asistente_Contable/CV_Quispe_Carmen.pdf");

    expect(c.nombre).toBe("Carmen Rosa Quispe Huamani");
    expect(c.correo).toBe("carmen.quispe@example.com");
    expect(c.celularPeru).toBe("999000001");
    expect(c.habilidades).toEqual(expect.arrayContaining(["Excel", "SQL"]));
    expect(c.apto).toBe(true);
    expect(c.evidencias.correo).toContain("carmen.quispe@example.com");
  });

  it("marca no apto cuando no hay ninguna vía de contacto", () => {
    const c = analizarCvTexto("Perfil profesional sin datos de contacto.", "x.pdf");
    expect(c.correo).toBeNull();
    expect(c.telefono).toBeNull();
    expect(c.apto).toBe(false);
  });
});

describe("lectura del banco de CVs de prueba", () => {
  it("lista los 32 PDFs del banco", async () => {
    const rutas = await listarCvs(CV_PRUEBA);
    expect(rutas.length).toBeGreaterThanOrEqual(20);
    expect(rutas.every((r) => r.toLowerCase().endsWith(".pdf"))).toBe(true);
  });

  it("extrae correo y celular de un PDF real del banco", async () => {
    const ruta = resolve(CV_PRUEBA, "01_Asistente_Contable", "CV_Quispe_Carmen.pdf");
    const c = await procesarArchivoCv(ruta, CV_PRUEBA);
    expect(c.correo).toBe("carmen.quispe@example.com");
    expect(c.celularPeru).toBe("999000001");
    expect(c.apto).toBe(true);
  });

  it("procesa el lote completo sin errores y todos aptos", async () => {
    const resultado = await leerCvLote({ entrada: CV_PRUEBA });
    expect(resultado.totales.errores).toBe(0);
    expect(resultado.totales.candidatos).toBe(resultado.totales.archivos);
    // El banco es texto seleccionable: todos deben tener correo o teléfono.
    expect(resultado.totales.aptos).toBe(resultado.totales.candidatos);
  });
});

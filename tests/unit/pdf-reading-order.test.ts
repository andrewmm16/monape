import { describe, expect, it } from "vitest";
import { readingOrderText, type OrderItem } from "@/modules/resumes/pdf-reading-order";

// Fragmentos de una página A4 (595 pt de ancho) con letra de 10 pt.
const item = (str: string, x: number, y: number, width: number, hasEOL = true): OrderItem => ({ str, x, y, fontSize: 10, hasEOL, width });

describe("orden de lectura del PDF", () => {
  it("sin nada fuera de orden, el texto es el de siempre", () => {
    const items = [item("Cajera | La Canasta", 40, 700, 120, false), item("Mar 2018 – Presente", 460, 700, 95), item("Cobro en caja", 40, 686, 80)];
    expect(readingOrderText(items)).toBe("Cajera | La CanastaMar 2018 – Presente\nCobro en caja\n");
  });

  it("la fecha flotante que el PDF guardó al principio vuelve a su cargo", () => {
    const items = [
      item("Mar 2019 – a la fecha", 450, 600, 105),
      item("2016-2019", 510, 540, 45),
      item("Carlos Huamán", 40, 760, 90),
      item("EXPERIENCIA LABORAL", 40, 620, 120),
      item("Operador de montacargas | Distribuidora Andina", 40, 600, 250),
      item("Manejo de montacargas contrapesado y apilador eléctrico, turno día, en dos turnos", 40, 586, 480),
      item("Almacenero | Comercial Los Pinos", 40, 540, 170),
      item("Recepción de camiones, verificación de guías de remisión, orden y limpieza del almacén", 40, 526, 515),
    ];
    expect(readingOrderText(items).split("\n")).toEqual([
      "Carlos Huamán",
      "EXPERIENCIA LABORAL",
      "Operador de montacargas | Distribuidora Andina Mar 2019 – a la fecha",
      "Manejo de montacargas contrapesado y apilador eléctrico, turno día, en dos turnos",
      "Almacenero | Comercial Los Pinos 2016-2019",
      "Recepción de camiones, verificación de guías de remisión, orden y limpieza del almacén",
      "",
    ]);
  });

  it("dos columnas con la derecha guardada primero: no se mezclan", () => {
    // Columna derecha (x 200–555) antes que la barra lateral (x 40–180): nada cruza el canal.
    const items = [
      item("Analista contable", 200, 700, 100),
      item("2019 - 2023", 495, 680, 60),
      item("Conciliaciones bancarias y cierre mensual de la empresa", 200, 666, 300),
      item("CONTACTO", 40, 700, 60),
      item("Lima", 40, 680, 25),
      item("999 000 111", 40, 666, 60),
    ];
    const plano = items.map((i) => i.str + "\n").join("");
    expect(readingOrderText(items)).toBe(plano);
  });

  it("dos columnas con la fecha flotante del cargo: va con el cargo, no con la barra lateral", () => {
    const items = [
      item("2019 - 2023", 495, 680, 60),
      item("CONTACTO", 40, 700, 60),
      item("Lima", 40, 680, 25),
      item("EXPERIENCIA", 200, 700, 80),
      item("Analista contable | Andina", 200, 680, 150),
      item("Conciliaciones bancarias y cierre mensual de la empresa", 200, 666, 300),
    ];
    expect(readingOrderText(items).split("\n")).toEqual([
      "CONTACTO",
      "Lima",
      "EXPERIENCIA",
      "Analista contable | Andina 2019 - 2023",
      "Conciliaciones bancarias y cierre mensual de la empresa",
      "",
    ]);
  });

  it("lo que no está alineado a la derecha no se mueve", () => {
    const items = [
      item("WORK EXPERIENCE", 200, 650, 100),
      item("Receptionist and executive assistant at a logistics company, 2020 - present", 40, 636, 515),
      item("Administrative", 40, 650, 80),
    ];
    expect(readingOrderText(items)).toBe(items.map((i) => i.str + "\n").join(""));
  });

  it("sin el ancho de los fragmentos no se mueve nada", () => {
    const items = [
      { str: "Mar 2019 – a la fecha", x: 450, y: 600, fontSize: 10, hasEOL: true },
      { str: "Operador | Distribuidora", x: 40, y: 600, fontSize: 10, hasEOL: true },
      { str: "Manejo de montacargas contrapesado y apilador eléctrico en el almacén central", x: 40, y: 586, fontSize: 10, hasEOL: true },
    ];
    expect(readingOrderText(items)).toBe(items.map((i) => i.str + "\n").join(""));
  });
});

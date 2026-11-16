import { describe, expect, it } from "vitest";
import { parseAddressQuery } from "@/modules/interviews/address-query";

describe("abreviaturas de direcciones peruanas", () => {
  it.each([
    ["jr los zafiros", "Jirón los zafiros"],
    ["Jr. Los Zafiros", "Jirón Los Zafiros"],
    ["JR.los zafiros", "Jirón los zafiros"],
    ["av larco", "Avenida larco"],
    ["Av. Larco", "Avenida Larco"],
    ["avda larco", "Avenida larco"],
    ["psje los olivos", "Pasaje los olivos"],
    ["pje los olivos", "Pasaje los olivos"],
    ["urb los pinos", "Urbanización los pinos"],
    ["prol iquitos", "Prolongación iquitos"],
    ["ca los pinos", "Calle los pinos"],
    ["cl. los pinos", "Calle los pinos"],
    ["aa.hh. san pedro", "Asentamiento Humano san pedro"],
    ["ah san pedro", "Asentamiento Humano san pedro"],
    ["jr mcal miller", "Jirón Mariscal miller"],
    ["av gral garzon", "Avenida General garzon"],
    ["av sta rosa", "Avenida Santa rosa"],
  ])("%s → %s", (raw, street) => {
    expect(parseAddressQuery(raw).street).toBe(street);
  });

  it("no toca palabras que solo se parecen a una abreviatura", () => {
    expect(parseAddressQuery("calle Avellaneda").street).toBe("calle Avellaneda");
    expect(parseAddressQuery("Jirón Santander").street).toBe("Jirón Santander");
    expect(parseAddressQuery("Los Ca Pinos").street).toBe("Los Ca Pinos");
    expect(parseAddressQuery("Plaza Urbano").street).toBe("Plaza Urbano");
  });
});

describe("numeración", () => {
  it("separa el número de la vía y conserva el texto completo para buscar la casa", () => {
    expect(parseAddressQuery("jiron los zafiros 2023")).toEqual({
      full: "jiron los zafiros 2023",
      street: "jiron los zafiros",
      name: "los zafiros",
      houseNumber: "2023",
      interior: null,
      suffix: "2023",
    });
    expect(parseAddressQuery("jr los zafiros 2023")).toMatchObject({ street: "Jirón los zafiros", name: "los zafiros", houseNumber: "2023" });
  });

  it.each([
    ["Jr. Los Zafiros Nro 2023", "2023"],
    ["Jr. Los Zafiros Nro. 2023", "2023"],
    ["Jr. Los Zafiros N° 2023", "2023"],
    ["Jr. Los Zafiros Nº2023", "2023"],
    ["Jr. Los Zafiros #2023", "2023"],
    ["Jr. Los Zafiros Num 2023", "2023"],
    ["Jr. Los Zafiros 120-B", "120-B"],
    ["Jr. Los Zafiros 120B", "120B"],
  ])("%s → número %s", (raw, number) => {
    const query = parseAddressQuery(raw);
    expect(query.houseNumber).toBe(number);
    expect(query.street).toBe("Jirón Los Zafiros");
  });

  it("un número que es parte del nombre de la vía no es la numeración", () => {
    expect(parseAddressQuery("Av. 28 de Julio").houseNumber).toBeNull();
    expect(parseAddressQuery("Av. 28 d").houseNumber).toBeNull();
    expect(parseAddressQuery("Calle 2 de Mayo").houseNumber).toBeNull();
    expect(parseAddressQuery("Calle 8").houseNumber).toBeNull();
    expect(parseAddressQuery("2023").houseNumber).toBeNull();
  });

  it("encuentra el número después de un nombre con cifras", () => {
    expect(parseAddressQuery("Av. 28 de Julio 450")).toMatchObject({ street: "Avenida 28 de Julio", houseNumber: "450" });
    expect(parseAddressQuery("Calle 8 120")).toMatchObject({ street: "Calle 8", houseNumber: "120" });
  });

  it("el distrito puede ir después del número, con o sin coma", () => {
    expect(parseAddressQuery("Av Arequipa 2450 Lince")).toMatchObject({
      full: "Avenida Arequipa 2450 Lince",
      street: "Avenida Arequipa Lince",
      houseNumber: "2450",
    });
    expect(parseAddressQuery("Av Arequipa 2450, Lince")).toMatchObject({ street: "Avenida Arequipa, Lince", houseNumber: "2450" });
  });

  it("se puede agregar el número a una sugerencia ya elegida", () => {
    expect(parseAddressQuery("Jirón Los Zafiros, San Juan de Lurigancho, Lima, Perú 2023")).toMatchObject({
      street: "Jirón Los Zafiros, San Juan de Lurigancho, Lima, Perú",
      houseNumber: "2023",
    });
    expect(parseAddressQuery("Jirón Los Zafiros 2023, San Juan de Lurigancho, Lima, Perú")).toMatchObject({
      street: "Jirón Los Zafiros, San Juan de Lurigancho, Lima, Perú",
      houseNumber: "2023",
    });
  });

  it("sin numeración, sin sufijo", () => {
    expect(parseAddressQuery("Avenida Larco")).toMatchObject({ houseNumber: null, suffix: null, interior: null });
  });
});

describe("otras formas peruanas de ubicar", () => {
  it("manzana y lote no se envían como calle y van en el sufijo", () => {
    expect(parseAddressQuery("urb los pinos mz b lt 5")).toMatchObject({
      street: "Urbanización los pinos",
      houseNumber: null,
      suffix: "Mz. B Lt. 5",
    });
    expect(parseAddressQuery("AA.HH. San Pedro Mz. C-Lt. 12").suffix).toBe("Mz. C Lt. 12");
    expect(parseAddressQuery("AA.HH. San Pedro Manzana C2").suffix).toBe("Mz. C2");
  });

  it("cuadra y kilómetro", () => {
    expect(parseAddressQuery("Av. Arequipa cdra 24")).toMatchObject({ street: "Avenida Arequipa", houseNumber: null, suffix: "Cdra. 24" });
    expect(parseAddressQuery("carr central km 12")).toMatchObject({ street: "Carretera central", suffix: "Km 12" });
  });

  it("departamento, oficina y piso no se buscan, pero se conservan", () => {
    expect(parseAddressQuery("Jr. Los Zafiros 2023 dpto 401")).toMatchObject({
      street: "Jirón Los Zafiros",
      houseNumber: "2023",
      interior: "Dpto. 401",
      suffix: "2023 Dpto. 401",
    });
    expect(parseAddressQuery("Av. Larco 345 of. 201").suffix).toBe("345 Of. 201");
    expect(parseAddressQuery("Av. Larco 345 piso 3").suffix).toBe("345 Piso 3");
    expect(parseAddressQuery("Av. Larco 345 int a").suffix).toBe("345 Int. A");
  });

  it("«Manzana» como parte de un nombre no es una manzana", () => {
    expect(parseAddressQuery("Calle Manzana de Oro").suffix).toBeNull();
  });
});

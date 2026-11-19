import { describe, expect, it } from "vitest";
import { formatCityRegion } from "@/components/vacancies/format-location";

describe("formatCityRegion", () => {
  it("no repite la región cuando es igual a la ciudad", () => {
    expect(formatCityRegion("Lima", "Lima")).toBe("Lima");
    expect(formatCityRegion(" lima ", "LIMA")).toBe("lima");
  });
  it("une ciudad y región distintas", () => {
    expect(formatCityRegion("Trujillo", "La Libertad")).toBe("Trujillo, La Libertad");
  });
  it("tolera datos faltantes", () => {
    expect(formatCityRegion("Cusco", null)).toBe("Cusco");
    expect(formatCityRegion(null, "Cusco")).toBe("Cusco");
    expect(formatCityRegion(null, null)).toBe("");
  });
});

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "../..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");
const viewBox = (svg: string) => /viewBox="([^"]+)"/.exec(svg)?.[1];

describe("activos de marca", () => {
  it("logo para fondo oscuro: letras blancas y degradado verde de la marca", () => {
    const svg = read("public/brand/logo-on-dark.svg");
    expect(svg).toContain('fill="#ffffff"');
    expect(svg).toMatch(/#1FF287/i);
    expect(svg).toMatch(/#07C199/i);
  });

  it("logo para fondo claro: sin letras blancas, mismo encuadre", () => {
    const light = read("public/brand/logo-on-light.svg");
    expect(light).not.toContain('fill="#ffffff"');
    expect(light).toContain('fill="#0A0A0F"');
    expect(viewBox(light)).toBe(viewBox(read("public/brand/logo-on-dark.svg")));
  });

  it("ningún SVG contiene scripts ni referencias externas", () => {
    for (const file of ["public/brand/logo-on-dark.svg", "public/brand/logo-on-light.svg", "src/app/icon.svg"]) {
      expect(read(file), file).not.toMatch(/<script|onload=|javascript:|<foreignObject|href="http/i);
    }
  });

  it("favicon: icon.svg cuadrado y sin favicon.ico antiguo", () => {
    const [, , w, h] = (viewBox(read("src/app/icon.svg")) ?? "").split(" ");
    expect(w).toBe(h);
    expect(existsSync(path.join(ROOT, "src/app/favicon.ico"))).toBe(false);
  });
});

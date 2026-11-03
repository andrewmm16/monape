import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(import.meta.dirname, "../../src");
const PALETTE =
  /\b(?:bg|text|border|ring|from|to|via|fill|stroke|outline|divide)-(?:blue|slate|gray|zinc|emerald|green|red|amber|yellow|sky|indigo|violet|orange|rose|neutral|stone|cyan|teal|lime|purple|pink|fuchsia)-\d{2,3}\b/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

describe("tema", () => {
  it("las pantallas usan tokens del tema, no colores de la paleta de Tailwind", () => {
    const uiKit = path.join(SRC, "components", "ui") + path.sep;
    const hits = walk(SRC)
      .filter((file) => !file.startsWith(uiKit))
      .flatMap((file) =>
        readFileSync(file, "utf8")
          .split("\n")
          .flatMap((line, index) => (PALETTE.test(line) ? [`${path.relative(SRC, file)}:${index + 1}  ${line.trim()}`] : [])),
      );
    expect(hits).toEqual([]);
  });

  it("el verde neón (bg-primary) solo rellena controles con texto oscuro, no barras ni indicadores", () => {
    // En modo día #1FF287 sobre claro no llega a 3:1: las barras usan bg-brand.
    const permitidos = ["button.tsx", "badge.tsx", "checkbox.tsx", "native-select.tsx"].map((name) => path.join(SRC, "components", "ui", name));
    const hits = walk(SRC)
      .filter((file) => !permitidos.includes(file))
      .flatMap((file) =>
        readFileSync(file, "utf8")
          .split("\n")
          .flatMap((line, index) => (/(?<![\w-])bg-primary(?:\/\d+)?(?![\w-])/.test(line) ? [`${path.relative(SRC, file)}:${index + 1}`] : [])),
      );
    expect(hits).toEqual([]);
  });
});

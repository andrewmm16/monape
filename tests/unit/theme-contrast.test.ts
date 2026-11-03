import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.resolve(import.meta.dirname, "../../src/app/globals.css"), "utf8");

/** Variables `--nombre: #rrggbb` del primer bloque que empieza con `selector {`. */
function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`No existe el bloque ${selector}`);
  const body = css.slice(start, css.indexOf("\n}", start));
  const out: Record<string, string> = {};
  for (const match of body.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\b/g)) out[match[1]] = match[2];
  return out;
}

function luminance(hex: string): number {
  const channel = (i: number) => {
    const value = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT_PAIRS: Array<[string, string]> = [
  ["foreground", "background"],
  ["card-foreground", "card"],
  ["popover-foreground", "popover"],
  ["primary-foreground", "primary"],
  ["secondary-foreground", "secondary"],
  ["accent-foreground", "accent"],
  ["muted-foreground", "background"],
  ["muted-foreground", "card"],
  ["destructive-foreground", "destructive"],
  ["destructive", "background"],
  ["brand", "background"],
  ["brand", "card"],
  ["brand", "accent"],
  ["sidebar-foreground", "sidebar"],
  ["sidebar-primary-foreground", "sidebar-primary"],
  ["sidebar-accent-foreground", "sidebar-accent"],
  ["success-foreground", "success"],
  ["warning-foreground", "warning"],
  ["info-foreground", "info"],
  ["attention-foreground", "attention"],
  ["danger-foreground", "danger"],
];
const CONTROL_PAIRS: Array<[string, string]> = [
  ["input", "card"],
  ["input", "background"],
  ["ring", "card"],
  ["ring", "background"],
  ["sidebar-ring", "sidebar"],
];

describe.each([
  ["día", ":root"],
  ["noche", ".dark"],
])("contraste del modo %s", (_name, selector) => {
  const t = tokens(selector);

  it.each(TEXT_PAIRS)("texto %s sobre %s ≥ 4,5:1", (fg, bg) => {
    expect(t[fg], `falta --${fg}`).toBeDefined();
    expect(t[bg], `falta --${bg}`).toBeDefined();
    expect(contrast(t[fg], t[bg])).toBeGreaterThanOrEqual(4.5);
  });

  it.each(CONTROL_PAIRS)("contorno %s sobre %s ≥ 3:1", (fg, bg) => {
    expect(t[fg], `falta --${fg}`).toBeDefined();
    expect(t[bg], `falta --${bg}`).toBeDefined();
    expect(contrast(t[fg], t[bg])).toBeGreaterThanOrEqual(3);
  });

  it("la barra lateral es oscura", () => {
    expect(luminance(t.sidebar)).toBeLessThan(0.05);
  });
});

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "../..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|html)$/.test(name)) out.push(full);
  }
  return out;
}

describe("nombre de la marca", () => {
  it("ningún texto visible escribe «Interruptivo» (la marca es «Iterruptivo»)", () => {
    const files = [
      ...walk(path.join(ROOT, "src")),
      ...walk(path.join(ROOT, "supabase", "templates")),
      path.join(ROOT, "README.md"),
      path.join(ROOT, ".env.example"),
      path.join(ROOT, "docs", "roles-y-permisos.txt"),
    ];
    const hits = files.filter((file) => /interruptivo/i.test(readFileSync(file, "utf8"))).map((f) => path.relative(ROOT, f));
    // supabase/config.toml: se ignora `project_id` (identificador interno de contenedores).
    const config = readFileSync(path.join(ROOT, "supabase", "config.toml"), "utf8")
      .split("\n")
      .filter((line) => !line.startsWith("project_id"));
    if (config.some((line) => /interruptivo/i.test(line))) hits.push("supabase/config.toml");
    expect(hits).toEqual([]);
  });
});

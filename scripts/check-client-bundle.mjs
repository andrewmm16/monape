/**
 * Verifica que ningún secreto del servidor llegue al código del navegador.
 *
 * Uso (después de `next build` con las mismas variables de entorno):
 *   npm run test:secrets
 *
 * Busca en .next/static (lo único que se descarga al navegador):
 *  - el VALOR de cada variable secreta presente en el entorno;
 *  - el NOMBRE de las variables secretas (indicaría código de servidor
 *    importado por error en un componente de cliente).
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import path from "node:path";

const SECRET_VARIABLES = [
  "SUPABASE_SECRET_KEY",
  "AI_API_KEY",
  "RESEND_API_KEY",
  "SEED_USER_PASSWORD",
  "TALENT_APPLY_SECRET",
  "TALENT_FEED_TOKEN",
  "INTAKE_HASH_SECRET",
];
const STATIC_DIR = path.resolve(".next", "static");

if (!existsSync(STATIC_DIR)) {
  console.error("No existe .next/static. Ejecute `next build` antes de esta verificación.");
  process.exit(2);
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else yield full;
  }
}

const needles = [];
for (const name of SECRET_VARIABLES) {
  needles.push({ label: `nombre de la variable ${name}`, value: name });
  const value = process.env[name];
  if (value && value.length >= 12) needles.push({ label: `valor de ${name}`, value });
}

const checkedValues = needles.filter((n) => n.label.startsWith("valor")).length;
if (checkedValues === 0) {
  console.warn("Aviso: no hay valores secretos en el entorno; solo se verificarán los nombres de variables.");
}

const findings = [];
let files = 0;
for (const file of walk(STATIC_DIR)) {
  files++;
  const content = readFileSync(file, "utf8");
  for (const needle of needles) {
    if (content.includes(needle.value)) findings.push(`${needle.label} en ${path.relative(process.cwd(), file)}`);
  }
}

if (findings.length > 0) {
  console.error("FALLO: se encontraron secretos en el código del navegador:");
  for (const finding of findings) console.error(`  - ${finding}`);
  process.exit(1);
}
console.log(`OK: ${files} archivos del navegador revisados; ${needles.length} patrones sin coincidencias (${checkedValues} valores secretos).`);

/**
 * Busca URLs de CVs PDF públicos en Google con dorks por vacante.
 *
 * Correr desde una terminal normal (PowerShell/Bash), NO desde Claude Code
 * (el sandbox bloquea las llamadas a Google).
 *
 * Uso:
 *   node scripts/caleta/buscar-cvs-google.mjs                  # las 3 vacantes
 *   node scripts/caleta/buscar-cvs-google.mjs --vacante=civil  # solo una
 *   node scripts/caleta/buscar-cvs-google.mjs --out=urls.json  # otro destino
 *
 * Genera: scripts/caleta/salida/urls-cvs.json con las URLs encontradas.
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, 'salida');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

// Queries que solo buscan por TÍTULO del puesto + señales de que es un CV.
// NO se filtran requisitos técnicos aquí (esa evaluación la hace el motor de
// afinidad en la app cuando el CV completo esté en caleta_prospects).
const VACANTES = {
  civil: {
    title: 'Ingeniero Civil (Junior)',
    dorks: [
      'filetype:pdf "Curriculum Vitae" "Ingeniero Civil" Lima',
      'filetype:pdf "CV" "Ingeniero Civil" Lima',
      'filetype:pdf "hoja de vida" "Ingeniero Civil" Lima',
      'filetype:pdf "Curriculum Vitae" "Ingeniero Civil" Perú',
      'filetype:pdf "Ingeniero Civil" celular Lima',
      'filetype:pdf "Ingeniero Civil" @gmail.com Lima',
      'filetype:pdf "Ing. Civil" Lima',
      'filetype:pdf "Ingeniero Civil" egresado Lima',
    ],
  },
  sanitario: {
    title: 'Ingeniero Sanitario',
    dorks: [
      'filetype:pdf "Curriculum Vitae" "Ingeniero Sanitario" Lima',
      'filetype:pdf "CV" "Ingeniero Sanitario" Lima',
      'filetype:pdf "hoja de vida" "Ingeniero Sanitario" Lima',
      'filetype:pdf "Curriculum Vitae" "Ingeniero Sanitario" Perú',
      'filetype:pdf "Ingeniero Sanitario" celular Lima',
      'filetype:pdf "Ingeniero Sanitario" @gmail.com Lima',
      'filetype:pdf "Ing. Sanitario" Lima',
      'filetype:pdf "Ingeniería Sanitaria" egresado Lima',
    ],
  },
  electromec: {
    title: 'Ingeniero Electromecánico',
    dorks: [
      'filetype:pdf "Curriculum Vitae" "Ingeniero Electromecánico" Lima',
      'filetype:pdf "CV" "Ingeniero Electromecánico" Lima',
      'filetype:pdf "Curriculum Vitae" "Mecánico Electricista" Lima',
      'filetype:pdf "CV" "Mecánico Electricista" Lima',
      'filetype:pdf "hoja de vida" "Mecánico Electricista" Lima',
      'filetype:pdf "Mecánico Electricista" celular Lima',
      'filetype:pdf "Mecánico Electricista" @gmail.com Lima',
      'filetype:pdf "Ing. Electromecánico" Lima',
    ],
  },
};

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (a, b) => a + Math.random() * (b - a);

async function googleSearch(page, query) {
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=es&gl=pe&num=20`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await pause(jitter(2200, 4500));

  const body = await page.evaluate(() => document.body?.innerText || '');
  if (/unusual traffic|tráfico inusual|not a robot|sorry\/index/i.test(body)) {
    return { bloqueado: true, urls: [] };
  }

  const urls = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('a[href]').forEach((a) => {
      let href = a.href;
      if (/^https?:\/\/[^/]*google\.(com|com\.pe)\/url\?/.test(href)) {
        try {
          const u = new URL(href);
          const q = u.searchParams.get('q');
          if (q) href = q;
        } catch {}
      }
      if (/\.pdf(\?|$)/i.test(href) && !href.includes('google.com')) {
        out.push(href);
      }
    });
    return [...new Set(out)];
  });

  return { bloqueado: false, urls };
}

async function duckSearch(page, query) {
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=pe-es`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await pause(jitter(2200, 4500));

  const body = await page.evaluate(() => document.body?.innerText || '');
  if (/anomaly detected|blocked/i.test(body)) {
    return { bloqueado: true, urls: [] };
  }

  const urls = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('a[href]').forEach((a) => {
      let href = a.href;
      const m = href.match(/uddg=([^&]+)/);
      if (m) { try { href = decodeURIComponent(m[1]); } catch {} }
      if (/\.pdf(\?|$)/i.test(href) && !href.includes('duckduckgo.com')) {
        out.push(href);
      }
    });
    return [...new Set(out)];
  });

  return { bloqueado: false, urls };
}

async function main() {
  const argVac = process.argv.find((a) => a.startsWith('--vacante='))?.split('=')[1];
  const outArg = process.argv.find((a) => a.startsWith('--out='))?.split('=')[1];
  const objetivos = argVac ? [argVac] : Object.keys(VACANTES);

  console.log('Vacantes a procesar:', objetivos.join(', '));

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: UA,
    viewport: { width: 1366, height: 820 },
    locale: 'es-PE',
  });
  const page = await context.newPage();

  const resultado = {};

  for (const key of objetivos) {
    const vac = VACANTES[key];
    console.log(`\n========== ${vac.title} (${key}) ==========`);
    const urlsPorVacante = new Set();

    for (const q of vac.dorks) {
      console.log(`[Q] ${q}`);
      let r = await googleSearch(page, q);
      if (r.bloqueado) {
        console.log('  ⚠️ Google bloqueó. Pausa 60s y reintento con DuckDuckGo.');
        await pause(60000);
        r = await duckSearch(page, q);
        if (r.bloqueado) {
          console.log('  ⚠️ DDG también bloqueó. Salto esta query.');
          continue;
        }
      }
      console.log(`  → ${r.urls.length} PDFs nuevos encontrados`);
      r.urls.forEach((u) => urlsPorVacante.add(u));
      console.log(`  acumulado para ${key}: ${urlsPorVacante.size}`);
      await pause(jitter(8000, 15000));
    }

    resultado[key] = {
      titulo: vac.title,
      urls: [...urlsPorVacante],
    };
  }

  const outPath = outArg ? path.resolve(outArg) : path.join(OUT_DIR, 'urls-cvs.json');
  fs.writeFileSync(outPath, JSON.stringify(resultado, null, 2));

  console.log('\n========== RESUMEN ==========');
  for (const [k, v] of Object.entries(resultado)) {
    console.log(`${v.titulo}: ${v.urls.length} URLs`);
  }
  console.log(`\n→ Guardado: ${outPath}`);
  console.log('\nSiguiente paso: pasa este archivo al script de procesamiento.');

  await browser.close();
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});

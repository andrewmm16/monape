/**
 * Recolector automático de prospectos para las 3 vacantes de Caleta.
 *
 * Flujo:
 *   1. Playwright + Chromium real (no axios) para evadir anti-bot básico.
 *   2. Bing X-Ray a `site:pe.linkedin.com/in` con los keywords de cada vacante.
 *      Fallback automático a DuckDuckGo HTML si Bing se corta.
 *   3. Para cada perfil: extraer URL + nombre + cargo + empresa + ubicación.
 *   4. Enriquecer contacto con buscador CIP + Bing dorks por "nombre + celular"
 *      y "nombre + @" + inferencia de correo corporativo por dominio.
 *   5. Scoring preliminar contra las keywords de `vacancy_requirements`.
 *   6. Exportar CSV + JSON compatible con `prospectCreateSchema` de Caleta.
 *
 * Uso: node scripts/caleta/recolector-caleta.mjs [--vacante civil|sanitario|electromec]
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Carpeta ignorada por git (.gitignore: /scripts/caleta/salida/).
const OUT_DIR = path.join(__dirname, 'salida');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

// Vacantes replicadas exactamente desde scripts/seed-caleta-vacantes.ts
// (mantener sincronizado si cambian los requirements).
const VACANTES = {
  civil: {
    title: 'Ingeniero Civil (Junior)',
    minYears: 1, maxYears: 4,
    queries: [
      'site:pe.linkedin.com/in "Ingeniero Civil" Lima',
      'site:linkedin.com/in "Ingeniero Civil" Lima AutoCAD',
      'site:linkedin.com/in "Ingeniero Civil" Lima ETABS',
      'site:linkedin.com/in "Ingeniero Civil" Lima "diseño estructural"',
      'site:linkedin.com/in "Ingeniero Civil" Lima "supervisión de obra"',
      'site:linkedin.com/in "Ingeniero Civil" Junior Lima',
      'site:linkedin.com/in "Ingeniero Civil" Lima SAP2000',
      'site:linkedin.com/in "Ingeniero Civil" Lima Revit'
    ],
    requirements: [
      { desc: 'Ingeniería Civil', keywords: ['Ingeniería Civil','Ingeniero Civil','Ing. Civil'], weight: 3, essential: true },
      { desc: 'Diseño/supervisión estructural', keywords: ['diseño estructural','cálculo estructural','supervisión de obra','estructuras'], weight: 4, essential: true, minYears: 1 },
      { desc: 'AutoCAD', keywords: ['AutoCAD'], weight: 3, essential: true },
      { desc: 'Revit', keywords: ['Revit'], weight: 2 },
      { desc: 'ETABS/SAP2000', keywords: ['ETABS','SAP2000','SAP 2000'], weight: 2 },
      { desc: 'S10', keywords: ['S10'], weight: 1 }
    ]
  },
  sanitario: {
    title: 'Ingeniero Sanitario',
    minYears: 2, maxYears: 5,
    queries: [
      'site:pe.linkedin.com/in "Ingeniero Sanitario" Lima',
      'site:linkedin.com/in "Ingeniero Sanitario" Lima',
      'site:linkedin.com/in "Ingeniería Sanitaria" Lima',
      'site:linkedin.com/in "Ingeniero Sanitario" instalaciones',
      'site:linkedin.com/in "Ingeniero Sanitario" SEDAPAL',
      'site:linkedin.com/in "Ingeniero Sanitario" AutoCAD',
      'site:linkedin.com/in "Ingeniero Sanitario" ACI',
      'site:linkedin.com/in "Ing. Sanitario" Lima'
    ],
    requirements: [
      { desc: 'Ingeniería Sanitaria', keywords: ['Ingeniería Sanitaria','Ingeniero Sanitario','Ing. Sanitario'], weight: 3, essential: true },
      { desc: 'Instalaciones sanitarias', keywords: ['instalaciones sanitarias','diseño sanitario','sanitarias'], weight: 4, essential: true, minYears: 2 },
      { desc: 'Agua, desagüe, ACI, cisternas', keywords: ['agua contra incendio','ACI','desagüe','cisterna','redes de agua'], weight: 3, essential: true },
      { desc: 'AutoCAD', keywords: ['AutoCAD'], weight: 3, essential: true },
      { desc: 'Revit MEP', keywords: ['Revit MEP','Revit'], weight: 2 },
      { desc: 'SEDAPAL', keywords: ['SEDAPAL'], weight: 2 }
    ]
  },
  electromec: {
    title: 'Ingeniero Electromecánico',
    minYears: 2, maxYears: 5,
    queries: [
      'site:pe.linkedin.com/in "Ingeniero Electromecánico" Lima',
      'site:linkedin.com/in "Mecánico Electricista" Lima',
      'site:linkedin.com/in "Ingeniero Electromecánico" Lima',
      'site:linkedin.com/in "Mecánico Electricista" subestaciones',
      'site:linkedin.com/in "Ingeniero Electromecánico" AutoCAD',
      'site:linkedin.com/in "Mecánico Electricista" DIALux',
      'site:linkedin.com/in "Mecánico Electricista" "Luz del Sur"',
      'site:linkedin.com/in "Mecánico Electricista" Enel Lima'
    ],
    requirements: [
      { desc: 'Formación electromecánica', keywords: ['Electromecánico','Electromecánica','Mecánico Electricista','Mecánica Eléctrica'], weight: 3, essential: true },
      { desc: 'Instalaciones eléctricas/mecánicas', keywords: ['instalaciones eléctricas','instalaciones mecánicas','diseño eléctrico'], weight: 4, essential: true, minYears: 2 },
      { desc: 'Media/baja tensión, subestaciones, tableros, ventilación', keywords: ['media tensión','baja tensión','subestaciones','tableros eléctricos','ventilación'], weight: 3, essential: true },
      { desc: 'AutoCAD', keywords: ['AutoCAD'], weight: 3, essential: true },
      { desc: 'Revit MEP', keywords: ['Revit MEP','Revit'], weight: 2 },
      { desc: 'DIALux', keywords: ['DIALux'], weight: 2 },
      { desc: 'Luz del Sur / Pluz / Enel', keywords: ['Luz del Sur','Pluz','Enel'], weight: 1 }
    ]
  }
};

const norm = s => (s||'').toUpperCase()
  .replace(/Á/g,'A').replace(/É/g,'E').replace(/Í/g,'I').replace(/Ó/g,'O').replace(/Ú/g,'U').replace(/Ñ/g,'N');

function detectaAnios(texto) {
  const t = norm(texto);
  const m = t.match(/(\d{1,2})\+?\s*(ANOS|ANIOS|YEARS)/);
  if (m) return parseInt(m[1], 10);
  return null;
}

function score(snippet, requirements) {
  const t = norm(snippet);
  let got = 0, max = 0;
  const matched = [];
  for (const r of requirements) {
    max += r.weight;
    for (const k of r.keywords) {
      if (t.includes(norm(k))) {
        got += r.weight;
        matched.push(r.desc);
        break;
      }
    }
  }
  return { score: max ? Math.round(100 * got / max) : 0, matched };
}

async function pause(ms) { return new Promise(r => setTimeout(r, ms)); }
function jitter(a, b) { return a + Math.random() * (b - a); }

async function ddgSearch(page, query) {
  let bloqueado = false;
  // DuckDuckGo HTML (sin JS): más tolerante, acepta site:
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=pe-es`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await pause(jitter(1800, 3300));
  const bloq = await page.evaluate(() => {
    const t = document.body?.innerText || '';
    return /anomaly detected|blocked|unusual/i.test(t);
  });
  if (bloq) return { bloqueado: true, hits: [] };

  const hits = await page.evaluate(() => {
    const out = [];
    const nodes = document.querySelectorAll('.result, .results_links, .result__body');
    nodes.forEach(n => {
      const a = n.querySelector('a.result__a, h2 a');
      const snip = n.querySelector('.result__snippet, .result__description');
      if (!a) return;
      let url = a.href;
      // DDG envuelve: /l/?uddg=<encoded>
      const m = url.match(/uddg=([^&]+)/);
      if (m) {
        try { url = decodeURIComponent(m[1]); } catch {}
      }
      out.push({
        titulo: a.innerText || a.textContent || '',
        url,
        snippet: (snip?.innerText || snip?.textContent || '').trim()
      });
    });
    return out;
  });
  return { bloqueado, hits };
}

/** DuckDuckGo HTML es la ruta por defecto (destinada a scraping). */
async function search(page, query) {
  const d = await ddgSearch(page, query);
  return { fuente: 'ddg', ...d };
}

function parsearLinkedinHit(hit) {
  // Título tipo: "Nombre Apellido - Cargo - Empresa | LinkedIn"
  // o: "Nombre Apellido – Cargo … LinkedIn · Perú"
  const raw = hit.titulo.replace(/\s*\|\s*LinkedIn.*$/i, '').replace(/·\s*LinkedIn.*$/i, '');
  const partes = raw.split(/\s+[-–—]\s+/);
  const nombre = (partes[0] || '').trim();
  const cargo = (partes[1] || '').trim();
  const empresa = (partes[2] || '').trim();
  // Ubicación suele estar en el snippet
  const ubic = (hit.snippet.match(/(Lima[^.\n·]*|Perú[^.\n·]*)/i) || [])[0] || '';
  return {
    linkedin_url: hit.url,
    nombre,
    cargo,
    empresa,
    ubicacion: ubic.trim(),
    snippet: hit.snippet
  };
}

async function enriquecerContacto(page, persona) {
  // Buscar CIP + teléfono/correo con dorks
  const dorks = [
    `"${persona.nombre}" CIP ingeniero`,
    `"${persona.nombre}" celular OR WhatsApp`,
    `"${persona.nombre}" @gmail.com OR @hotmail.com OR @outlook.com`
  ];
  const resultado = { telefono: null, correo: null, cip: null, fuentes: [] };
  for (const q of dorks) {
    const { bloqueado, hits } = await search(page, q);
    if (bloqueado) break;
    for (const h of hits.slice(0, 5)) {
      const txt = `${h.titulo} ${h.snippet}`;
      // Teléfono peruano: 9XXXXXXXX (9 dígitos empezando con 9)
      if (!resultado.telefono) {
        const tel = txt.match(/\b9\d{8}\b/);
        if (tel) { resultado.telefono = tel[0]; resultado.fuentes.push(`tel:${h.url}`); }
      }
      // Correo
      if (!resultado.correo) {
        const mail = txt.match(/[A-Za-z0-9._%+-]+@(?:gmail|hotmail|outlook|yahoo|live)\.com/);
        if (mail) { resultado.correo = mail[0]; resultado.fuentes.push(`mail:${h.url}`); }
      }
      // CIP
      if (!resultado.cip) {
        const cip = txt.match(/CIP\s*N?[°º]?\s*(\d{3,6})/i);
        if (cip) { resultado.cip = cip[1]; resultado.fuentes.push(`cip:${h.url}`); }
      }
    }
    await pause(jitter(2500, 4500));
  }
  return resultado;
}

async function main() {
  const argVac = process.argv.find(a => a.startsWith('--vacante='))?.split('=')[1];
  const objetivos = argVac ? [argVac] : Object.keys(VACANTES);

  console.log('Vacantes a procesar:', objetivos.join(', '));

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: UA,
    viewport: { width: 1366, height: 820 },
    locale: 'es-PE',
    timezoneId: 'America/Lima'
  });
  const page = await context.newPage();

  const resultadoGlobal = {};

  for (const key of objetivos) {
    const vac = VACANTES[key];
    console.log(`\n========== ${vac.title} (${key}) ==========`);
    const perfiles = new Map(); // url → persona

    // Fase 1: barrer queries (Google primero, DDG fallback)
    for (const q of vac.queries) {
      console.log(`[Q] ${q}`);
      const { bloqueado, hits, fuente } = await search(page, q);
      console.log(`  fuente=${fuente} hits=${hits.length} bloqueado=${bloqueado}`);
      if (bloqueado) {
        console.log('  ⚠️ Bloqueado. Pausa 60s.');
        await pause(60000);
      }
      hits.forEach(h => procesarHit(h, perfiles));
      console.log(`  encontrados hasta ahora: ${perfiles.size}`);
      await pause(jitter(4500, 7500));
    }

    // Fase 2: scoring y enriquecimiento (solo top candidatos para no colgar al usuario)
    const todos = [...perfiles.values()].map(p => {
      const s = score(`${p.cargo} ${p.empresa} ${p.snippet}`, vac.requirements);
      const anios = detectaAnios(`${p.cargo} ${p.empresa} ${p.snippet}`);
      let rangoFit = 'desconocido';
      if (anios !== null) {
        if (anios < vac.minYears) rangoFit = 'bajo-rango';
        else if (anios > vac.maxYears) rangoFit = 'sobre-rango';
        else rangoFit = 'en-rango';
      }
      return { ...p, score: s.score, matched: s.matched, aniosDetectados: anios, rangoFit };
    });
    todos.sort((a, b) => b.score - a.score);
    console.log(`\n[${key}] Total únicos: ${todos.length}. Enriqueciendo top 25...`);

    const topN = todos.slice(0, 15);
    for (let i = 0; i < topN.length; i++) {
      const p = topN[i];
      if (!p.nombre || p.nombre.length < 4) continue;
      process.stdout.write(`  ${i+1}/${topN.length} ${p.nombre}... `);
      const extra = await enriquecerContacto(page, p);
      Object.assign(p, extra);
      // Correo corporativo inferido si tenemos empresa
      if (!p.correo && p.empresa) {
        const dominio = p.empresa.toLowerCase()
          .replace(/s\.a\.c\.?|s\.a\.|e\.i\.r\.l\.?|s\.r\.l\.?|ltda/g, '')
          .replace(/[^\w]/g, '').trim();
        if (dominio.length >= 3) {
          const slug = norm(p.nombre).toLowerCase().split(/\s+/);
          const nombreSimple = slug[0]?.toLowerCase();
          const apeSimple = slug[slug.length - 1]?.toLowerCase();
          if (nombreSimple && apeSimple) p.correoInferido = `${nombreSimple}.${apeSimple}@${dominio}.com`;
        }
      }
      console.log(`tel=${p.telefono||'-'} mail=${p.correo||'-'} cip=${p.cip||'-'}`);
      await pause(jitter(2000, 4500));
    }

    resultadoGlobal[key] = todos;

    // Exportar CSV + JSON por vacante
    const cabecera = ['nombre','cargo','empresa','ubicacion','linkedin_url','anios','rango_fit','score','telefono','correo','correo_inferido','cip','matched','snippet'];
    const csv = [cabecera.join(',')];
    for (const p of todos) {
      const row = [
        p.nombre, p.cargo, p.empresa, p.ubicacion, p.linkedin_url,
        p.aniosDetectados ?? '', p.rangoFit, p.score,
        p.telefono || '', p.correo || '', p.correoInferido || '', p.cip || '',
        (p.matched || []).join(';'), (p.snippet||'').replace(/\s+/g, ' ')
      ].map(c => {
        const s = String(c ?? '');
        return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
      });
      csv.push(row.join(','));
    }
    fs.writeFileSync(path.join(OUT_DIR, `caleta_${key}.csv`), csv.join('\n'), 'utf8');
    fs.writeFileSync(path.join(OUT_DIR, `caleta_${key}.json`), JSON.stringify(todos, null, 2));
    console.log(`\n→ Guardado caleta_${key}.csv (${todos.length} filas) y caleta_${key}.json`);
  }

  // Resumen global
  console.log('\n========== RESUMEN ==========');
  for (const [k, arr] of Object.entries(resultadoGlobal)) {
    const conTel = arr.filter(p => p.telefono).length;
    const conMail = arr.filter(p => p.correo || p.correoInferido).length;
    const enRango = arr.filter(p => p.rangoFit === 'en-rango').length;
    console.log(`${VACANTES[k].title}: total=${arr.length} con_tel=${conTel} con_mail=${conMail} en-rango=${enRango}`);
  }

  // JSON compatible con prospectCreateSchema de Caleta (sin vacancyId; lo asignas al importar)
  const importJson = [];
  for (const [k, arr] of Object.entries(resultadoGlobal)) {
    for (const p of arr.filter(x => x.nombre && x.linkedin_url && x.score >= 25)) {
      importJson.push({
        vacante: VACANTES[k].title,
        fullName: p.nombre,
        headline: [p.cargo, p.empresa].filter(Boolean).join(' — '),
        location: p.ubicacion || 'Lima, Perú',
        linkedinUrl: p.linkedin_url,
        source: 'linkedin',
        sourceDetail: 'recolector Playwright Bing X-Ray',
        profileText: [
          p.cargo, p.empresa, p.ubicacion, p.snippet,
          p.cip ? `CIP ${p.cip}` : '',
          p.telefono ? `Celular: ${p.telefono}` : '',
          p.correo ? `Correo: ${p.correo}` : (p.correoInferido ? `Correo inferido: ${p.correoInferido}` : '')
        ].filter(Boolean).join('. '),
        email: p.correo || null,
        phone: p.telefono || null,
        scorePre: p.score,
        rangoFit: p.rangoFit,
        matchedRequisitos: p.matched
      });
    }
  }
  fs.writeFileSync(path.join(OUT_DIR, 'caleta_prospects_import.json'), JSON.stringify(importJson, null, 2));
  console.log(`\nImport global: ${importJson.length} prospectos con score ≥ 25 en ${path.join(OUT_DIR, 'caleta_prospects_import.json')}`);

  await browser.close();
}

function procesarHit(hit, perfiles) {
  if (!/^https?:\/\/[^/]*linkedin\.com\/in\//i.test(hit.url)) return;
  const persona = parsearLinkedinHit(hit);
  const urlLimpia = persona.linkedin_url.split('?')[0].replace(/\/$/, '');
  if (!perfiles.has(urlLimpia)) {
    persona.linkedin_url = urlLimpia;
    perfiles.set(urlLimpia, persona);
  } else {
    // Mejor snippet
    const existente = perfiles.get(urlLimpia);
    if ((hit.snippet || '').length > (existente.snippet || '').length) {
      existente.snippet = hit.snippet;
    }
  }
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });

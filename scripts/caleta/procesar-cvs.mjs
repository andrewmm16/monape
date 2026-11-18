/**
 * Procesa las URLs de CVs PDF encontradas por `buscar-cvs-google.mjs`:
 * descarga cada PDF, extrae texto, parsea nombre + teléfono + correo +
 * LinkedIn URL, filtra por perfil de la vacante y lo inserta en
 * `caleta_prospects` (idempotente).
 *
 * Uso:
 *   node scripts/caleta/procesar-cvs.mjs
 *   node scripts/caleta/procesar-cvs.mjs --input=ruta/urls-cvs.json
 *   node scripts/caleta/procesar-cvs.mjs --vacante=civil
 *   node scripts/caleta/procesar-cvs.mjs --dry   # solo analiza, no inserta
 *
 * Requiere:
 *   - pdftotext en el PATH (incluido en Git for Windows: C:\Program Files\Git\mingw64\bin)
 *   - .env.local con NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SECRET_KEY
 *   - scripts/caleta/salida/urls-cvs.json (del paso anterior)
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SALIDA = path.join(__dirname, 'salida');
const PDFS = path.join(SALIDA, 'pdfs');
if (!fs.existsSync(PDFS)) fs.mkdirSync(PDFS, { recursive: true });

const inputArg = process.argv.find((a) => a.startsWith('--input='))?.split('=')[1];
const vacanteArg = process.argv.find((a) => a.startsWith('--vacante='))?.split('=')[1];
const dry = process.argv.includes('--dry');

const urlsPath = inputArg ? path.resolve(inputArg) : path.join(SALIDA, 'urls-cvs.json');
if (!fs.existsSync(urlsPath)) {
  console.error(`✖ No existe ${urlsPath}. Corre primero buscar-cvs-google.mjs.`);
  process.exit(1);
}
const urlsData = JSON.parse(fs.readFileSync(urlsPath, 'utf8'));
const objetivos = vacanteArg ? [vacanteArg] : Object.keys(urlsData);
console.log(`Procesando vacantes: ${objetivos.join(', ')}`);

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY;
let supabase = null;
if (!dry) {
  if (!supabaseUrl || !supabaseKey) {
    console.error('✖ Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SECRET_KEY. Usa --dry o configura .env.local');
    process.exit(1);
  }
  supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/129.0.0.0 Safari/537.36';

const TITULO_VACANTE = {
  civil: 'Ingeniero Civil (Junior)',
  sanitario: 'Ingeniero Sanitario',
  electromec: 'Ingeniero Electromecánico',
};

const FILTRO_PERFIL = {
  civil: /ingenier[íi]a?\s+civil|\bing\.?\s*civil\b/i,
  sanitario: /ingenier[íi]a?\s+sanitaria|\bing\.?\s*sanitario\b/i,
  electromec: /electromec[áa]nic|mec[áa]nic[oa]\s+electricista|mec[áa]nica\s+el[éa]ctrica/i,
};

const PDFTOTEXT_CANDIDATES = [
  'pdftotext',
  'C:\\Program Files\\Git\\mingw64\\bin\\pdftotext.exe',
  'C:\\Program Files (x86)\\Git\\mingw64\\bin\\pdftotext.exe',
];

function pdfToText(pdfPath) {
  for (const bin of PDFTOTEXT_CANDIDATES) {
    try {
      return execFileSync(bin, ['-layout', pdfPath, '-'], {
        encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
      });
    } catch {}
  }
  throw new Error('pdftotext no disponible; instala Poppler o Git for Windows.');
}

async function descargarPDF(url) {
  const hash = crypto.createHash('sha256').update(url).digest('hex').slice(0, 16);
  const nombre = `${hash}.pdf`;
  const destino = path.join(PDFS, nombre);
  if (fs.existsSync(destino) && fs.statSync(destino).size > 1024) return destino;
  const r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(45000) });
  const data = r.status === 200 ? new Uint8Array(await r.arrayBuffer()) : null;
  if (!data || data.byteLength < 1024) {
    throw new Error(`HTTP ${r.status} tamaño=${data?.byteLength}`);
  }
  fs.writeFileSync(destino, Buffer.from(data));
  return destino;
}

const RE_TEL = /(?:\+51[ -]?)?(?:\(?51\)?[ -]?)?9\d{2}[ -]?\d{3}[ -]?\d{3}\b/g;
const RE_MAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const RE_LINKEDIN = /(?:https?:\/\/)?(?:[\w-]+\.)?linkedin\.com\/in\/[\w%-]+/i;

function limpiarTel(raw) {
  const digits = raw.replace(/\D/g, '');
  if (digits.length >= 9 && digits.startsWith('9')) return digits.slice(0, 9);
  if (digits.length >= 11 && digits.startsWith('51') && digits[2] === '9') return digits.slice(2, 11);
  return null;
}

function extraerNombre(texto) {
  const lineas = texto.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 20);
  // Candidato 1: línea en MAYÚSCULAS con 2-5 palabras
  for (const l of lineas) {
    const letras = l.replace(/[^A-ZÁÉÍÓÚÑ ]/g, '').trim();
    if (letras === l.toUpperCase() && letras.split(/\s+/).length >= 2 && letras.split(/\s+/).length <= 5 && letras.length >= 8 && letras.length <= 80) {
      return limpiarNombre(letras);
    }
  }
  // Candidato 2: primera línea con 2-5 palabras title case
  for (const l of lineas) {
    const palabras = l.split(/\s+/);
    if (palabras.length >= 2 && palabras.length <= 5 && palabras.every((p) => /^[A-ZÁÉÍÓÚÑ][a-záéíóúñü]/.test(p))) {
      return limpiarNombre(l);
    }
  }
  return null;
}

function limpiarNombre(s) {
  return s.replace(/\s+/g, ' ').trim()
    .replace(/\b(CV|CURRICULUM|VITAE|HOJA|DE|VIDA|PERFIL|PROFESIONAL)\b/gi, '')
    .replace(/\s+/g, ' ').trim();
}

function extraerDatos(texto) {
  const telMatches = [...texto.matchAll(RE_TEL)].map((m) => limpiarTel(m[0])).filter(Boolean);
  const telefono = telMatches[0] || null;
  const mails = [...texto.matchAll(RE_MAIL)]
    .map((m) => m[0])
    .filter((m) => !/noreply|example|@sentry|@google|@facebook/i.test(m));
  const correo = mails[0] || null;
  const linkedin = (texto.match(RE_LINKEDIN) || [])[0] || null;
  const nombre = extraerNombre(texto);
  return { nombre, telefono, correo, linkedin };
}

async function resolverVacancyId(titulo) {
  if (!supabase) return 'dry-mock-id';
  const { data, error } = await supabase
    .from('vacancies')
    .select('id')
    .eq('title', titulo)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`Vacante «${titulo}» no existe. Corre db:seed:caleta.`);
  return data.id;
}

async function yaExiste(vacancyId, { linkedin, correo, telefono, nombre }) {
  if (!supabase) return false;
  // Clave primaria lógica: linkedin_url. Fallback: email o phone o nombre normalizado.
  const checks = [];
  if (linkedin) checks.push(supabase.from('caleta_prospects').select('id').eq('vacancy_id', vacancyId).eq('linkedin_url', linkedin).limit(1).maybeSingle());
  if (correo) checks.push(supabase.from('caleta_prospects').select('id').eq('vacancy_id', vacancyId).eq('email', correo).limit(1).maybeSingle());
  if (telefono) checks.push(supabase.from('caleta_prospects').select('id').eq('vacancy_id', vacancyId).eq('phone', telefono).limit(1).maybeSingle());
  for (const c of checks) {
    const { data } = await c;
    if (data) return true;
  }
  if (nombre) {
    const { data } = await supabase.from('caleta_prospects').select('id, full_name').eq('vacancy_id', vacancyId).ilike('full_name', nombre).limit(1).maybeSingle();
    if (data) return true;
  }
  return false;
}

async function insertar(vacancyId, perfil, url, texto) {
  if (!supabase) {
    console.log(`  [dry] insertaría: ${perfil.nombre} tel=${perfil.telefono} mail=${perfil.correo}`);
    return;
  }
  const origins = { full_name: 'extraido' };
  if (perfil.correo) origins.email = 'extraido';
  if (perfil.telefono) origins.phone = 'extraido';
  if (perfil.linkedin) origins.linkedin_url = 'extraido';

  const { error } = await supabase.from('caleta_prospects').insert({
    vacancy_id: vacancyId,
    full_name: perfil.nombre,
    headline: null,
    location: /lima|peru|perú/i.test(texto.slice(0, 500)) ? 'Lima, Perú' : null,
    linkedin_url: perfil.linkedin || null,
    source: 'google',
    source_detail: `CV PDF indexado: ${url.slice(0, 180)}`,
    profile_text: texto.slice(0, 200_000),
    email: perfil.correo,
    phone: perfil.telefono,
    field_origins: origins,
    status: 'encontrado',
  });
  if (error) throw new Error(error.message);
}

async function main() {
  const resumen = { procesados: 0, insertados: 0, filtradosFuera: 0, duplicados: 0, errores: 0 };
  const log = [];

  for (const key of objetivos) {
    const bloque = urlsData[key];
    if (!bloque) { console.log(`• Sin datos para ${key}, salto.`); continue; }
    console.log(`\n========== ${bloque.titulo} (${key}) ==========`);
    const titulo = TITULO_VACANTE[key] || bloque.titulo;
    const vacancyId = await resolverVacancyId(titulo);
    const filtro = FILTRO_PERFIL[key];
    if (!filtro) { console.log(`• Sin filtro para ${key}, salto.`); continue; }

    for (const url of bloque.urls) {
      resumen.procesados++;
      try {
        process.stdout.write(`  · ${url.slice(0, 90)}  `);
        const pdfPath = await descargarPDF(url);
        const texto = pdfToText(pdfPath);
        if (!texto || texto.length < 200) throw new Error(`texto muy corto (${texto?.length ?? 0})`);
        if (!filtro.test(texto)) {
          resumen.filtradosFuera++;
          console.log('⏭  no menciona perfil');
          continue;
        }
        const perfil = extraerDatos(texto);
        if (!perfil.nombre || (!perfil.telefono && !perfil.correo)) {
          resumen.filtradosFuera++;
          console.log(`⏭  sin nombre o sin contacto (n=${perfil.nombre?.slice(0,30)||'-'} t=${perfil.telefono||'-'} m=${perfil.correo||'-'})`);
          continue;
        }
        const dup = await yaExiste(vacancyId, { linkedin: perfil.linkedin, correo: perfil.correo, telefono: perfil.telefono, nombre: perfil.nombre });
        if (dup) {
          resumen.duplicados++;
          console.log(`↩  duplicado (${perfil.nombre})`);
          continue;
        }
        await insertar(vacancyId, perfil, url, texto);
        resumen.insertados++;
        console.log(`✔  ${perfil.nombre}  tel=${perfil.telefono||'-'}  mail=${perfil.correo||'-'}`);
        log.push({ vacante: key, url, ...perfil });
      } catch (e) {
        resumen.errores++;
        console.log(`✖  ${e.message}`);
      }
    }
  }

  fs.writeFileSync(path.join(SALIDA, 'procesados.json'), JSON.stringify(log, null, 2));
  console.log('\n========== RESUMEN ==========');
  console.log(JSON.stringify(resumen, null, 2));
  console.log(`Log detallado: ${path.join(SALIDA, 'procesados.json')}`);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });

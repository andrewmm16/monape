/**
 * Ciclo diario de sourcing Caleta: buscar → procesar → puntuar → contactar.
 *
 * Diseñado para programar como tarea diaria (Task Scheduler de Windows, cron,
 * pm2, etc.). Cada corrida:
 *   1. Busca nuevos CVs en Google (y DDG como fallback).
 *   2. Descarga, extrae texto, filtra por perfil, inserta en caleta_prospects.
 *   3. Puntúa los nuevos con el motor de afinidad y descarta los que no pasan
 *      el filtro (indispensables + umbral); solo los aptos siguen a contacto.
 *   4. Envía WhatsApp a los top N por vacante que aún no se contactaron.
 *
 * Uso:
 *   node scripts/caleta/caleta-diario.mjs
 *   node scripts/caleta/caleta-diario.mjs --sin-buscar     # solo procesa, puntúa y contacta
 *   node scripts/caleta/caleta-diario.mjs --sin-contactar  # solo busca, procesa y puntúa
 *   node scripts/caleta/caleta-diario.mjs --dry            # analiza sin escribir ni enviar
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const LOGS_DIR = path.join(__dirname, 'salida', 'logs');
if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });

const sinBuscar = process.argv.includes('--sin-buscar');
const sinContactar = process.argv.includes('--sin-contactar');
const dry = process.argv.includes('--dry');

function ahora() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function correr(args) {
  return new Promise((resolve, reject) => {
    console.log(`\n▶ node ${args.join(' ')}`);
    const child = spawn('node', args, { cwd: ROOT, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`salió con código ${code}`))));
  });
}

async function main() {
  const marca = ahora();
  const logPath = path.join(LOGS_DIR, `${marca}.log`);
  console.log(`[${marca}] Inicio del ciclo diario. Log: ${logPath}`);

  const pasos = [];
  if (!sinBuscar) pasos.push({ nombre: 'buscar', args: ['scripts/caleta/buscar-cvs-google.mjs'] });
  pasos.push({ nombre: 'procesar', args: ['scripts/caleta/procesar-cvs.mjs', ...(dry ? ['--dry'] : [])] });
  // Puntuar es TypeScript y usa el motor de la app (server-only) → tsx + condición react-server.
  pasos.push({
    nombre: 'puntuar',
    args: ['--conditions=react-server', '--import', 'tsx', 'scripts/caleta/puntuar-prospectos.ts', ...(dry ? ['--dry'] : [])],
  });
  if (!sinContactar) pasos.push({ nombre: 'contactar', args: ['scripts/caleta/enviar-whatsapp-caleta.mjs', ...(dry ? ['--dry'] : [])] });

  for (const paso of pasos) {
    try {
      await correr(paso.args);
    } catch (e) {
      console.error(`✖ Falló paso «${paso.nombre}»: ${e.message}`);
      // Sigue con los demás pasos: así, si Google se corta, igual contactas los que ya tienes.
    }
  }

  console.log(`\n[${ahora()}] Ciclo diario finalizado.`);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });

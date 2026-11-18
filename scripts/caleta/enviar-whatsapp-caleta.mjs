/**
 * Envía mensaje de WhatsApp a los top N prospectos de cada vacante.
 *
 * Reglas:
 *   - Solo contacta prospectos con `phone` y `status='encontrado'`.
 *   - Límite configurable por vacante por corrida (default 5).
 *   - Pausas humanas entre envíos (60-90 s, configurable).
 *   - Verifica que el número exista en WhatsApp antes de mandar.
 *   - Actualiza `status='contactado'` y guarda el mensaje enviado en `notes`.
 *
 * Uso:
 *   node scripts/caleta/enviar-whatsapp-caleta.mjs            # las 3 vacantes
 *   node scripts/caleta/enviar-whatsapp-caleta.mjs --vacante="Ingeniero Civil (Junior)"
 *   node scripts/caleta/enviar-whatsapp-caleta.mjs --dry      # no envía nada
 *   node scripts/caleta/enviar-whatsapp-caleta.mjs --limite=3
 *
 * Primera vez: pide QR por consola para vincular la cuenta WhatsApp al script.
 * Recomendado: usar una cuenta WhatsApp distinta a la del bot principal.
 *
 * Variables de entorno:
 *   CALETA_WHATSAPP_DIR        — carpeta de la sesión (default ./.caleta-whatsapp)
 *   CALETA_RECLUTADOR_NOMBRE   — quien firma (default "Pedro Córdova")
 *   CALETA_EMPRESA             — nombre de la empresa (default "nuestra empresa")
 *   CALETA_CONTACTO_RRHH       — dato de contacto que se envía al responder "sí" (opcional)
 *   CALETA_LIMITE_DIARIO       — tope por vacante por corrida (default 5)
 *   CALETA_PAUSA_MIN_SEG       — pausa mínima entre envíos (default 60)
 *   CALETA_PAUSA_MAX_SEG       — pausa máxima entre envíos (default 90)
 *   NEXT_PUBLIC_SUPABASE_URL   — Supabase (obligatorio)
 *   SUPABASE_SECRET_KEY        — Supabase (obligatorio)
 */
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';


const vacanteArg = process.argv.find((a) => a.startsWith('--vacante='))?.split('=')[1];
const limiteArg = parseInt(process.argv.find((a) => a.startsWith('--limite='))?.split('=')[1] ?? '', 10);
const dry = process.argv.includes('--dry');

const DIR = process.env.CALETA_WHATSAPP_DIR || path.join(process.cwd(), '.caleta-whatsapp');
const RECLUTADOR = process.env.CALETA_RECLUTADOR_NOMBRE || 'Pedro Córdova';
const EMPRESA = process.env.CALETA_EMPRESA || 'nuestra empresa';
const LIMITE = Number.isFinite(limiteArg) && limiteArg > 0 ? limiteArg : parseInt(process.env.CALETA_LIMITE_DIARIO ?? '5', 10);
const PAUSA_MIN = parseInt(process.env.CALETA_PAUSA_MIN_SEG ?? '60', 10) * 1000;
const PAUSA_MAX = parseInt(process.env.CALETA_PAUSA_MAX_SEG ?? '90', 10) * 1000;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error('✖ Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY (configúralos en .env.local).');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const MENSAJES = {
  'Ingeniero Civil (Junior)': (p) =>
    `Hola ${primerNombre(p.full_name)}, soy ${RECLUTADOR} de ${EMPRESA}. ` +
    `Vi tu perfil y estamos buscando un Ingeniero Civil Junior en Lima (S/ 4000-5000, presencial, diseño estructural/supervisión, AutoCAD). ` +
    `Si te interesa conocer más, ¿me podrías compartir tu CV actualizado? ` +
    `Si no es el momento, dímelo y no te vuelvo a escribir. Gracias.`,
  'Ingeniero Sanitario': (p) =>
    `Hola ${primerNombre(p.full_name)}, soy ${RECLUTADOR} de ${EMPRESA}. ` +
    `Vi tu perfil y estamos buscando un Ingeniero Sanitario en Lima (S/ 6000-7000, presencial, instalaciones sanitarias / ACI / trámites SEDAPAL). ` +
    `Si te interesa conocer más, ¿me podrías compartir tu CV actualizado? ` +
    `Si no es el momento, dímelo y no te vuelvo a escribir. Gracias.`,
  'Ingeniero Electromecánico': (p) =>
    `Hola ${primerNombre(p.full_name)}, soy ${RECLUTADOR} de ${EMPRESA}. ` +
    `Vi tu perfil y estamos buscando un Ingeniero Electromecánico en Lima (S/ 6000-7000, presencial, subestaciones / MT y BT / AutoCAD). ` +
    `Si te interesa conocer más, ¿me podrías compartir tu CV actualizado? ` +
    `Si no es el momento, dímelo y no te vuelvo a escribir. Gracias.`,
};

function primerNombre(full) {
  if (!full) return '';
  return full.trim().split(/\s+/)[0]
    .toLowerCase().replace(/^\p{L}/u, (c) => c.toUpperCase());
}

function pausa(min, max) {
  return new Promise((r) => setTimeout(r, min + Math.random() * (max - min)));
}

function aJid(phone) {
  // Phone en caleta_prospects viene normalizado a 9 dígitos (9XXXXXXXX).
  const digits = (phone || '').replace(/\D/g, '');
  if (digits.length === 9 && digits.startsWith('9')) return `51${digits}@s.whatsapp.net`;
  if (digits.length === 11 && digits.startsWith('51')) return `${digits}@s.whatsapp.net`;
  return null;
}

async function cargarVacantes() {
  let q = supabase.from('vacancies').select('id, title');
  if (vacanteArg) q = q.eq('title', vacanteArg);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).filter((v) => MENSAJES[v.title]);
}

async function proximosProspectos(vacancyId, limite) {
  const { data, error } = await supabase
    .from('caleta_prospects')
    .select('id, full_name, phone, vacancy_id, score, created_at')
    .eq('vacancy_id', vacancyId)
    .eq('status', 'encontrado')
    .not('phone', 'is', null)
    .order('score', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: true })
    .limit(limite);
  if (error) throw error;
  return data ?? [];
}

async function marcarContactado(prospectoId, mensaje) {
  const { error } = await supabase
    .from('caleta_prospects')
    .update({ status: 'contactado', notes: mensaje })
    .eq('id', prospectoId);
  if (error) throw new Error(`update: ${error.message}`);
}

async function conectarBaileys() {
  const baileys = await import('@whiskeysockets/baileys');
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
  const { state, saveCreds } = await baileys.useMultiFileAuthState(DIR);
  const latest = await baileys.fetchLatestWaWebVersion().catch(() => null);
  const socket = baileys.default({
    ...(latest && !latest.error ? { version: latest.version } : {}),
    auth: state,
    browser: baileys.Browsers.ubuntu('Caleta Sourcing'),
    syncFullHistory: false,
    markOnlineOnConnect: false,
    logger: { level: 'silent', child: () => ({ level: 'silent', child: () => ({}), trace() {}, debug() {}, info() {}, warn() {}, error() {} }), trace() {}, debug() {}, info() {}, warn() {}, error() {} },
  });

  socket.ev.on('creds.update', saveCreds);

  await new Promise((resolve, reject) => {
    socket.ev.on('connection.update', async (u) => {
      if (u.qr) {
        try {
          const qrcode = await import('qrcode');
          console.log('\n────────── Escanea este QR en WhatsApp → Dispositivos vinculados ──────────');
          console.log(await qrcode.toString(u.qr, { type: 'terminal', small: true }));
          console.log('──────────────────────────────────────────────────────────────────────────\n');
        } catch {
          console.log('\nQR (copia y usa un generador):\n' + u.qr + '\n');
        }
      }
      if (u.connection === 'open') resolve();
      if (u.connection === 'close') {
        const code = u.lastDisconnect?.error?.output?.statusCode;
        if (code === baileys.DisconnectReason.loggedOut) reject(new Error('sesión cerrada, borra ' + DIR + ' y vuelve a correr'));
      }
    });
  });

  return socket;
}

async function existeEnWhatsApp(socket, jid) {
  try {
    const r = await socket.onWhatsApp(jid);
    return Array.isArray(r) && r[0]?.exists === true;
  } catch { return false; }
}

async function main() {
  console.log(`Vacantes: ${vacanteArg || 'todas'}  ·  Límite por vacante: ${LIMITE}  ·  Pausa: ${PAUSA_MIN/1000}-${PAUSA_MAX/1000}s  ·  Dry: ${dry}`);
  const vacantes = await cargarVacantes();
  if (vacantes.length === 0) {
    console.log('No hay vacantes con template definido.');
    return;
  }

  let socket = null;
  if (!dry) {
    console.log('Conectando a WhatsApp…');
    socket = await conectarBaileys();
    console.log('✔ conectado.\n');
  }

  const resumen = { enviados: 0, saltados: 0, fallidos: 0 };

  for (const v of vacantes) {
    console.log(`\n========== ${v.title} ==========`);
    const prospectos = await proximosProspectos(v.id, LIMITE);
    console.log(`A contactar: ${prospectos.length}`);
    for (const p of prospectos) {
      const jid = aJid(p.phone);
      if (!jid) { console.log(`  ⏭ ${p.full_name}: teléfono inválido (${p.phone})`); resumen.saltados++; continue; }
      const mensaje = MENSAJES[v.title](p);

      if (dry) {
        console.log(`  [dry] ${p.full_name} @ ${p.phone}\n        ${mensaje}`);
        resumen.enviados++;
        continue;
      }

      const existe = await existeEnWhatsApp(socket, jid);
      if (!existe) {
        console.log(`  ⏭ ${p.full_name}: ${p.phone} no está en WhatsApp`);
        await marcarContactado(p.id, `[skip] número no existe en WhatsApp`);
        resumen.saltados++;
        continue;
      }

      try {
        await socket.sendMessage(jid, { text: mensaje });
        await marcarContactado(p.id, mensaje);
        resumen.enviados++;
        console.log(`  ✔ ${p.full_name} (${p.phone})`);
      } catch (e) {
        resumen.fallidos++;
        console.log(`  ✖ ${p.full_name}: ${e.message}`);
      }

      await pausa(PAUSA_MIN, PAUSA_MAX);
    }
  }

  console.log('\n========== RESUMEN ==========');
  console.log(JSON.stringify(resumen, null, 2));

  if (socket) await socket.end(undefined);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });

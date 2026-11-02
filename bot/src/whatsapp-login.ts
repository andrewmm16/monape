import { spawn } from "node:child_process";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import QRCode from "qrcode";
import { loadNotifyConfig } from "./config";
import { WhatsAppNotifier } from "./notify/whatsapp";

/**
 * Borra la sesión anterior, pero solo si la carpeta contiene únicamente archivos
 * .json (lo único que guarda Baileys): una ruta mal configurada no debe borrar
 * otra cosa.
 */
async function clearPreviousSession(dir: string): Promise<void> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return; // no existe: nada que borrar
  }
  if (!names.every((name) => name.endsWith(".json"))) {
    throw new Error(
      `${dir} no parece una sesión de WhatsApp (tiene archivos que no son .json). Revise BOT_WHATSAPP_DIR o bórrela a mano.`,
    );
  }
  await rm(dir, { recursive: true, force: true });
}

/**
 * Vincula WhatsApp con el robot (una sola vez). Borra la sesión anterior, si la hay.
 *
 * - Por defecto muestra un código de 8 caracteres: en el teléfono, WhatsApp >
 *   Dispositivos vinculados > Vincular un dispositivo > «Vincular con el número de
 *   teléfono».
 * - Con `--qr` abre una página con un código QR (se renueva sola) para escanearlo:
 *   WhatsApp > Dispositivos vinculados > Vincular un dispositivo.
 *
 * Uso: `npm run bot:whatsapp-login` o `npm run bot:whatsapp-login -- --qr`.
 */
async function main() {
  const config = loadNotifyConfig();
  if (!config.notifyPhone) throw new Error("Falta BOT_NOTIFY_PHONE en .env.bot (solo dígitos, con código de país).");
  const useQr = process.argv.includes("--qr");

  // Vincular es empezar de cero: una sesión a medias de un intento anterior hace que WhatsApp rechace (401).
  await clearPreviousSession(config.whatsappAuthDir);

  const qrFile = path.join(path.dirname(config.whatsappAuthDir), "whatsapp-qr.html");
  let qrOpened = false;
  const showQr = async (qr: string) => {
    const image = await QRCode.toDataURL(qr, { width: 360, margin: 2 });
    await mkdir(path.dirname(qrFile), { recursive: true });
    await writeFile(
      qrFile,
      `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="4"><title>Vincular WhatsApp</title>` +
        `<body style="font-family:sans-serif;text-align:center"><h2>Escanee con WhatsApp</h2>` +
        `<p>Dispositivos vinculados &gt; Vincular un dispositivo</p><img src="${image}" alt="QR"></body>`,
    );
    if (!qrOpened) {
      qrOpened = true;
      console.log(`\nSe abrió la página con el QR (${qrFile}). Escanéelo desde el teléfono.\n`);
      spawn("cmd", ["/c", "start", "", qrFile], { stdio: "ignore", detached: true }).unref();
    }
  };

  const notifier = new WhatsAppNotifier({
    authDir: config.whatsappAuthDir,
    phone: config.notifyPhone,
    log: (message) => console.log(message),
    ...(useQr
      ? { onQr: (qr: string) => void showQr(qr).catch((error) => console.log(`No se pudo mostrar el QR: ${String(error)}`)) }
      : { onPairingCode: (code: string) => console.log(`\nCódigo de vinculación: ${code}\n`) }),
  });
  await notifier.start(() => "");
  console.log("Conectando con WhatsApp…");
  if (!(await notifier.ready(180_000))) {
    await rm(qrFile, { force: true });
    throw new Error("No se completó la vinculación a tiempo. Vuelva a intentarlo.");
  }
  await notifier.notify("Robot de RRHH vinculado: desde ahora le avisaré por aquí. Envíe «ayuda» para ver las órdenes.");
  // La librería guarda la sesión de forma asíncrona: salir de inmediato la deja truncada (creds.json vacío).
  console.log("Vinculado. Guardando la sesión…");
  await new Promise((resolve) => setTimeout(resolve, 8_000));
  await rm(qrFile, { force: true });
  await notifier.stop();
  console.log("Listo. Sesión guardada.");
  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

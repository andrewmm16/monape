import { BotApi } from "../../bot/src/api";
import { loadConfig } from "./config";
import { runPass, type Logger } from "./process";
import { FolderSource, ImapSource, type MailSourceLike } from "./sources";
import { FileStateStore } from "./state";
import { getTemplates } from "./templates";

// Nunca se escribe nombre, correo, teléfono, asunto ni texto de un correo: solo códigos y hashes.
const log: Logger = (message) => console.log(`[${new Date().toISOString()}] ${message}`);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function folderArgument(args: string[]): string | undefined {
  const index = args.indexOf("--folder");
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error("--folder necesita la ruta de la carpeta con los .eml.");
  return value;
}

async function main() {
  const args = process.argv.slice(2);
  const once = args.includes("--once");
  const folderArg = folderArgument(args);
  const base = loadConfig(process.env, false);
  const folder = folderArg ?? base.folder;
  const config = folder ? { ...base, folder } : loadConfig();

  const source: MailSourceLike = folder
    ? new FolderSource(folder)
    : new ImapSource({
        host: config.imapHost,
        port: config.imapPort,
        secure: config.imapSecure,
        user: config.user,
        password: config.password,
        mailbox: config.mailbox,
      });
  const deps = {
    api: new BotApi(config.apiUrl, config.secret),
    templates: getTemplates(config.enableExample),
    state: new FileStateStore(config.stateFile),
    requireAuth: config.requireAuth,
    log,
  };
  if (deps.templates.length === 0) log("aviso: no hay plantillas de portal; todo correo se rechazará (ver correo/README.md)");

  // Desde una carpeta no tiene sentido repetir: son archivos fijos.
  const single = once || Boolean(folder);
  for (;;) {
    try {
      const counts = await runPass(source, deps);
      log(`pasada terminada: ${JSON.stringify(counts)}`);
    } catch {
      // No se registra el mensaje del error: podría traer datos del buzón.
      log("pasada: error");
      if (single) process.exitCode = 1;
    }
    if (single) return;
    await sleep(config.pollSeconds * 1000);
  }
}

main().catch((error: unknown) => {
  // Solo errores de configuración llegan aquí.
  console.error(error instanceof Error ? error.message : "error");
  process.exit(1);
});

/**
 * Demostración: el robot resuelve TODOS los tipos de captcha de los portales ficticios
 * con lógica interna, sin intervención humana. Usa los componentes reales (servidor de
 * portales ficticios + runner + adapter + solver). Headless por defecto; con
 * `--ver` abre el navegador para verlo en vivo.
 *
 *   npx tsx scripts/demo-captcha.ts          (headless, imprime el log)
 *   npx tsx scripts/demo-captcha.ts --ver    (navegador visible, más lento)
 */
import { chromium } from "@playwright/test";
import { setAdapterLog } from "../bot/src/adapters/fake-base";
import { FakeTrabajosDiariosAdapter } from "../bot/src/adapters/fake-trabajos-diarios";
import type { Desafio } from "../bot/src/fake-portal/model";
import { startFakePortal } from "../bot/src/fake-portal/server";
import { runCycle, type RunnerDeps } from "../bot/src/runner";
import { MemorySeenStore } from "../bot/src/seen";
import { MemoryApi, job } from "../tests/fixtures/bot";

const ver = process.argv.includes("--ver");

const CASOS: { nombre: string; desafio: Desafio }[] = [
  { nombre: "aritmética (suma)", desafio: { tipo: "suma", a: 7, b: 5 } },
  { nombre: "texto distorsionado", desafio: { tipo: "texto", a: 0, b: 0, palabra: "AZUL" } },
  { nombre: "casilla «no soy un robot»", desafio: { tipo: "casilla", a: 0, b: 0 } },
  { nombre: "cuadrícula de imágenes", desafio: { tipo: "imagenes", a: 0, b: 0, categoria: "★", celdas: [true, false, true, false, false, false, false, false, true] } },
  { nombre: "slider (arrastre)", desafio: { tipo: "slider", a: 0, b: 0, objetivo: 200, tolerancia: 6 } },
  { nombre: "rotar imagen", desafio: { tipo: "rotar", a: 0, b: 0, angulo: 0, anguloObjetivo: 270 } },
  { nombre: "código por correo (OTP)", desafio: { tipo: "otp", a: 0, b: 0, codigo: "246810" } },
];

async function main(): Promise<void> {
  setAdapterLog((mensaje) => console.log(`   🤖 ${mensaje}`));
  const browser = await chromium.launch({ headless: !ver, slowMo: ver ? 400 : 0 });
  let ok = 0;

  for (const caso of CASOS) {
    const portal = await startFakePortal();
    const context = await browser.newContext();
    try {
      const api = new MemoryApi();
      api.queue.push(job());
      const deps: RunnerDeps = {
        api,
        adapter: new FakeTrabajosDiariosAdapter(context, portal.url, 5_000),
        seen: new MemorySeenStore(),
        log: () => {},
        pauseMs: 0,
        maxJobs: 10,
      };
      portal.setDesafio(caso.desafio, "trabajos-diarios");
      console.log(`\n▶ Portal pide verificación: ${caso.nombre}`);
      const resultado = await runCycle(deps);
      const publico = portal.jobs.size === 1 && !resultado.halted;
      console.log(publico ? `   ✅ Resuelto SIN intervención humana y la oferta se publicó.` : `   ❌ No se publicó (halted=${resultado.halted}, reason=${resultado.reason ?? "-"}).`);
      if (publico) ok++;
    } finally {
      await context.close();
      await portal.close();
    }
  }

  await browser.close();
  console.log(`\n═══ Resultado: ${ok}/${CASOS.length} tipos resueltos por el robot sin intervención humana ═══`);
  process.exit(ok === CASOS.length ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

// Banco ciego del motor (cv-prueba-ciego/): 30 CV que el motor no había visto,
// escritos el 19/11/2026 por un agente que no lo conocía (10 a dos columnas,
// exportaciones de LinkedIn, CV de Computrabajo o Bumeran, tablas, Europass,
// en inglés…), con la vara puesta a ciegas por Opus y 5 casillas ajustadas a
// los criterios de Omar (ver vara.json, campo «ajusteOmar»).
//
// Mide SOLO el motor: el PDF se lee con el mismo lector de la app y se evalúa
// sin IA, sin base de datos y sin reglas aprendidas. Determinista.
//
// Falla (exit 1) si el motor empeora respecto de la línea base: más casillas
// acreditadas de más, más méritos perdidos o más candidatos fuera de orden. Las
// casillas que Opus marcó como dudosas quedan fuera de las métricas.
//
// Uso:
//   npm run medir:motor:ciego                  (resumen)
//   npm run medir:motor:ciego -- --detalle     (cada desacuerdo con la vara)
//   npm run medir:motor:ciego -- --generar-pdf (rehace pdf/ desde fuente/ con Chromium)
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { argv, exit, stdout } from "node:process";
import {
  evaluateWithRules,
  RULE_ENGINE_VERSION,
} from "../../src/modules/evaluation/rule-engine";
import { computeScores } from "../../src/modules/evaluation/scoring";
import type {
  Assessment,
  RequirementInput,
} from "../../src/modules/evaluation/types";
import { extractRawText } from "../../src/modules/resumes/extraction-core";

const RAIZ = resolve(import.meta.dirname, "..", "..", "cv-prueba-ciego");
const FECHA_REFERENCIA = new Date("2026-11-19T12:00:00Z");

/** Línea base (reglas-v14, 19/11/2026). Si el motor mejora, bájela en el mismo commit. */
const BASE = { deMas: 0, meritoPerdido: 3, inversiones: 1 };

type Celda = {
  assessment: Assessment;
  nota: string;
  dudosa: boolean;
  motivo: string;
  opus?: Assessment;
  ajusteOmar?: string;
};
type Cv = {
  vacante: string;
  nivel: string;
  diseno: string;
  idioma: string;
  ajuste: "alto" | "medio" | "bajo";
  casillas: Record<string, Celda>;
};
type Vacante = {
  descripcion: string;
  funciones: string;
  requisitos: RequirementInput[];
};

const vacantes: Record<string, Vacante> = JSON.parse(
  readFileSync(join(RAIZ, "vacantes.json"), "utf8"),
);
const vara: Record<string, Cv> = JSON.parse(
  readFileSync(join(RAIZ, "vara.json"), "utf8"),
);

async function main(): Promise<void> {
  if (argv.includes("--generar-pdf")) {
    const require = createRequire(import.meta.url);
    const { chromium } = require("@playwright/test");
    mkdirSync(join(RAIZ, "pdf"), { recursive: true });
    const browser = await chromium.launch();
    const page = await browser.newPage();
    for (const html of readdirSync(join(RAIZ, "fuente")).filter((f) =>
      f.endsWith(".html"),
    )) {
      await page.setContent(readFileSync(join(RAIZ, "fuente", html), "utf8"), {
        waitUntil: "load",
      });
      writeFileSync(
        join(RAIZ, "pdf", html.replace(/\.html$/, ".pdf")),
        await page.pdf({
          format: "A4",
          printBackground: true,
          preferCSSPageSize: true,
        }),
      );
    }
    await browser.close();
    stdout.write("PDF regenerados desde fuente/.\n");
    exit(0);
  }

  const LETRA: Record<Assessment, string> = {
    acreditado: "A",
    pendiente_verificacion: "P",
    sin_evidencia: "-",
    no_cumplido: "N",
  };
  const porConfirmar = (a: Assessment) =>
    a === "pendiente_verificacion" || a === "sin_evidencia";
  const ORDEN = { alto: 0, medio: 1, bajo: 2 } as const;
  const pct = (a: number, n: number) => `${((100 * a) / n).toFixed(1)} %`;

  let n = 0;
  let exacto = 0;
  let laxo = 0;
  let deMas = 0;
  let meritoPerdido = 0;
  let dudosas = 0;
  const desacuerdos: string[] = [];
  const puntajes = new Map<
    string,
    { archivo: string; ajuste: Cv["ajuste"]; score: number }[]
  >();

  for (const [archivo, cv] of Object.entries(vara)) {
    const vacante = vacantes[cv.vacante]!;
    const texto = (
      await extractRawText(
        new Uint8Array(readFileSync(join(RAIZ, "pdf", archivo))),
        "pdf",
      )
    ).trim();
    const items = evaluateWithRules(texto, vacante.requisitos, {
      referenceDate: FECHA_REFERENCIA,
    });
    const score = computeScores(
      items.map((item) => ({
        assessment: item.assessment,
        weight: vacante.requisitos.find((r) => r.id === item.requirementId)!
          .weight,
      })),
    ).score;
    const lista = puntajes.get(cv.vacante) ?? [];
    lista.push({ archivo, ajuste: cv.ajuste, score });
    puntajes.set(cv.vacante, lista);

    for (const requisito of vacante.requisitos) {
      const celda = cv.casillas[requisito.id];
      if (!celda) continue;
      if (celda.dudosa) {
        dudosas++;
        continue;
      }
      const item = items.find((i) => i.requirementId === requisito.id)!;
      const motor = item.assessment;
      n++;
      if (motor === celda.assessment) exacto++;
      const coincide =
        motor === celda.assessment ||
        (porConfirmar(motor) && porConfirmar(celda.assessment));
      if (coincide) laxo++;
      if (motor === "acreditado" && celda.assessment !== "acreditado") deMas++;
      if (
        celda.assessment === "acreditado" &&
        (motor === "no_cumplido" || motor === "sin_evidencia")
      )
        meritoPerdido++;
      if (!coincide) {
        desacuerdos.push(
          `${archivo} [${cv.diseno}] · ${requisito.description}: vara ${LETRA[celda.assessment]} · motor ${LETRA[motor]}\n    vara: ${celda.nota}\n    motor: ${item.rationale.slice(0, 220)}`,
        );
      }
    }
  }

  // Orden: un candidato con mejor ajuste en la vara no debería puntuar menos que uno peor de la misma vacante.
  let pares = 0;
  let inversiones = 0;
  for (const lista of puntajes.values()) {
    for (const a of lista) {
      for (const b of lista) {
        if (ORDEN[a.ajuste] >= ORDEN[b.ajuste]) continue;
        pares++;
        if (a.score < b.score) inversiones++;
      }
    }
  }

  stdout.write(
    `Banco ciego del motor · ${RULE_ENGINE_VERSION} · ${Object.keys(vara).length} CV · referencia ${FECHA_REFERENCIA.toISOString().slice(0, 10)}\n`,
  );
  stdout.write(
    `Casillas firmes: ${n} (${dudosas} dudosas fuera de la métrica)\n`,
  );
  stdout.write(
    `  Exacto: ${pct(exacto, n)} · contando «pendiente» = «sin evidencia»: ${pct(laxo, n)}\n`,
  );
  stdout.write(
    `  Acreditó de más: ${deMas} (base ${BASE.deMas}) · mérito perdido: ${meritoPerdido} (base ${BASE.meritoPerdido})\n`,
  );
  stdout.write(
    `  Orden: ${inversiones} inversiones en ${pares} pares (base ${BASE.inversiones})\n`,
  );
  if (argv.includes("--detalle")) {
    stdout.write(
      `\n${desacuerdos.length} desacuerdos con la vara:\n${desacuerdos.join("\n")}\n`,
    );
  }

  const peor =
    deMas > BASE.deMas ||
    meritoPerdido > BASE.meritoPerdido ||
    inversiones > BASE.inversiones;
  if (peor) {
    stdout.write(
      "\nEl motor empeoró respecto de la línea base. Revise con --detalle.\n",
    );
    exit(1);
  }
  const mejor =
    deMas < BASE.deMas ||
    meritoPerdido < BASE.meritoPerdido ||
    inversiones < BASE.inversiones;
  if (mejor)
    stdout.write(
      "\nEl motor mejoró: actualice BASE en scripts/medir-motor/ciego.ts.\n",
    );
}

main().catch((error: unknown) => {
  stdout.write(`
[medir-motor:ciego] ${error instanceof Error ? error.message : String(error)}
`);
  exit(1);
});

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { FileIncidentStore, type Incident, type IncidentStep } from "./incidents";
import type { Cambio } from "./fake-portal/mutator";
import type { PasoRobot } from "./fake-portal/mutations";
import { esc } from "./fake-portal/util";

/**
 * Informe del entrenamiento (solo lectura): cruza el diario de cambios del
 * mutador (`bot/.state/mutaciones.json`) con los incidentes del robot
 * (`bot/.state/incidentes/*.json`). Por cada cambio estructural dice si el robot lo
 * detectó y cuánto tardó; por cada cosmético, si dio una falsa alarma; además agrupa
 * por tipo de cambio y por portal, y lista las reanudaciones automáticas del robot.
 * Solo usa portal, paso, código y fechas: ningún dato personal.
 */
const STEP_OF: Record<PasoRobot, IncidentStep> = {
  healthCheck: "prueba_estructura",
  publish: "publicar",
  retirar: "retirar",
  postulantes: "leer_postulantes",
  cv: "descargar_cv",
};

export interface Detection {
  incidente: number;
  paso: IncidentStep;
  codigo: string;
  /** Minutos desde el cambio hasta el incidente. */
  minutos: number;
  /** `true` si no se creó un incidente nuevo sino que se repitió uno anterior (el tiempo es el de la última repetición: cota superior). */
  repeticion: boolean;
  /** El incidente es del paso que se esperaba. */
  enPasoEsperado: boolean;
  /** El robot reanudó solo el portal tras este incidente (ver `Incident.recoveredAt`); `null` si no. */
  reanudacion: { minutosDetenido: number; minutosTrasRestablecer: number | null } | null;
}

export interface FilaCambio {
  cambio: Cambio;
  deteccion: Detection | null;
}

/** Detectados y escapados de un grupo de cambios estructurales. La tasa solo cuenta los ya cerrados (detectados + escapados). */
export interface Resumen {
  aplicados: number;
  detectados: number;
  escapados: number;
  sinDetectarAun: number;
  tasaDeteccionPct: number | null;
  tiempoMedioMin: number | null;
}

export interface FilaReanudacion {
  cambio: number;
  portal: string;
  mutacion: string;
  incidente: number;
  /** Desde que el robot notó el cambio hasta que reanudó el portal. */
  minutosDetenido: number;
  /** Desde que se restableció el portal hasta que el robot volvió; `null` si no se conoce esa hora. */
  minutosTrasRestablecer: number | null;
}

export interface Informe {
  estructurales: FilaCambio[];
  cosmeticos: FilaCambio[];
  porMutacion: (Resumen & { mutacion: string })[];
  porPortal: (Resumen & { portal: string; cosmeticos: number; falsasAlarmas: number; reanudaciones: number })[];
  reanudaciones: FilaReanudacion[];
  resumenReanudaciones: { total: number; tiempoMedioMin: number | null };
  totales: {
    estructurales: number;
    detectados: number;
    /** Sin incidente y ya resueltos o restablecidos: el robot no lo notó. */
    escapados: number;
    /** Sin incidente y aún activos: todavía puede detectarlos. */
    sinDetectarAun: number;
    tiempoMedioMin: number | null;
    tiempoMaxMin: number | null;
    cosmeticos: number;
    falsasAlarmas: number;
  };
}

const time = (iso: string) => Date.parse(iso);
const round1 = (value: number) => Math.round(value * 10) / 10;
const mean = (values: number[]) => (values.length ? round1(values.reduce((a, b) => a + b, 0) / values.length) : null);

type IncidenteMin = Pick<Incident, "portal" | "createdAt" | "lastSeenAt">;
type CambioMin = Pick<Cambio, "id" | "portal" | "timestamp">;

/** Cuándo empieza el siguiente cambio del mismo portal (hasta ahí llega lo atribuible a este); infinito si no hay. */
export function finDe(cambio: CambioMin, cambios: CambioMin[]): number {
  const later = cambios
    .filter((o) => o.portal === cambio.portal && o.id !== cambio.id && (time(o.timestamp) > time(cambio.timestamp) || (time(o.timestamp) === time(cambio.timestamp) && o.id > cambio.id)))
    .map((o) => time(o.timestamp));
  return later.length ? Math.min(...later) : Number.POSITIVE_INFINITY;
}

/**
 * Criterio ÚNICO de atribución (lo usan el informe y el mutador): un incidente es del
 * último cambio de su portal anterior a él. Vale si lo creó el robot después del cambio
 * o si repitió uno anterior (`lastSeenAt` posterior al cambio: `repeticion`).
 */
export function atribuir<T extends IncidenteMin>(
  cambio: Pick<Cambio, "portal" | "timestamp">,
  fin: number,
  incidentes: T[],
): { incident: T; repeticion: boolean; at: number } | undefined {
  const start = time(cambio.timestamp);
  return incidentes
    .filter((i) => i.portal === cambio.portal && time(i.createdAt) < fin && (time(i.createdAt) >= start || time(i.lastSeenAt) >= start))
    .map((i) => ({ incident: i, repeticion: time(i.createdAt) < start, at: time(i.createdAt) >= start ? time(i.createdAt) : time(i.lastSeenAt) }))
    .sort((a, b) => a.at - b.at)[0];
}

function summarize(rows: FilaCambio[]): Resumen {
  const detected = rows.filter((row) => row.deteccion);
  const undetected = rows.filter((row) => !row.deteccion);
  const escapados = undetected.filter((row) => row.cambio.estado !== "activa").length;
  return {
    aplicados: rows.length,
    detectados: detected.length,
    escapados,
    sinDetectarAun: undetected.length - escapados,
    tasaDeteccionPct: detected.length + escapados ? Math.round((detected.length / (detected.length + escapados)) * 100) : null,
    tiempoMedioMin: mean(detected.map((row) => row.deteccion!.minutos)),
  };
}

/** Cruza el diario con los incidentes. Un incidente se atribuye al último cambio del mismo portal anterior a él. */
export function buildReport(cambios: Cambio[], incidentes: Incident[]): Informe {
  const ordered = [...cambios].sort((a, b) => time(a.timestamp) - time(b.timestamp) || a.id - b.id);
  const rows: FilaCambio[] = ordered.map((cambio) => {
    const first = atribuir(cambio, finDe(cambio, ordered), incidentes);
    if (!first) return { cambio, deteccion: null };
    const recovered = first.incident.recoveredAt ? time(first.incident.recoveredAt) : null;
    const restored = cambio.restablecidaEn ?? (cambio.estado === "restablecida" ? cambio.resueltaEn : undefined);
    const afterRestore = recovered !== null && restored ? round1((recovered - time(restored)) / 60_000) : null;
    return {
      cambio,
      deteccion: {
        incidente: first.incident.id,
        paso: first.incident.step,
        codigo: first.incident.errorCode,
        minutos: round1((first.at - time(cambio.timestamp)) / 60_000),
        repeticion: first.repeticion,
        enPasoEsperado: cambio.esperado.some((paso) => STEP_OF[paso] === first.incident.step),
        reanudacion:
          recovered === null
            ? null
            : { minutosDetenido: Math.max(0, round1((recovered - first.at) / 60_000)), minutosTrasRestablecer: afterRestore !== null && afterRestore >= 0 ? afterRestore : null },
      },
    };
  });

  const estructurales = rows.filter((row) => row.cambio.tipo === "estructural");
  const cosmeticos = rows.filter((row) => row.cambio.tipo === "cosmetica");
  const detected = estructurales.filter((row) => row.deteccion);
  const minutes = detected.map((row) => row.deteccion!.minutos);
  const undetected = estructurales.filter((row) => !row.deteccion);

  const reanudaciones: FilaReanudacion[] = estructurales
    .filter((row) => row.deteccion?.reanudacion)
    .map(({ cambio, deteccion }) => ({
      cambio: cambio.id,
      portal: cambio.portal,
      mutacion: cambio.mutacion,
      incidente: deteccion!.incidente,
      ...deteccion!.reanudacion!,
    }));
  const portales = [...new Set(rows.map((row) => row.cambio.portal))].sort();
  const mutaciones = [...new Set(estructurales.map((row) => row.cambio.mutacion))].sort();
  return {
    estructurales,
    cosmeticos,
    porMutacion: mutaciones.map((mutacion) => ({ mutacion, ...summarize(estructurales.filter((row) => row.cambio.mutacion === mutacion)) })),
    porPortal: portales.map((portal) => {
      const own = cosmeticos.filter((row) => row.cambio.portal === portal);
      return {
        portal,
        ...summarize(estructurales.filter((row) => row.cambio.portal === portal)),
        cosmeticos: own.length,
        falsasAlarmas: own.filter((row) => row.deteccion).length,
        reanudaciones: reanudaciones.filter((r) => r.portal === portal).length,
      };
    }),
    reanudaciones,
    resumenReanudaciones: {
      total: reanudaciones.length,
      tiempoMedioMin: mean(reanudaciones.flatMap((r) => (r.minutosTrasRestablecer === null ? [] : [r.minutosTrasRestablecer]))),
    },
    totales: {
      estructurales: estructurales.length,
      detectados: detected.length,
      escapados: undetected.filter((row) => row.cambio.estado !== "activa").length,
      sinDetectarAun: undetected.filter((row) => row.cambio.estado === "activa").length,
      tiempoMedioMin: mean(minutes),
      tiempoMaxMin: minutes.length ? Math.max(...minutes) : null,
      cosmeticos: cosmeticos.length,
      falsasAlarmas: cosmeticos.filter((row) => row.deteccion).length,
    },
  };
}

const minutesText = (value: number) => (value >= 120 ? `${Math.floor(value / 60)} h ${Math.round(value % 60)} min` : `${value} min`);
const optionalMinutes = (value: number | null) => (value === null ? "–" : minutesText(value));
const pct = (value: number | null) => (value === null ? "–" : `${value} %`);

type Table = { headers: string[]; rows: string[][] };

function tables(report: Informe): { title: string; table: Table }[] {
  const when = (iso: string) => iso.replace("T", " ").slice(0, 19);
  const state = (cambio: Cambio) => (cambio.restablecida_auto ? `${cambio.estado} (auto: ${cambio.motivo ?? "?"})` : cambio.estado);
  const summaryRow = (name: string, r: Resumen) => [name, String(r.aplicados), String(r.detectados), String(r.escapados), String(r.sinDetectarAun), pct(r.tasaDeteccionPct), optionalMinutes(r.tiempoMedioMin)];
  const summaryHeaders = ["Aplicados", "Detectados", "Escapados", "Sin detectar aún", "Tasa de detección", "Tiempo medio"];
  return [
    {
      title: "Cambios estructurales (el robot DEBE detectarlos)",
      table: {
        headers: ["N.º", "Portal", "Cambio", "Aplicado (UTC)", "Estado", "Esperado", "¿Detectado?", "Tiempo", "Incidente", "Paso", "Código"],
        rows: report.estructurales.map(({ cambio, deteccion }) => [
          String(cambio.id),
          cambio.portal,
          cambio.mutacion,
          when(cambio.timestamp),
          state(cambio),
          cambio.esperado.join("+"),
          deteccion ? "sí" : cambio.estado === "activa" ? "no (aún)" : "NO",
          deteccion ? `${deteccion.repeticion ? "≤ " : ""}${minutesText(deteccion.minutos)}` : "–",
          deteccion ? `#${deteccion.incidente}${deteccion.repeticion ? " (repetido)" : ""}` : "–",
          deteccion ? `${deteccion.paso}${deteccion.enPasoEsperado ? "" : " (otro paso)"}` : "–",
          deteccion?.codigo ?? "–",
        ]),
      },
    },
    {
      title: "Cambios cosméticos (el robot NO debe notarlos)",
      table: {
        headers: ["N.º", "Portal", "Cambio", "Aplicado (UTC)", "¿Falsa alarma?", "Incidente", "Paso", "Código"],
        rows: report.cosmeticos.map(({ cambio, deteccion }) => [
          String(cambio.id),
          cambio.portal,
          cambio.mutacion,
          when(cambio.timestamp),
          deteccion ? "SÍ" : "no",
          deteccion ? `#${deteccion.incidente}` : "–",
          deteccion?.paso ?? "–",
          deteccion?.codigo ?? "–",
        ]),
      },
    },
    {
      title: "Detección por tipo de cambio estructural",
      table: { headers: ["Cambio", ...summaryHeaders], rows: report.porMutacion.map((r) => summaryRow(r.mutacion, r)) },
    },
    {
      title: "Detección por portal",
      table: {
        headers: ["Portal", ...summaryHeaders, "Cosméticos", "Falsas alarmas", "Reanudaciones"],
        rows: report.porPortal.map((r) => [...summaryRow(r.portal, r), String(r.cosmeticos), String(r.falsasAlarmas), String(r.reanudaciones)]),
      },
    },
    {
      title: "Reanudaciones automáticas del robot",
      table: {
        headers: ["Cambio", "Portal", "Tipo de cambio", "Incidente", "Detenido", "Volvió tras restablecer"],
        rows: report.reanudaciones.map((r) => [`#${r.cambio}`, r.portal, r.mutacion, `#${r.incidente}`, minutesText(r.minutosDetenido), optionalMinutes(r.minutosTrasRestablecer)]),
      },
    },
  ];
}

function totalsLines(report: Informe): string[] {
  const t = report.totales;
  const r = report.resumenReanudaciones;
  return [
    `Estructurales: ${t.estructurales} · detectados: ${t.detectados} · escapados: ${t.escapados} · sin detectar aún (activos): ${t.sinDetectarAun}`,
    `Tiempo hasta detectar: medio ${optionalMinutes(t.tiempoMedioMin)} · máximo ${optionalMinutes(t.tiempoMaxMin)}`,
    `Cosméticos: ${t.cosmeticos} · falsas alarmas: ${t.falsasAlarmas}`,
    `Reanudaciones automáticas: ${r.total} · tiempo medio en volver tras restablecer el portal: ${optionalMinutes(r.tiempoMedioMin)}`,
  ];
}

export interface RenderOptions {
  /** Hora de generación (ISO); se muestra en el encabezado. */
  generadoEn?: string;
}

const generated = (options: RenderOptions) => (options.generadoEn ? `Generado (UTC): ${options.generadoEn.replace("T", " ").slice(0, 19)}` : null);

export function renderText(report: Informe, options: RenderOptions = {}): string {
  const out: string[] = ["INFORME DE ENTRENAMIENTO", ...(generated(options) ? [generated(options)!] : []), ""];
  for (const { title, table } of tables(report)) {
    out.push(title);
    if (table.rows.length === 0) {
      out.push("  (sin cambios)", "");
      continue;
    }
    const widths = table.headers.map((header, col) => Math.max(header.length, ...table.rows.map((row) => row[col]!.length)));
    const line = (cells: string[]) => `  ${cells.map((cell, col) => cell.padEnd(widths[col]!)).join("  ")}`.trimEnd();
    out.push(line(table.headers), line(widths.map((w) => "-".repeat(w))), ...table.rows.map(line), "");
  }
  out.push("TOTALES", ...totalsLines(report).map((l) => `  ${l}`));
  return out.join("\n");
}

export function renderMarkdown(report: Informe, options: RenderOptions = {}): string {
  const out: string[] = ["# Informe de entrenamiento", "", ...(generated(options) ? [generated(options)!, ""] : [])];
  for (const { title, table } of tables(report)) {
    out.push(`## ${title}`, "");
    if (table.rows.length === 0) {
      out.push("Sin cambios.", "");
      continue;
    }
    out.push(`| ${table.headers.join(" | ")} |`, `| ${table.headers.map(() => "---").join(" | ")} |`, ...table.rows.map((row) => `| ${row.join(" | ")} |`), "");
  }
  out.push("## Totales", "", ...totalsLines(report).map((l) => `- ${l}`), "");
  return out.join("\n");
}

const HTML_CSS = `body{margin:0;background:#f3f4f6;color:#1f2937;font-family:system-ui,sans-serif}main{max-width:1200px;margin:1.5rem auto;padding:0 1rem}
h2{margin:1.6rem 0 .3rem}table{width:100%;border-collapse:collapse;background:#fff;font-size:.85rem}td,th{border-bottom:1px solid #e5e7eb;padding:.3rem .5rem;text-align:left}
.totales{background:#ede9fe;border-radius:8px;padding:.6rem 1rem}.small{color:#6b7280;font-size:.85rem}`;

/** Informe como página HTML legible (los totales arriba). `refreshSeconds` > 0 la recarga sola. */
export function renderHtml(report: Informe, options: RenderOptions & { refreshSeconds?: number } = {}): string {
  const sections = tables(report)
    .map(({ title, table }) =>
      table.rows.length === 0
        ? `<h2>${esc(title)}</h2><p class="small">Sin datos.</p>`
        : `<h2>${esc(title)}</h2><table><thead><tr>${table.headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${table.rows
            .map((row) => `<tr>${row.map((cell) => `<td>${esc(cell)}</td>`).join("")}</tr>`)
            .join("")}</tbody></table>`,
    )
    .join("");
  const refresh = options.refreshSeconds ? `<meta http-equiv="refresh" content="${options.refreshSeconds}">` : "";
  return `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Informe de entrenamiento</title>${refresh}<style>${HTML_CSS}</style><body><main>
<h1>Informe de entrenamiento</h1><p class="small">${esc(generated(options) ?? "")} · <a href="/">Panel de la demo</a> · <a href="/__fake/informe?actualizar=1">Actualizar ahora</a></p>
<div class="totales">${totalsLines(report).map((l) => `<div>${esc(l)}</div>`).join("")}</div>${sections}</main></body></html>`;
}

/** Escritura atómica: quien lea el archivo ve el informe anterior o el nuevo, nunca uno a medias. */
export function writeFileAtomic(file: string, content: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, content);
  renameSync(tmp, file);
}

function readDiary(file: string): Cambio[] | null {
  try {
    const diary = JSON.parse(readFileSync(file, "utf8")) as { cambios?: Cambio[] };
    return Array.isArray(diary.cambios) ? diary.cambios : [];
  } catch {
    return null;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const valueOf = (flag: string) => {
    const index = args.indexOf(flag);
    const value = index >= 0 ? args[index + 1] : undefined;
    return value && !value.startsWith("--") ? value : undefined;
  };
  const diaryFile = path.resolve(valueOf("--diario") ?? "bot/.state/mutaciones.json");
  const incidentsDir = path.resolve(valueOf("--incidentes") ?? process.env.BOT_INCIDENTS_DIR ?? "bot/.state/incidentes");
  const everyRaw = args.includes("--cada") ? valueOf("--cada") : undefined;
  const everyMinutes = everyRaw === undefined ? undefined : Number(everyRaw);
  if (args.includes("--cada") && (everyMinutes === undefined || !Number.isFinite(everyMinutes) || everyMinutes <= 0 || everyMinutes > 1440)) {
    throw new Error("--cada necesita un número de minutos mayor que 0 y de hasta 1440.");
  }

  const once = async () => {
    const cambios = readDiary(diaryFile);
    if (cambios === null) {
      console.log(`Aún no hay diario de mutaciones (${path.relative(process.cwd(), diaryFile)}). Levante los portales con «npm run bot:fake-portal -- --entrenar».`);
      return;
    }
    const incidentes = await new FileIncidentStore(incidentsDir, () => {}).list();
    const report = buildReport(cambios, incidentes);
    const options = { generadoEn: new Date().toISOString() };
    console.log(renderText(report, options));

    if (args.includes("--md")) {
      const stateDir = path.resolve("bot/.state");
      const target = path.resolve(valueOf("--md") ?? path.join(stateDir, "informe-entrenamiento.md"));
      if (path.relative(stateDir, target).startsWith("..") || path.isAbsolute(path.relative(stateDir, target))) {
        throw new Error("El informe en Markdown solo se escribe dentro de bot/.state/.");
      }
      writeFileAtomic(target, renderMarkdown(report, options));
      console.log(`\nInforme escrito en ${path.relative(process.cwd(), target)}`);
    }
  };

  await once();
  // Modo vigilancia: repinta cada N minutos hasta Ctrl+C.
  while (everyMinutes) {
    await new Promise((resolve) => setTimeout(resolve, everyMinutes * 60_000));
    if (process.stdout.isTTY) console.clear();
    await once();
  }
}

// Solo se ejecuta como script (`npm run bot:training-report`), no al importarlo desde las pruebas.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

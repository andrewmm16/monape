import { DISCARDED_APPLICATION_STATUSES, IN_PROCESS_STATUSES, SELECTABLE_STATUSES } from "@/modules/applications/schemas";
import type { Enums } from "@/types/database";

/**
 * Cálculo puro (sin acceso a datos) de los indicadores de reportes. Recibe las
 * filas que ya filtró la RLS del usuario, así que el ámbito no se amplía aquí.
 */

export type ApplicationStatus = Enums<"application_status">;
export type CandidateSource = Enums<"candidate_source">;

export type ReportApplication = {
  id: string;
  candidateId: string;
  status: ApplicationStatus;
  appliedAt: string;
  source: CandidateSource;
};

export type ReportStatusEvent = {
  applicationId: string;
  fromStatus: ApplicationStatus;
  toStatus: ApplicationStatus;
  createdAt: string;
};

/**
 * Recorrido principal del proceso, en orden. Incluye etapas antiguas o
 * automáticas (preseleccionado, en_evaluacion) para calcular el avance; el
 * embudo solo las muestra si tienen datos.
 */
export const MAIN_PATH: readonly ApplicationStatus[] = [
  "nuevo",
  "en_revision",
  "preseleccionado",
  "entrevista_programada",
  "en_evaluacion",
  "seleccionado",
];

/** Estados fuera del recorrido principal (salidas o pausas). */
export const SIDE_STATUSES: readonly ApplicationStatus[] = ["no_seleccionado", "en_reserva", "retirado"];

const DECISION_STATUSES: readonly ApplicationStatus[] = ["seleccionado", "no_seleccionado"];

export type FunnelStep = {
  status: ApplicationStatus;
  /** Postulaciones que están hoy en este estado. */
  current: number;
  /** Postulaciones que llegaron a esta etapa o a una posterior del recorrido principal. */
  reached: number;
  /** reached / reached de la etapa anterior (null en la primera o si no hay base). */
  conversion: number | null;
};

export function computeFunnel(apps: ReportApplication[], events: ReportStatusEvent[]): FunnelStep[] {
  const rankOf = new Map<ApplicationStatus, number>(MAIN_PATH.map((status, index) => [status, index]));
  const maxRank = new Map<string, number>();
  for (const app of apps) maxRank.set(app.id, rankOf.get(app.status) ?? 0);
  for (const event of events) {
    const current = maxRank.get(event.applicationId);
    const rank = rankOf.get(event.toStatus);
    if (current !== undefined && rank !== undefined && rank > current) maxRank.set(event.applicationId, rank);
  }

  const currentCount = new Map<ApplicationStatus, number>();
  for (const app of apps) currentCount.set(app.status, (currentCount.get(app.status) ?? 0) + 1);

  // Etapas que ya no se pueden elegir a mano solo se muestran si hay datos reales
  // (alguien está o pasó por ellas); el rango se calcula con el recorrido completo.
  const visited = new Set<ApplicationStatus>(apps.map((app) => app.status));
  for (const event of events) visited.add(event.toStatus);
  const selectable = SELECTABLE_STATUSES as readonly ApplicationStatus[];

  const ranks = [...maxRank.values()];
  const steps: FunnelStep[] = MAIN_PATH.flatMap((status, index) =>
    selectable.includes(status) || visited.has(status)
      ? [
          {
            status,
            current: currentCount.get(status) ?? 0,
            reached: ranks.filter((rank) => rank >= index).length,
            conversion: null,
          } satisfies FunnelStep,
        ]
      : [],
  );
  for (let i = 1; i < steps.length; i++) {
    const previous = steps[i - 1].reached;
    steps[i].conversion = previous > 0 ? steps[i].reached / previous : null;
  }
  return steps;
}

export function computeSideCounts(apps: ReportApplication[]): { status: ApplicationStatus; current: number }[] {
  return SIDE_STATUSES.map((status) => ({ status, current: apps.filter((app) => app.status === status).length }));
}

/**
 * Indicadores de cabecera (tarjetas KPI). «En proceso» usa los mismos estados
 * que el resto de la app; «descartados» son no seleccionados y retirados; la
 * conversión global es seleccionados sobre el total.
 */
export type Kpis = {
  total: number;
  inProcess: number;
  selected: number;
  discarded: number;
  conversion: number | null;
};

export function computeKpis(apps: ReportApplication[]): Kpis {
  const inProcess = IN_PROCESS_STATUSES as readonly ApplicationStatus[];
  const discarded = DISCARDED_APPLICATION_STATUSES as readonly ApplicationStatus[];
  const total = apps.length;
  let inProcessCount = 0;
  let selected = 0;
  let discardedCount = 0;
  for (const app of apps) {
    if (app.status === "seleccionado") selected += 1;
    if (discarded.includes(app.status)) discardedCount += 1;
    if (inProcess.includes(app.status)) inProcessCount += 1;
  }
  return { total, inProcess: inProcessCount, selected, discarded: discardedCount, conversion: total > 0 ? selected / total : null };
}

export type SourceRow = {
  source: CandidateSource;
  candidates: number;
  share: number;
  /** Candidatos de esta fuente que llegaron a «seleccionado» (hoy o en el historial). */
  selected: number;
  /** selected / candidates: calidad de la fuente, no solo su volumen. */
  selectedShare: number;
};

/** Candidatos distintos por fuente (un candidato con varias postulaciones cuenta una vez). */
export function computeSources(apps: ReportApplication[], events: ReportStatusEvent[] = []): SourceRow[] {
  const bySource = new Map<CandidateSource, Set<string>>();
  for (const app of apps) {
    const set = bySource.get(app.source) ?? new Set<string>();
    set.add(app.candidateId);
    bySource.set(app.source, set);
  }
  // Candidatos que alcanzaron «seleccionado» (estado actual o algún cambio a ese estado).
  const appToCandidate = new Map(apps.map((app) => [app.id, app.candidateId]));
  const selectedCandidates = new Set<string>();
  for (const app of apps) if (app.status === "seleccionado") selectedCandidates.add(app.candidateId);
  for (const event of events) {
    if (event.toStatus !== "seleccionado") continue;
    const candidateId = appToCandidate.get(event.applicationId);
    if (candidateId) selectedCandidates.add(candidateId);
  }
  const total = [...bySource.values()].reduce((sum, set) => sum + set.size, 0);
  return [...bySource.entries()]
    .map(([source, set]) => {
      const selected = [...set].filter((id) => selectedCandidates.has(id)).length;
      return {
        source,
        candidates: set.size,
        share: total > 0 ? set.size / total : 0,
        selected,
        selectedShare: set.size > 0 ? selected / set.size : 0,
      };
    })
    .sort((a, b) => b.candidates - a.candidates);
}

/** Punto de la serie temporal de postulaciones (por semana o por mes). */
export type TrendPoint = { key: string; label: string; count: number };
export type Trend = { granularity: "semana" | "mes"; points: TrendPoint[] };

const DAY_MS = 86_400_000;

function utcDate(iso: string): Date | null {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

function weekStartUtc(date: Date): Date {
  const day = (date.getUTCDay() + 6) % 7; // lunes = 0
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - day));
}

/**
 * Postulaciones recibidas a lo largo del tiempo. Agrupa por semana (lunes) si el
 * rango es corto, o por mes si es largo, y rellena los periodos sin datos con 0
 * para que la tendencia no tenga huecos.
 */
export function computeTrend(apps: ReportApplication[]): Trend {
  const dates = apps.flatMap((app) => {
    const date = utcDate(app.appliedAt);
    return date ? [date] : [];
  });
  if (dates.length === 0) return { granularity: "semana", points: [] };
  const min = new Date(Math.min(...dates.map((d) => d.getTime())));
  const max = new Date(Math.max(...dates.map((d) => d.getTime())));
  const spanDays = (max.getTime() - min.getTime()) / DAY_MS;
  const granularity: Trend["granularity"] = spanDays > 180 ? "mes" : "semana";

  const monthFmt = new Intl.DateTimeFormat("es-PE", { month: "short", year: "numeric", timeZone: "UTC" });
  const weekFmt = new Intl.DateTimeFormat("es-PE", { day: "2-digit", month: "short", timeZone: "UTC" });
  const keyOf = (date: Date) =>
    granularity === "mes"
      ? `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`
      : weekStartUtc(date).toISOString().slice(0, 10);

  const counts = new Map<string, number>();
  for (const date of dates) counts.set(keyOf(date), (counts.get(keyOf(date)) ?? 0) + 1);

  const points: TrendPoint[] = [];
  if (granularity === "mes") {
    const cursor = new Date(Date.UTC(min.getUTCFullYear(), min.getUTCMonth(), 1));
    const end = new Date(Date.UTC(max.getUTCFullYear(), max.getUTCMonth(), 1));
    while (cursor <= end) {
      const key = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`;
      points.push({ key, label: monthFmt.format(cursor), count: counts.get(key) ?? 0 });
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
  } else {
    const cursor = weekStartUtc(min);
    const end = weekStartUtc(max);
    while (cursor <= end) {
      const key = cursor.toISOString().slice(0, 10);
      points.push({ key, label: weekFmt.format(cursor), count: counts.get(key) ?? 0 });
      cursor.setUTCDate(cursor.getUTCDate() + 7);
    }
  }
  return { granularity, points };
}

export type StageTime = { status: ApplicationStatus; samples: number; avgHours: number; medianHours: number };
export type TimeMetrics = {
  /** Tiempo que las postulaciones pasaron en cada estado antes de cambiar a otro. */
  perStage: StageTime[];
  /** Desde la postulación hasta el primer estado de decisión (seleccionado / no seleccionado). */
  toDecision: { samples: number; avgHours: number; medianHours: number } | null;
};

const HOUR_MS = 3_600_000;

function stats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return { samples: sorted.length, avgHours: sorted.reduce((s, v) => s + v, 0) / sorted.length, medianHours: median };
}

/**
 * La entrada a un estado es el cambio de estado anterior de la misma
 * postulación (o la fecha de postulación, para el primero). Se descartan
 * duraciones negativas por datos inconsistentes.
 */
export function computeTimes(apps: ReportApplication[], events: ReportStatusEvent[]): TimeMetrics {
  const byApp = new Map<string, ReportStatusEvent[]>();
  for (const event of events) {
    const list = byApp.get(event.applicationId) ?? [];
    list.push(event);
    byApp.set(event.applicationId, list);
  }
  const perStage = new Map<ApplicationStatus, number[]>();
  const decision: number[] = [];

  for (const app of apps) {
    const list = (byApp.get(app.id) ?? []).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    const applied = Date.parse(app.appliedAt);
    let enteredAt = applied;
    let decided = false;
    for (const event of list) {
      const at = Date.parse(event.createdAt);
      const hours = (at - enteredAt) / HOUR_MS;
      if (Number.isFinite(hours) && hours >= 0) {
        const bucket = perStage.get(event.fromStatus) ?? [];
        bucket.push(hours);
        perStage.set(event.fromStatus, bucket);
      }
      if (!decided && DECISION_STATUSES.includes(event.toStatus)) {
        decided = true;
        const total = (at - applied) / HOUR_MS;
        if (Number.isFinite(total) && total >= 0) decision.push(total);
      }
      enteredAt = at;
    }
  }

  const ordered = [...MAIN_PATH, ...SIDE_STATUSES];
  return {
    perStage: ordered
      .filter((status) => (perStage.get(status)?.length ?? 0) > 0)
      .map((status) => ({ status, ...stats(perStage.get(status)!) })),
    toDecision: decision.length > 0 ? stats(decision) : null,
  };
}

/** Texto legible para una duración en horas. */
export function formatHours(hours: number): string {
  if (hours < 1) return "menos de 1 h";
  if (hours < 48) return `${hours.toFixed(1)} h`;
  return `${(hours / 24).toFixed(1)} días`;
}

/** Variación del último periodo de la tendencia respecto al anterior. */
export type TrendDelta = {
  current: number;
  previous: number;
  /** Variación porcentual; `null` si el periodo anterior fue 0 (no es divisible). */
  pct: number | null;
  direction: "up" | "down" | "flat";
};

export function computeTrendDelta(trend: Trend): TrendDelta | null {
  const points = trend.points;
  if (points.length < 2) return null;
  const current = points[points.length - 1].count;
  const previous = points[points.length - 2].count;
  if (current === 0 && previous === 0) return null;
  const pct = previous === 0 ? null : ((current - previous) / previous) * 100;
  const direction = current > previous ? "up" : current < previous ? "down" : "flat";
  return { current, previous, pct, direction };
}

/**
 * Observaciones automáticas en datos crudos (sin texto de UI): la capa de
 * presentación las convierte a frases con las etiquetas correspondientes. Así el
 * cálculo sigue siendo puro y verificable.
 */
export type Insight =
  | { kind: "trend"; granularity: Trend["granularity"]; direction: "up" | "down"; pct: number }
  | { kind: "funnel-drop"; from: ApplicationStatus; to: ApplicationStatus; conversion: number }
  | { kind: "best-source"; source: CandidateSource; selectedShare: number; selected: number };

export function computeInsights(input: {
  funnel: FunnelStep[];
  sources: SourceRow[];
  trend: Trend;
  kpis: Kpis;
}): Insight[] {
  const insights: Insight[] = [];

  // 1) Tendencia reciente (solo si el cambio es relevante, >= 5%).
  const delta = computeTrendDelta(input.trend);
  if (delta && delta.pct !== null && Math.abs(delta.pct) >= 5 && delta.direction !== "flat") {
    insights.push({
      kind: "trend",
      granularity: input.trend.granularity,
      direction: delta.direction,
      pct: Math.round(Math.abs(delta.pct)),
    });
  }

  // 2) Mayor caída del embudo (menor conversión entre etapas con base real).
  const transitions = input.funnel
    .map((step, index) => ({ step, prev: index > 0 ? input.funnel[index - 1] : null }))
    .filter((t): t is { step: FunnelStep; prev: FunnelStep } => t.prev !== null && t.step.conversion !== null);
  if (transitions.length > 0) {
    const worst = transitions.reduce((a, b) => (b.step.conversion! < a.step.conversion! ? b : a));
    if (worst.step.conversion! < 1) {
      insights.push({
        kind: "funnel-drop",
        from: worst.prev.status,
        to: worst.step.status,
        conversion: worst.step.conversion!,
      });
    }
  }

  // 3) Fuente con mejor conversión a seleccionado (con al menos 1 seleccionado).
  const withSelected = input.sources.filter((source) => source.selected > 0);
  if (withSelected.length > 0) {
    const best = withSelected.reduce((a, b) => (b.selectedShare > a.selectedShare ? b : a));
    insights.push({
      kind: "best-source",
      source: best.source,
      selectedShare: best.selectedShare,
      selected: best.selected,
    });
  }

  return insights;
}

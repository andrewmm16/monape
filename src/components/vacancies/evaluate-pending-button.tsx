"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2Icon, PlayIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { evaluatePendingApplications, type EvaluatePendingSummary } from "@/modules/applications/actions";

type RunSummary = {
  evaluated: number;
  /** Evaluadas tras leer su CV escaneado con OCR (incluidas en `evaluated`). */
  ocrRead?: number;
  failed: number;
  /** Total sin texto legible; la lista de enlaces se limita a 50. */
  withoutTextCount: number;
  withoutText: { applicationId: string; candidateName: string }[];
  /** Si la corrida se detuvo por un error, cuántas quedaron sin evaluar. */
  stopped?: { error: string; remaining: number };
};

const MAX_LISTED = 50;
const STORAGE_EVENT = "evaluar-pendientes";

const storageKey = (vacancyId: string) => `evaluar-pendientes:${vacancyId}`;

/** El resumen vive en sessionStorage para no perderse al refrescar la página. */
function subscribe(callback: () => void) {
  window.addEventListener(STORAGE_EVENT, callback);
  return () => window.removeEventListener(STORAGE_EVENT, callback);
}

function writeSummary(vacancyId: string, summary: RunSummary | null) {
  try {
    if (summary) sessionStorage.setItem(storageKey(vacancyId), JSON.stringify(summary));
    else sessionStorage.removeItem(storageKey(vacancyId));
  } catch {
    // Almacenamiento no disponible: el resumen solo se muestra mientras la página siga abierta.
  }
  window.dispatchEvent(new Event(STORAGE_EVENT));
}

function plural(count: number, singular: string, pluralForm: string) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/**
 * «Evaluar pendientes»: evalúa por reglas, por tramos, las postulaciones de la
 * vacante sin evaluación o con criterios desactualizados. No es destructivo: la
 * evaluación anterior queda en el historial, por eso no pide confirmación.
 */
export function EvaluatePendingButton({
  vacancyId,
  pending,
  criteriaApproved,
}: {
  vacancyId: string;
  pending: number;
  criteriaApproved: boolean;
}) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ evaluated: 0, processed: 0, total: 0 });
  const rawSummary = useSyncExternalStore(
    subscribe,
    () => {
      try {
        return sessionStorage.getItem(storageKey(vacancyId));
      } catch {
        return null;
      }
    },
    () => null,
  );
  const summary = parseSummary(rawSummary);

  const run = async () => {
    const total = pending;
    setRunning(true);
    writeSummary(vacancyId, null);
    setProgress({ evaluated: 0, processed: 0, total });

    let cursor: string | null = null;
    let evaluated = 0;
    let failed = 0;
    let ocrRead = 0;
    let withoutTextCount = 0;
    const withoutText: RunSummary["withoutText"] = [];
    let remaining = total;
    let stopped: RunSummary["stopped"];

    while (true) {
      const result: Awaited<ReturnType<typeof evaluatePendingApplications>> | null = await evaluatePendingApplications({
        vacancyId,
        cursor,
      }).catch(() => null);
      if (!result || !result.ok) {
        stopped = {
          error: result && !result.ok ? result.error : "No se pudo conectar con el servidor. Intente nuevamente.",
          remaining,
        };
        break;
      }
      const data: EvaluatePendingSummary = result.data;
      evaluated += data.evaluated;
      failed += data.failed;
      ocrRead += data.ocrRead;
      withoutTextCount += data.withoutText.length;
      for (const item of data.withoutText) if (withoutText.length < MAX_LISTED) withoutText.push(item);
      remaining = data.remaining;
      const handled = data.evaluated + data.failed + data.withoutText.length;
      setProgress({ evaluated, processed: evaluated + failed + withoutTextCount, total });
      if (remaining === 0) break;
      if (handled === 0 || data.nextCursor === cursor) {
        stopped = { error: "La evaluación no avanzó. Intente nuevamente.", remaining };
        break;
      }
      cursor = data.nextCursor;
    }

    const finished: RunSummary = { evaluated, ocrRead, failed, withoutTextCount, withoutText, stopped };
    if (evaluated + failed + withoutTextCount > 0 || stopped) writeSummary(vacancyId, finished);
    setRunning(false);
    // La lista vuelve a verse sin filtros y ordenada por puntuación.
    router.replace(`/vacantes/${vacancyId}?tab=candidatos`);
    router.refresh();
  };

  const percent = progress.total > 0 ? Math.min(100, Math.round((progress.processed / progress.total) * 100)) : 0;

  if (!running && !summary && pending === 0) return null;

  return (
    <div className="space-y-3">
      {running ? (
        <div className="space-y-2 rounded-md border bg-card p-3 shadow-xs">
          <Progress value={percent} aria-label="Progreso de la evaluación" />
          <p className="text-sm" aria-live="polite">
            Evaluadas {progress.evaluated} de {progress.total}
          </p>
        </div>
      ) : null}

      {summary && !running ? (
        <Alert variant={summary.stopped ? "destructive" : "default"} data-testid="evaluate-pending-summary">
          <CheckCircle2Icon aria-hidden />
          <AlertTitle>
            {summary.stopped ? "La evaluación se detuvo" : "Evaluación terminada"}
          </AlertTitle>
          <AlertDescription className="space-y-2">
            {summary.stopped ? (
              <p>
                {summary.stopped.error} Quedaron {plural(summary.stopped.remaining, "postulación", "postulaciones")} sin evaluar.
              </p>
            ) : null}
            <p>
              Se {summary.evaluated === 1 ? "evaluó" : "evaluaron"} {plural(summary.evaluated, "postulación", "postulaciones")}; la
              lista está ordenada por compatibilidad.
            </p>
            {summary.ocrRead ? (
              <p>{plural(summary.ocrRead, "escaneado leído", "escaneados leídos")} automáticamente.</p>
            ) : null}
            {summary.withoutTextCount > 0 ? (
              <div>
                <p>{summary.withoutTextCount} sin texto legible (posiblemente escaneados):</p>
                <ul className="list-disc pl-5">
                  {summary.withoutText.map((item) => (
                    <li key={item.applicationId}>
                      <Link href={`/postulaciones/${item.applicationId}`} className="font-medium underline-offset-2 hover:underline">
                        {item.candidateName}
                      </Link>
                    </li>
                  ))}
                </ul>
                {summary.withoutTextCount > summary.withoutText.length ? (
                  <p>Y {summary.withoutTextCount - summary.withoutText.length} más.</p>
                ) : null}
              </div>
            ) : null}
            {summary.failed > 0 ? <p>{summary.failed} no se pudieron evaluar.</p> : null}
            <Button type="button" variant="outline" size="sm" onClick={() => writeSummary(vacancyId, null)}>
              Cerrar resumen
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {running || pending > 0 ? (
        criteriaApproved ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Button type="button" onClick={run} disabled={running} className="w-full sm:w-auto">
              <PlayIcon /> Evaluar pendientes ({running ? progress.total : pending})
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Hay {pending} {pending === 1 ? "postulación sin evaluar" : "postulaciones sin evaluar"}. Apruebe los criterios para evaluarlas.{" "}
            <Link href={`/vacantes/${vacancyId}?tab=criterios`} className="font-medium text-foreground underline underline-offset-2">
              Ir a los criterios
            </Link>
          </p>
        )
      ) : null}
    </div>
  );
}

function parseSummary(raw: string | null): RunSummary | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as RunSummary;
  } catch {
    return null;
  }
}

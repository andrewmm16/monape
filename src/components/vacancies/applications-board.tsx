"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ApplicationStatusBadge, CompatibilityBadge } from "@/components/common/badges";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { changeApplicationStatus } from "@/modules/applications/actions";
import { BOARD_COLUMNS, STATUSES_REQUIRING_REASON, type BoardApplication, type BoardColumn } from "@/modules/applications/schemas";
import type { Enums } from "@/types/database";

type Status = Enums<"application_status">;

const DRAG_MIME = "application/x-postulacion";
const requiresReason = (status: Status) => (STATUSES_REQUIRING_REASON as readonly string[]).includes(status);

/**
 * Avisa de cambios sin guardar: al cerrar o recargar la pestaña (diálogo nativo
 * del navegador) y al pulsar un enlace interno para ir a otra sección.
 */
function useUnsavedGuard(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as HTMLElement | null)?.closest?.("a");
      const href = anchor?.getAttribute("href");
      if (!anchor || !href || href.startsWith("#") || anchor.target === "_blank") return;
      if (/^[a-z]+:\/\//i.test(href) && !href.startsWith(window.location.origin)) return;
      const ok = window.confirm("Tienes cambios sin guardar en el tablero. Si sales ahora, se perderán. ¿Deseas salir de todos modos?");
      if (!ok) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [active]);
}

/**
 * Tablero tipo embudo de la pestaña Candidatos. Se arrastran las tarjetas entre
 * columnas libremente (cambios en local) y se guardan todos juntos con «Confirmar
 * cambios». Nada cambia en el proceso hasta confirmar: respeta que el estado solo
 * avanza cuando una persona lo decide y lo guarda. Pasar a «Descartados» exige un
 * motivo (regla de negocio); el resto de movimientos no lo necesita.
 */
export function ApplicationsBoard({ rows, canManage }: { rows: BoardApplication[]; canManage: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // id de la postulación -> estado destino pendiente (solo si difiere del real).
  const [moves, setMoves] = useState<ReadonlyMap<string, Status>>(new Map());
  const [reason, setReason] = useState("");

  const dirty = moves.size > 0;
  useUnsavedGuard(dirty);

  const effectiveStatus = (card: BoardApplication): Status | null => moves.get(card.id) ?? card.status;
  const columns = BOARD_COLUMNS.map((col) => ({
    col,
    cards: rows.filter((card) => {
      const status = effectiveStatus(card);
      return status !== null && col.statuses.includes(status);
    }),
  }));

  const discardMoves = [...moves.values()].filter(requiresReason).length;
  const reasonNeeded = discardMoves > 0;

  // Misma lógica para arrastrar y para «Mover a…» (útil en pantallas táctiles).
  const moveCard = (id: string, target: Status) => {
    const card = rows.find((row) => row.id === id);
    if (!canManage || !card) return;
    setMoves((current) => {
      const next = new Map(current);
      // Volver a la columna original cancela el movimiento pendiente.
      if (target === card.status) next.delete(id);
      else next.set(id, target);
      return next;
    });
  };

  const handleDrop = (col: BoardColumn, payload: string) => {
    if (!col.dropStatus) return;
    moveCard(payload.split("|")[0], col.dropStatus);
  };

  const revert = () => {
    setMoves(new Map());
    setReason("");
  };

  const confirm = () => {
    if (!dirty || (reasonNeeded && reason.trim().length === 0)) return;
    startTransition(async () => {
      const entries = [...moves.entries()];
      const results = await Promise.all(
        entries.map(([id, status]) =>
          changeApplicationStatus({
            applicationId: id,
            status,
            reason: requiresReason(status) ? reason : "",
            note: "",
            notifyCandidate: false,
          })
            .then((result) => ({ id, ok: result.ok, error: result.ok ? null : result.error }))
            .catch(() => ({ id, ok: false, error: "No se pudo guardar" })),
        ),
      );
      const failed = results.filter((result) => !result.ok);
      if (failed.length === 0) {
        toast.success(`${entries.length} cambio${entries.length === 1 ? "" : "s"} guardado${entries.length === 1 ? "" : "s"}.`);
        setMoves(new Map());
        setReason("");
      } else {
        // Conserva solo los que fallaron para reintentar.
        setMoves(new Map(failed.map((result) => [result.id, moves.get(result.id)!])));
        toast.error(`${failed.length} cambio${failed.length === 1 ? "" : "s"} no se pudo guardar. Inténtalo de nuevo.`);
      }
      router.refresh();
    });
  };

  return (
    <>
      <div className={cn("flex gap-3 overflow-x-auto pb-2", dirty ? "mb-28" : "")}>
        {columns.map(({ col, cards }) => (
          <section
            key={col.key}
            onDragOver={(event) => {
              if (canManage && col.dropStatus) event.preventDefault();
            }}
            onDrop={(event) => {
              event.preventDefault();
              handleDrop(col, event.dataTransfer.getData(DRAG_MIME) || event.dataTransfer.getData("text/plain"));
            }}
            className="flex w-64 shrink-0 flex-col gap-2 rounded-lg border bg-muted/30 p-2"
          >
            <header className="flex items-center justify-between px-1 py-0.5 text-sm font-medium">
              <span>{col.label}</span>
              <span className="tabular-nums text-muted-foreground">{cards.length}</span>
            </header>
            <div className="flex min-h-16 flex-col gap-2">
              {cards.map((card) => {
                const moved = moves.has(card.id);
                return (
                  <article
                    key={card.id}
                    draggable={canManage}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData(DRAG_MIME, card.id);
                      event.dataTransfer.setData("text/plain", card.id);
                    }}
                    className={cn(
                      "rounded-md border bg-card p-2 shadow-xs transition-colors",
                      canManage ? "cursor-grab active:cursor-grabbing hover:border-brand/50" : "",
                      moved ? "border-brand ring-2 ring-brand/30" : "",
                    )}
                  >
                    <div className="flex items-start justify-between gap-1">
                      <Link href={`/postulaciones/${card.id}`} className="text-sm font-medium hover:underline">
                        {card.candidate_name ?? "Candidato"}
                      </Link>
                      {moved ? <span className="mt-0.5 shrink-0 text-[10px] font-medium text-brand">movido</span> : null}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      {card.evaluation_id ? (
                        <span className="text-sm font-semibold tabular-nums">{formatPercent(card.score)}</span>
                      ) : null}
                      <CompatibilityBadge level={card.level} />
                      {col.key === "descartados" && card.status ? <ApplicationStatusBadge status={card.status} /> : null}
                    </div>
                    {canManage ? (
                      <label className="relative mt-2 block">
                        <span className="sr-only">Mover a {card.candidate_name ?? "candidato"}</span>
                        <NativeSelect
                          size="sm"
                          className="w-full"
                          value=""
                          onChange={(event) => {
                            const target = event.target.value as Status;
                            if (target) moveCard(card.id, target);
                          }}
                        >
                          <NativeSelectOption value="">Mover a…</NativeSelectOption>
                          {BOARD_COLUMNS.filter((other) => other.dropStatus && other.key !== col.key).map((other) => (
                            <NativeSelectOption key={other.key} value={other.dropStatus!}>
                              {other.label}
                            </NativeSelectOption>
                          ))}
                        </NativeSelect>
                      </label>
                    ) : null}
                  </article>
                );
              })}
              {cards.length === 0 ? <p className="px-1 py-3 text-center text-xs text-muted-foreground">Sin candidatos</p> : null}
            </div>
          </section>
        ))}
      </div>

      {canManage && !dirty ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Arrastre las tarjetas entre columnas o use «Mover a…» en cada una; abajo podrá confirmar todos los cambios juntos. «Evaluación post-entrevista» la
          asigna la entrevista, no se arrastra.
        </p>
      ) : null}

      {dirty ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 px-4 py-3 shadow-[0_-2px_12px_rgba(0,0,0,0.08)] backdrop-blur">
          <div className="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0 flex-1 space-y-2">
              <p className="text-sm font-medium">
                {moves.size} cambio{moves.size === 1 ? "" : "s"} sin guardar
                {discardMoves > 0 ? ` · ${discardMoves} a Descartados` : ""}
              </p>
              {reasonNeeded ? (
                <Field>
                  <FieldLabel htmlFor="board-reason">Motivo del descarte (obligatorio)</FieldLabel>
                  <Textarea
                    id="board-reason"
                    rows={2}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="Se registrará como motivo para quienes pasan a Descartados."
                  />
                  <FieldDescription>Se aplica a los {discardMoves} candidatos que mueves a Descartados. La decisión es de RRHH.</FieldDescription>
                </Field>
              ) : null}
            </div>
            <div className="flex shrink-0 gap-2">
              <Button type="button" variant="outline" onClick={revert} disabled={pending}>
                Descartar cambios
              </Button>
              <Button type="button" onClick={confirm} disabled={pending || (reasonNeeded && reason.trim().length === 0)}>
                {pending ? "Guardando…" : "Confirmar cambios"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

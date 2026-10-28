"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BellIcon, BellRingIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { markNotificationsRead } from "@/modules/notifications/actions";
import type { NotificationFeed, NotificationItem } from "@/modules/notifications/queries";

const POLL_MS = 60_000;
const ANNOUNCED_KEY = "notificaciones-anunciadas";

const AMBER_TOAST =
  "border-amber-400! bg-amber-50! text-amber-950! dark:border-amber-700! dark:bg-amber-950! dark:text-amber-50!";

function describe(item: NotificationItem): { title: string; detail: string } {
  const candidate = item.candidateName ?? "una postulación";
  const detail = item.vacancyTitle ? `${candidate} · ${item.vacancyTitle}` : candidate;
  return item.kind === "opinion_solicitada"
    ? { title: `${item.actorName ?? "RRHH"} le pidió su opinión`, detail }
    : { title: `${item.actorName ?? "La persona consultada"} respondió su solicitud de opinión`, detail };
}

// Avisos ya mostrados en esta sesión del navegador (para no repetirlos al navegar).
function readAnnounced(): Set<number> {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(ANNOUNCED_KEY) ?? "[]") as number[]);
  } catch {
    return new Set();
  }
}

function saveAnnounced(ids: Set<number>) {
  try {
    sessionStorage.setItem(ANNOUNCED_KEY, JSON.stringify([...ids].slice(-200)));
  } catch {
    // Sin almacenamiento disponible: el aviso podría repetirse, nada más.
  }
}

export function NotificationBell({ initial }: { initial: NotificationFeed }) {
  const router = useRouter();
  const [feed, setFeed] = useState(initial);
  // Al refrescarse el layout llega un `initial` nuevo: se adopta.
  const [previousInitial, setPreviousInitial] = useState(initial);
  if (initial !== previousInitial) {
    setPreviousInitial(initial);
    setFeed(initial);
  }

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const response = await fetch("/api/notificaciones", { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as NotificationFeed;
        if (!cancelled) setFeed(data);
      } catch {
        // Sin conexión: se reintenta en el siguiente ciclo.
      }
    };
    const timer = setInterval(load, POLL_MS);
    window.addEventListener("focus", load);
    document.addEventListener("visibilitychange", load);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("focus", load);
      document.removeEventListener("visibilitychange", load);
    };
  }, []);

  const open = (item: NotificationItem) => {
    if (!item.read) {
      setFeed((current) => ({
        unread: Math.max(0, current.unread - 1),
        items: current.items.map((i) => (i.id === item.id ? { ...i, read: true } : i)),
      }));
      void markNotificationsRead([item.id]);
    }
    router.push(`/postulaciones/${item.applicationId}`);
  };

  const markAll = () => {
    setFeed((current) => ({ unread: 0, items: current.items.map((i) => ({ ...i, read: true })) }));
    void markNotificationsRead();
  };

  // Aviso amarillo, una vez por notificación nueva.
  useEffect(() => {
    const announced = readAnnounced();
    const fresh = feed.items.filter((item) => !item.read && !announced.has(item.id));
    if (fresh.length === 0) return;
    for (const item of fresh.slice(0, 3)) {
      const { title, detail } = describe(item);
      toast(title, {
        id: `notificacion-${item.id}`,
        description: detail,
        icon: <BellRingIcon className="size-4" />,
        duration: 12_000,
        className: AMBER_TOAST,
        action: { label: "Ver", onClick: () => open(item) },
      });
    }
    if (fresh.length > 3) {
      toast(`Tiene ${fresh.length - 3} notificaciones más`, {
        icon: <BellRingIcon className="size-4" />,
        className: AMBER_TOAST,
      });
    }
    for (const item of fresh) announced.add(item.id);
    saveAnnounced(announced);
    // `open` cambia en cada render y solo se usa al pulsar «Ver».
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed.items]);

  const hasUnread = feed.unread > 0;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={hasUnread ? `Notificaciones: ${feed.unread} sin leer` : "Notificaciones"}
          className={cn(
            "relative",
            hasUnread &&
              "bg-amber-400 text-amber-950 ring-2 ring-amber-300 hover:bg-amber-300 hover:text-amber-950 dark:bg-amber-400 dark:text-amber-950",
          )}
        >
          {hasUnread ? <BellRingIcon /> : <BellIcon />}
          {hasUnread ? (
            <span className="absolute -top-1.5 -right-1.5 flex min-w-5 items-center justify-center rounded-full bg-amber-600 px-1 text-[11px] leading-5 font-semibold text-white tabular-nums">
              {feed.unread > 9 ? "9+" : feed.unread}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[min(22rem,calc(100vw-2rem))]">
        <DropdownMenuLabel className="flex items-center justify-between gap-2">
          <span>Notificaciones</span>
          {hasUnread ? (
            <button type="button" onClick={markAll} className="text-xs font-normal text-muted-foreground hover:underline">
              Marcar todas como leídas
            </button>
          ) : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {feed.items.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">No tiene notificaciones.</p>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            {feed.items.map((item) => {
              const { title, detail } = describe(item);
              return (
                <DropdownMenuItem
                  key={item.id}
                  onSelect={() => open(item)}
                  className={cn(
                    "flex flex-col items-start gap-0.5 border-l-4 border-transparent py-2",
                    !item.read && "border-amber-400 bg-amber-50 dark:bg-amber-950/60",
                  )}
                >
                  <span className={cn("text-sm", !item.read && "font-medium")}>{title}</span>
                  <span className="text-xs text-muted-foreground">{detail}</span>
                  <span className="text-xs text-muted-foreground">{formatDateTime(item.createdAt)}</span>
                </DropdownMenuItem>
              );
            })}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

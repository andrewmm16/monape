"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Cada cuánto se vuelve a consultar la página mientras la IA trabaja. */
const REFRESH_MS = 15_000;

/**
 * Estado de la evaluación con IA en cola. Mientras el trabajo está abierto
 * (en cola o procesándose) refresca la página para mostrar el resultado en
 * cuanto el worker lo registra.
 */
export function AiJobStatus({ message, tone, active }: { message: string; tone: "info" | "warning"; active: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => router.refresh(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [active, router]);

  return (
    <p
      role="status"
      className={
        tone === "warning"
          ? "rounded-md border border-warning-foreground/40 bg-warning px-3 py-2 text-sm text-warning-foreground"
          : "text-sm text-muted-foreground"
      }
    >
      {message}
    </p>
  );
}

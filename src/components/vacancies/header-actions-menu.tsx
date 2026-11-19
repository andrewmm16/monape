"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { MoreHorizontalIcon } from "lucide-react";

/**
 * Menú «⋯» de las acciones secundarias del encabezado en el celular. Es un
 * `<details>` y no un menú de Radix a propósito: los botones de dentro abren su
 * propia confirmación (cerrar, archivar) y deben seguir montados al cerrarse.
 */
export function HeaderActionsMenu({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const close = (event: Event) => {
      const el = ref.current;
      if (!el?.open) return;
      if (event instanceof KeyboardEvent) {
        if (event.key === "Escape") el.open = false;
      } else if (event.target instanceof Node && !el.contains(event.target)) {
        el.open = false;
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, []);

  return (
    <details ref={ref} className="group relative">
      <summary
        aria-label="Más acciones"
        className="flex size-11 cursor-pointer list-none items-center justify-center rounded-lg border bg-background shadow-xs hover:bg-accent group-open:bg-accent [&::-webkit-details-marker]:hidden"
      >
        <MoreHorizontalIcon className="size-4" aria-hidden />
      </summary>
      <div className="absolute right-0 z-30 mt-1 flex w-56 flex-col gap-1.5 rounded-lg bg-popover p-2 shadow-md ring-1 ring-foreground/10 [&_a]:w-full [&_button]:w-full [&_a]:justify-start [&_button]:justify-start">
        {children}
      </div>
    </details>
  );
}

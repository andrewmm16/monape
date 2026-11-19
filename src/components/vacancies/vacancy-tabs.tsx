"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Pestañas de la vacante en una sola fila. Si no caben (celular), se desplazan
 * en horizontal, un degradado en el borde derecho avisa de que hay más y la
 * pestaña activa se acerca a la vista solo si estaba cortada.
 */
export function VacancyTabs({
  vacancyId,
  tabs,
  active,
}: {
  vacancyId: string;
  tabs: ReadonlyArray<{ id: string; label: string }>;
  active: string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [moreRight, setMoreRight] = useState(false);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const update = () => setMoreRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
    const current = el.querySelector<HTMLElement>("[aria-current='page']");
    if (current) {
      const box = el.getBoundingClientRect();
      const item = current.getBoundingClientRect();
      if (item.left < box.left || item.right > box.right) current.scrollIntoView({ block: "nearest", inline: "center" });
    }
    update();
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [active]);

  return (
    <div className="relative border-b">
      <nav ref={scroller} className="flex flex-nowrap overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="Secciones de la vacante">
        {tabs.map((item) => (
          <Link
            key={item.id}
            href={`/vacantes/${vacancyId}?tab=${item.id}`}
            aria-current={active === item.id ? "page" : undefined}
            className={cn(
              "-mb-px shrink-0 border-b-2 px-3 py-2.5 text-sm whitespace-nowrap",
              active === item.id ? "border-brand font-medium text-brand" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-background to-transparent transition-opacity",
          moreRight ? "opacity-100" : "opacity-0",
        )}
      />
    </div>
  );
}

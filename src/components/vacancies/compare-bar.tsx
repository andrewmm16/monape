"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { MAX_COMPARED, MIN_COMPARED } from "@/modules/applications/ranking";

/** Nombre de las casillas de la tabla de candidatos que alimentan esta barra. */
export const COMPARE_CHECKBOX_NAME = "compare";

/**
 * Barra «Comparar seleccionados (n)»: cuenta las casillas marcadas en la tabla
 * (que es un componente de servidor) y abre la comparación con 2 a 4 elegidos.
 */
export function CompareBar({ vacancyId }: { vacancyId: string }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    const boxes = () => Array.from(document.querySelectorAll<HTMLInputElement>(`input[name="${COMPARE_CHECKBOX_NAME}"]`));
    const sync = () => {
      const checked = boxes().filter((box) => box.checked);
      setSelected(checked.map((box) => box.value));
      // Con el máximo marcado, el resto no se puede elegir.
      for (const box of boxes()) box.disabled = !box.checked && checked.length >= MAX_COMPARED;
    };
    document.addEventListener("change", sync);
    sync();
    return () => document.removeEventListener("change", sync);
  }, []);

  const valid = selected.length >= MIN_COMPARED && selected.length <= MAX_COMPARED;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!valid}
        onClick={() => router.push(`/vacantes/${vacancyId}/comparar?ids=${selected.join(",")}`)}
      >
        Comparar seleccionados ({selected.length})
      </Button>
      <span className="text-xs text-muted-foreground">
        Marque de {MIN_COMPARED} a {MAX_COMPARED} candidatos evaluados.
      </span>
    </div>
  );
}

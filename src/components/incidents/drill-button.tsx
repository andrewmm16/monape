"use client";

import { useRouter } from "next/navigation";
import { ActionButton } from "@/components/common/action-button";
import { startDrill } from "@/modules/incidents/actions";

/** Crea el simulacro sugerido por la política y abre su detalle. */
export function DrillButton() {
  const router = useRouter();
  return (
    <ActionButton
      variant="outline"
      action={async () => {
        const result = await startDrill();
        if (result.ok) router.push(`/configuracion/incidentes/${result.data.id}`);
        return result;
      }}
      confirm={{
        title: "¿Iniciar el simulacro?",
        description:
          "Se crea un incidente de práctica, marcado como SIMULACRO: «la clave del worker de IA apareció en un chat», gravedad alta. No cuenta en el aviso del panel.",
        confirmLabel: "Iniciar simulacro",
      }}
    >
      Iniciar simulacro
    </ActionButton>
  );
}

"use client";

import { ActionButton } from "@/components/common/action-button";
import { setCandidatePortalEnabled } from "@/modules/candidate-portal/actions";

export function CandidatePortalToggle({ enabled }: { enabled: boolean }) {
  return enabled ? (
    <ActionButton
      variant="outline"
      action={() => setCandidatePortalEnabled(false)}
      confirm={{
        title: "¿Apagar el portal del candidato?",
        description: "Los enlaces ya enviados dejarán de mostrar el estado hasta que lo vuelva a encender.",
        confirmLabel: "Apagar",
      }}
    >
      Apagar
    </ActionButton>
  ) : (
    <ActionButton
      action={() => setCandidatePortalEnabled(true)}
      confirm={{
        title: "¿Encender el portal del candidato?",
        description:
          "RRHH podrá generar enlaces de seguimiento desde la ficha de cada candidato. Confirme antes con RRHH qué se muestra.",
        confirmLabel: "Encender",
      }}
    >
      Encender
    </ActionButton>
  );
}

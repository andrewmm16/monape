"use client";

import { ActionButton } from "@/components/common/action-button";
import { anonymizeCandidate } from "@/modules/candidates/actions";

export function AnonymizeCandidateButton({ candidateId, name }: { candidateId: string; name: string }) {
  return (
    <ActionButton
      size="sm"
      variant="destructive"
      action={() => anonymizeCandidate(candidateId)}
      confirm={{
        title: `¿Anonimizar a ${name}?`,
        description:
          "Se borran su nombre, correo, teléfono, CV y perfil, y los textos con datos personales de su historial. Sus postulaciones quedan como registro anónimo para los reportes. No se puede deshacer.",
        confirmLabel: "Anonimizar",
      }}
    >
      Anonimizar
    </ActionButton>
  );
}

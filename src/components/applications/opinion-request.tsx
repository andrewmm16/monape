"use client";

import { useState } from "react";
import { BellRingIcon } from "lucide-react";
import { ActionButton } from "@/components/common/action-button";
import { Badge } from "@/components/ui/badge";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { formatDateTime } from "@/lib/format";
import { requestOpinion } from "@/modules/applications/actions";

export type OpinionState = {
  profileId: string | null;
  name: string | null;
  requestedBy: string | null;
  requestedAt: string | null;
  answeredAt: string | null;
};

function OpinionStatus({ opinion, isMe }: { opinion: OpinionState; isMe: boolean }) {
  if (!opinion.profileId) return <p className="text-sm text-muted-foreground">No se pidió la opinión de nadie.</p>;
  return (
    <div className="space-y-1 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{opinion.name ?? "Persona sin acceso"}</span>
        {opinion.answeredAt ? (
          <Badge variant="secondary">Respondida</Badge>
        ) : (
          <Badge className="bg-amber-100 text-amber-950 dark:bg-amber-900 dark:text-amber-50">Pendiente</Badge>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {opinion.requestedAt ? `Solicitada el ${formatDateTime(opinion.requestedAt)}` : "Solicitada"}
        {opinion.requestedBy ? ` por ${opinion.requestedBy}` : ""}
        {opinion.answeredAt ? ` · respondida el ${formatDateTime(opinion.answeredAt)}` : ""}
      </p>
      {isMe && !opinion.answeredAt ? (
        <p className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-50">
          <BellRingIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          Le pidieron su opinión. Regístrela como observación en «Observaciones e historial».
        </p>
      ) : null}
    </div>
  );
}

/** Pide, repite o retira la solicitud de opinión. */
export function OpinionRequest({
  applicationId,
  opinion,
  people,
  isMe,
}: {
  applicationId: string;
  opinion: OpinionState;
  people: { id: string; full_name: string }[];
  /** La persona consultada es quien está viendo la postulación. */
  isMe: boolean;
}) {
  const [value, setValue] = useState(opinion.profileId ?? "");
  const samePerson = value === (opinion.profileId ?? "");
  const pendingRequest = Boolean(opinion.profileId && !opinion.answeredAt);

  return (
    <div className="space-y-3">
      <OpinionStatus opinion={opinion} isMe={isMe} />
      <div className="flex flex-col gap-2 sm:flex-row">
        <NativeSelect
          aria-label="Pedir opinión a"
          className="w-full sm:w-64"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        >
          <NativeSelectOption value="">Pedir opinión a…</NativeSelectOption>
          {people.map((person) => (
            <NativeSelectOption key={person.id} value={person.id}>
              {person.full_name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <ActionButton
          variant="outline"
          disabled={!value || (samePerson && pendingRequest)}
          action={() => requestOpinion(applicationId, value)}
        >
          <BellRingIcon /> {samePerson && opinion.answeredAt ? "Pedir de nuevo" : "Pedir opinión"}
        </ActionButton>
      </div>
      {pendingRequest ? (
        <ActionButton
          size="sm"
          variant="ghost"
          action={() => requestOpinion(applicationId, null)}
          confirm={{
            title: "¿Retirar la solicitud de opinión?",
            description: "La persona dejará de verla como pendiente y su notificación sin leer se eliminará.",
            confirmLabel: "Retirar",
          }}
        >
          Retirar solicitud
        </ActionButton>
      ) : null}
      <p className="text-xs text-muted-foreground">
        La persona recibe una notificación. La solicitud queda respondida cuando registra una observación en esta postulación.
      </p>
    </div>
  );
}

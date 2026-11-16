"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ActionButton } from "@/components/common/action-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { CALETA_STATUS_LABELS } from "@/lib/labels";
import {
  changeProspectStatus,
  deleteProspect,
  deriveProspect,
  markProspectConnected,
  markProspectContacted,
  rescoreProspect,
  updateProspectContact,
} from "@/modules/caleta/actions";
import { SELECTABLE_CALETA_STATUSES } from "@/modules/caleta/schemas";
import type { Enums } from "@/types/database";

type Props = {
  id: string;
  status: Enums<"caleta_status">;
  phone: string | null;
  email: string | null;
  derived: boolean;
  canDelete: boolean;
  canDerive: boolean;
  linkedinUrl: string | null;
  /** Mensaje directo para cuando la persona acepte la invitación de LinkedIn. */
  contactNote: string;
  contactChannel: Enums<"caleta_contact_channel"> | null;
};

export function ProspectActions({
  id,
  status,
  phone,
  email,
  derived,
  canDelete,
  canDerive,
  linkedinUrl,
  contactNote,
  contactChannel,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [phoneValue, setPhoneValue] = useState(phone ?? "");
  const [emailValue, setEmailValue] = useState(email ?? "");

  const openProfile = () => {
    if (linkedinUrl) window.open(linkedinUrl, "_blank", "noopener,noreferrer");
  };
  const copyMessage = async () => {
    try {
      await navigator.clipboard.writeText(contactNote);
      return true;
    } catch {
      return false; // el navegador puede bloquear el portapapeles; igual se abre el perfil
    }
  };

  // Con LinkedIn gratuito no se puede escribir a quien no es contacto: primero se
  // invita SIN nota (las notas gratis son pocas) y se registra la invitación.
  const onInvite = () =>
    startTransition(async () => {
      openProfile();
      const result = await markProspectContacted({ id, channel: "linkedin" });
      if (result.ok) {
        toast.success("Perfil abierto: pulsa «Conectar» (o «Más» → «Conectar») y «Enviar sin nota».");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });

  // Aceptó la invitación: ya es contacto y el mensaje directo es gratis.
  const onAccepted = () =>
    startTransition(async () => {
      const copied = await copyMessage();
      openProfile();
      const result = await markProspectConnected({ id, message: contactNote });
      if (result.ok) {
        toast.success(
          `${
            copied
              ? "Mensaje copiado. En el perfil pulsa «Mensaje» y pégalo."
              : "No se pudo copiar el mensaje; ábrelo desde el perfil y escríbelo."
          } Mira también «Información de contacto»: ahora que es tu contacto puede mostrar su celular o correo; guárdalos aquí.`,
        );
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });

  const onCopyAgain = () =>
    startTransition(async () => {
      const copied = await copyMessage();
      openProfile();
      if (copied) toast.success("Mensaje copiado.");
    });

  const invitePending = status === "contactado" && contactChannel === "linkedin";

  const onStatusChange = (next: string) =>
    startTransition(async () => {
      const result = await changeProspectStatus({ id, status: next as (typeof SELECTABLE_CALETA_STATUSES)[number] });
      if (result.ok) {
        if (result.message) toast.success(result.message);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });

  const onSaveContact = () =>
    startTransition(async () => {
      const result = await updateProspectContact({ id, phone: phoneValue, email: emailValue });
      if (result.ok) {
        if (result.message) toast.success(result.message);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });

  return (
    <div className="flex w-full flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor={`status-${id}`} className="text-xs font-medium text-muted-foreground">
          Estado
        </label>
        <NativeSelect
          id={`status-${id}`}
          className="w-full"
          value={derived ? "" : status}
          disabled={derived || pending}
          onChange={(event) => onStatusChange(event.target.value)}
        >
          {derived ? (
            <NativeSelectOption value="">{CALETA_STATUS_LABELS.derivado}</NativeSelectOption>
          ) : (
            SELECTABLE_CALETA_STATUSES.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {CALETA_STATUS_LABELS[value]}
              </NativeSelectOption>
            ))
          )}
        </NativeSelect>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-muted-foreground">Contacto (se guarda como dato declarado)</span>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            aria-label="Teléfono"
            placeholder="+51 9…"
            value={phoneValue}
            onChange={(event) => setPhoneValue(event.target.value)}
            disabled={pending}
          />
          <Input
            aria-label="Correo"
            type="email"
            placeholder="correo@…"
            value={emailValue}
            onChange={(event) => setEmailValue(event.target.value)}
            disabled={pending}
          />
          <Button type="button" variant="outline" onClick={onSaveContact} disabled={pending}>
            Guardar
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {linkedinUrl && !derived ? (
          status === "encontrado" ? (
            <Button type="button" size="sm" onClick={onInvite} disabled={pending}>
              Conectar en LinkedIn
            </Button>
          ) : invitePending ? (
            <>
              <Button type="button" size="sm" onClick={onAccepted} disabled={pending}>
                Aceptó: copiar mensaje
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={openProfile} disabled={pending}>
                Abrir perfil
              </Button>
            </>
          ) : (
            <Button type="button" size="sm" variant="outline" onClick={onCopyAgain} disabled={pending}>
              Abrir perfil + copiar mensaje
            </Button>
          )
        ) : null}
        <ActionButton action={() => rescoreProspect(id)} variant="outline" size="sm" pendingLabel="Puntuando…">
          Re-puntuar
        </ActionButton>
        {canDerive ? (
          <ActionButton
            action={() => deriveProspect(id)}
            size="sm"
            disabled={derived}
            confirm={{
              title: "Derivar a candidato",
              description:
                "Se creará un candidato con estos datos y su postulación a la vacante, y el prospecto quedará como «derivado». ¿Continuar?",
              confirmLabel: "Derivar",
            }}
          >
            {derived ? "Ya derivado" : "Derivar a candidato"}
          </ActionButton>
        ) : derived ? (
          <span className="self-center text-xs text-muted-foreground">Ya derivado</span>
        ) : null}
        {canDelete ? (
          <ActionButton
            action={() => deleteProspect(id)}
            variant="ghost"
            size="sm"
            confirm={{
              title: "Eliminar prospecto",
              description: "Esta acción no se puede deshacer. ¿Eliminar el prospecto?",
              confirmLabel: "Eliminar",
            }}
          >
            Eliminar
          </ActionButton>
        ) : null}
      </div>
    </div>
  );
}

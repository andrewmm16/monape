"use client";

import { useTransition } from "react";
import { CopyIcon } from "lucide-react";
import { toast } from "sonner";
import { ActionButton } from "@/components/common/action-button";
import { Button } from "@/components/ui/button";
import { cancelBooking, renewBookingLink } from "@/modules/interviews/actions";

/**
 * Estado de la invitación a agendar en la tarjeta «Entrevistas».
 * - Pendiente: cuántos horarios y hasta cuándo puede elegir; «Copiar enlace
 *   nuevo» (el anterior deja de funcionar: la base guarda solo su hash) y «Cancelar».
 * - Vencida: la persona no eligió a tiempo.
 */
export function BookingStatus({
  offerId,
  state,
  slotCount,
  expiresAtLabel,
}: {
  offerId: string;
  state: "pendiente" | "vencida";
  slotCount: number;
  expiresAtLabel: string;
}) {
  const [pending, startTransition] = useTransition();

  if (state === "vencida") {
    return (
      <p className="rounded-md border border-warning-foreground/40 bg-warning px-3 py-2 text-sm text-warning-foreground" data-testid="booking-status">
        La persona no eligió horario: la invitación a agendar venció el {expiresAtLabel}.
      </p>
    );
  }

  function copyNewLink() {
    startTransition(async () => {
      const result = await renewBookingLink(offerId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      try {
        await navigator.clipboard.writeText(result.data.url);
        toast.success(result.message ?? "Enlace nuevo copiado.");
      } catch {
        toast.message("Enlace nuevo (el anterior dejó de funcionar):", { description: result.data.url });
      }
    });
  }

  return (
    <div className="space-y-2 rounded-md border border-brand/30 bg-brand/5 p-3" data-testid="booking-status">
      <p className="text-sm">
        <span className="font-medium">Invitación a agendar pendiente:</span> {slotCount === 1 ? "1 horario" : `${slotCount} horarios`}; puede
        elegir hasta el {expiresAtLabel}.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={copyNewLink} disabled={pending}>
          <CopyIcon /> {pending ? "Generando…" : "Copiar enlace nuevo"}
        </Button>
        <ActionButton
          variant="outline"
          size="sm"
          className="text-destructive"
          action={() => cancelBooking(offerId)}
          confirm={{
            title: "¿Cancelar la invitación a agendar?",
            description: "El enlace deja de funcionar y la persona ya no podrá elegir horario.",
            confirmLabel: "Cancelar invitación",
          }}
        >
          Cancelar invitación
        </ActionButton>
      </div>
    </div>
  );
}

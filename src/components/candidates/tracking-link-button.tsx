"use client";

import { useState, useTransition } from "react";
import { CopyIcon, LinkIcon, RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getTrackingLink } from "@/modules/candidate-portal/actions";

/**
 * Enlace privado con el que la persona candidata consulta su etapa. Es el mismo
 * que va en sus correos; «Renovar» genera otro y anula el anterior.
 */
export function TrackingLinkButton({ applicationId }: { applicationId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [confirmRenew, setConfirmRenew] = useState(false);
  const [pending, startTransition] = useTransition();

  const load = (renew: boolean) =>
    startTransition(async () => {
      const result = await getTrackingLink(applicationId, renew);
      setConfirmRenew(false);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setUrl(result.data.url);
      if (result.message) toast.success(result.message);
    });

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Enlace copiado.");
    } catch {
      toast.error("No se pudo copiar: selecciónelo y cópielo a mano.");
    }
  };

  if (!url) {
    return (
      <Button type="button" size="sm" variant="outline" onClick={() => load(false)} disabled={pending}>
        <LinkIcon /> {pending ? "Cargando…" : "Enlace de seguimiento"}
      </Button>
    );
  }
  return (
    <div className="flex w-full flex-wrap items-center gap-1 sm:w-auto">
      <Input readOnly value={url} aria-label="Enlace de seguimiento" className="h-8 min-w-0 text-xs sm:w-64" onFocus={(e) => e.currentTarget.select()} />
      <Button type="button" size="sm" variant="outline" onClick={copy} aria-label="Copiar enlace">
        <CopyIcon />
      </Button>
      {confirmRenew ? (
        <>
          <span className="text-xs text-muted-foreground">¿Anular el enlace actual?</span>
          <Button type="button" size="sm" variant="destructive" onClick={() => load(true)} disabled={pending}>
            Sí, renovar
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmRenew(false)} disabled={pending}>
            No
          </Button>
        </>
      ) : (
        <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmRenew(true)} aria-label="Renovar enlace">
          <RefreshCwIcon />
        </Button>
      )}
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { CopyIcon, LinkIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createTrackingLink } from "@/modules/candidate-portal/actions";

/** Genera el enlace privado con el que la persona candidata consulta su etapa. */
export function TrackingLinkButton({ applicationId }: { applicationId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const generate = () =>
    startTransition(async () => {
      const result = await createTrackingLink(applicationId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setUrl(result.data.url);
      toast.success(result.message ?? "Enlace generado.");
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
      <Button type="button" size="sm" variant="outline" onClick={generate} disabled={pending}>
        <LinkIcon /> {pending ? "Generando…" : "Enlace de seguimiento"}
      </Button>
    );
  }
  return (
    <div className="flex w-full items-center gap-1 sm:w-auto">
      <Input readOnly value={url} aria-label="Enlace de seguimiento" className="h-8 min-w-0 text-xs sm:w-64" onFocus={(e) => e.currentTarget.select()} />
      <Button type="button" size="sm" variant="outline" onClick={copy} aria-label="Copiar enlace">
        <CopyIcon />
      </Button>
    </div>
  );
}

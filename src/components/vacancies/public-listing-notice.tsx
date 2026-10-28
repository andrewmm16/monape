"use client";

import { CopyIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/** Enlace a la página pública de la vacante, con botón para copiarlo. */
export function PublicLink({ url }: { url: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <a href={url} target="_blank" rel="noreferrer" className="text-sm break-all underline">
        {url}
      </a>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          navigator.clipboard.writeText(url).then(
            () => toast.success("Enlace copiado."),
            () => toast.error("No se pudo copiar el enlace."),
          );
        }}
      >
        <CopyIcon /> Copiar
      </Button>
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { startBatch } from "@/modules/intake/actions";

type Portal = { id: string; name: string; kind: "automatico" | "manual" };

/** Paso 1: elegir el portal de origen y abrir el lote. */
export function PortalPicker({ vacancyId, portals }: { vacancyId: string; portals: Portal[] }) {
  const [portalId, setPortalId] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!portalId) return;
    startTransition(async () => {
      const result = await startBatch({ vacancyId, portalId });
      if (result.ok) router.refresh();
      else toast.error(result.error);
    });
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <Field className="sm:max-w-sm">
        <FieldLabel htmlFor="portal">Portal de origen de los CV</FieldLabel>
        <NativeSelect id="portal" value={portalId} onChange={(event) => setPortalId(event.target.value)} className="w-full">
          <NativeSelectOption value="">Seleccione un portal</NativeSelectOption>
          {portals.map((portal) => (
            <NativeSelectOption key={portal.id} value={portal.id}>
              {portal.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <FieldDescription>Todos los archivos del lote se registrarán con este portal.</FieldDescription>
      </Field>
      <Button type="submit" disabled={!portalId || pending}>
        {pending ? "Abriendo…" : "Iniciar lote"}
      </Button>
    </form>
  );
}

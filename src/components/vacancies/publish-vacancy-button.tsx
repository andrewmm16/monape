"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { publishVacancy } from "@/modules/vacancies/actions";

/**
 * Último paso del proceso: publica la vacante y, en el mismo momento, la envía a
 * los portales marcados. Con requisitos o criterios pendientes queda deshabilitado
 * y explica qué falta (el servidor lo vuelve a comprobar).
 */
export function PublishVacancyButton({
  vacancyId,
  portals,
  blockers,
  reopen,
}: {
  vacancyId: string;
  portals: { id: string; name: string }[];
  blockers: string[];
  reopen: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const blocked = blockers.length > 0;
  const label = reopen ? "Reabrir y publicar" : "Publicar";

  const toggle = (id: string, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const run = () =>
    startTransition(async () => {
      const result = await publishVacancy(vacancyId, [...selected]);
      if (result.ok) {
        setOpen(false);
        toast.success(result.message ?? "Vacante publicada.");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });

  return (
    <div className="flex flex-col items-end gap-1">
      <Button type="button" disabled={blocked} onClick={() => setOpen(true)}>
        {label}
      </Button>
      {blocked ? <p className="max-w-64 text-right text-xs text-muted-foreground">Falta: {blockers.join(" ")}</p> : null}
      <AlertDialog open={open} onOpenChange={(value) => !pending && setOpen(value)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿{label}?</AlertDialogTitle>
            <AlertDialogDescription>
              La vacante se publicará en la página pública, en Google y en los buscadores de empleo, salvo que sea confidencial.
              {portals.length > 0
                ? " Marque además los portales de empleo donde el robot debe publicarla (opcional; puede cambiarlos luego en la pestaña Portales)."
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {portals.length > 0 ? (
            <ul className="grid grid-cols-2 gap-2">
              {portals.map((portal) => (
                <li key={portal.id} className="flex items-center gap-2">
                  <Checkbox
                    id={`publicar-${portal.id}`}
                    checked={selected.has(portal.id)}
                    onCheckedChange={(value) => toggle(portal.id, value === true)}
                  />
                  <Label htmlFor={`publicar-${portal.id}`}>{portal.name}</Label>
                </li>
              ))}
            </ul>
          ) : null}
          {selected.size > 0 ? (
            <p className="text-xs text-muted-foreground">
              El robot trabaja desde la cuenta de la empresa en cada portal: confirme que la empresa autorizó la automatización.
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
            <Button type="button" onClick={run} disabled={pending}>
              {pending ? "Publicando…" : label}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

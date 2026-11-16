"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { deleteArchivedVacancyCascade } from "@/modules/vacancies/actions";

/**
 * Borrado en cascada de una vacante archivada (solo admin). Confirmación fuerte:
 * muestra cuántas postulaciones se eliminarán y exige marcar una casilla antes de
 * habilitar el botón. En caso de éxito la acción redirige a /vacantes.
 */
export function DeleteArchivedVacancyDialog({
  vacancyId,
  applicationCount,
}: {
  vacancyId: string;
  applicationCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [pending, startTransition] = useTransition();

  const plural = applicationCount === 1 ? "postulación" : "postulaciones";

  const run = () =>
    startTransition(async () => {
      const result = await deleteArchivedVacancyCascade(vacancyId);
      // Si la acción redirige (éxito), no se llega aquí; esto cubre el error.
      if (!result.ok) {
        toast.error(result.error);
        setOpen(false);
      }
    });

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setConfirmed(false);
      }}
    >
      <AlertDialogTrigger asChild>
        <Button type="button" variant="destructive">
          Eliminar vacante
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Eliminar la vacante archivada?</AlertDialogTitle>
          <AlertDialogDescription>
            Se eliminarán <strong>{applicationCount} {plural}</strong> y su historial (evaluaciones, entrevistas y
            eventos), junto con los candidatos que no tengan ninguna otra postulación. Esta acción no se puede deshacer.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Label
          htmlFor="confirm-delete-archived"
          className="flex items-start gap-2 rounded-md border p-3 text-sm font-normal leading-snug"
        >
          <Checkbox
            id="confirm-delete-archived"
            checked={confirmed}
            onCheckedChange={(value) => setConfirmed(value === true)}
          />
          <span>
            Entiendo que se eliminarán {applicationCount} {plural} y los candidatos sin otra postulación.
          </span>
        </Label>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            disabled={!confirmed || pending}
            onClick={(event) => {
              event.preventDefault();
              run();
            }}
          >
            {pending ? "Eliminando…" : "Eliminar"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

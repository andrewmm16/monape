"use client";

import { useState, useTransition, type ComponentProps } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { reactivateCandidate } from "@/modules/talent-pool/actions";
import type { ReactivableVacancy } from "@/modules/talent-pool/queries";

type Props = {
  candidateId: string;
  vacancies: ReactivableVacancy[];
  variant?: ComponentProps<typeof Button>["variant"];
  size?: ComponentProps<typeof Button>["size"];
};

/** Añade a un candidato del pool a una vacante abierta, creando una nueva postulación. */
export function ReactivateCandidateDialog({ candidateId, vacancies, variant = "outline", size }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [vacancyId, setVacancyId] = useState("");
  const [pending, startTransition] = useTransition();
  const selectId = `reactivate-vacancy-${candidateId}`;

  const submit = () =>
    startTransition(async () => {
      if (!vacancyId) return;
      const result = await reactivateCandidate({ candidateId, vacancyId });
      if (result.ok) {
        toast.success("Candidato añadido a la vacante.");
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setVacancyId("");
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant={variant} size={size}>
          Añadir a vacante
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Añadir a una vacante</DialogTitle>
          <DialogDescription>Se creará una nueva postulación del candidato en la vacante elegida.</DialogDescription>
        </DialogHeader>
        {vacancies.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay vacantes disponibles.</p>
        ) : (
          <div className="grid gap-1.5">
            <Label htmlFor={selectId}>Vacante</Label>
            <NativeSelect id={selectId} value={vacancyId} onChange={(event) => setVacancyId(event.target.value)} className="w-full">
              <NativeSelectOption value="">Seleccione una vacante</NativeSelectOption>
              {vacancies.map((vacancy) => (
                <NativeSelectOption key={vacancy.id} value={vacancy.id}>
                  {vacancy.title}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button type="button" onClick={submit} disabled={!vacancyId || pending}>
            {pending ? "Añadiendo…" : "Añadir"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

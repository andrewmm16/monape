"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { ActionButton } from "@/components/common/action-button";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { useFormAction } from "@/hooks/use-form-action";
import { closeIncident, markIncidentContained, registerIncidentReview } from "@/modules/incidents/actions";
import {
  closeFormSchema,
  reviewFormSchema,
  type CloseFormInput,
  type ReviewFormInput,
} from "@/modules/incidents/schemas";

export function ContainButton({ incidentId }: { incidentId: string }) {
  return (
    <ActionButton
      variant="outline"
      action={() => markIncidentContained(incidentId)}
      confirm={{
        title: "¿Marcar como contenido?",
        description: "Confirma que ya cortó el daño (cuenta desactivada, clave rotada o parte apagada). El plazo de 48 h sigue corriendo.",
        confirmLabel: "Marcar contenido",
      }}
    >
      Marcar como contenido
    </ActionButton>
  );
}

export function CloseIncidentDialog({ incidentId }: { incidentId: string }) {
  const [open, setOpen] = useState(false);
  const form = useForm<CloseFormInput>({
    resolver: zodResolver(closeFormSchema, undefined, { raw: true }),
    defaultValues: { cause: "", prevention: "" },
  });
  const { submit, pending } = useFormAction(form, (values) => closeIncident(incidentId, values), { onSuccess: () => setOpen(false) });
  const errors = form.formState.errors;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Cerrar incidente</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Cerrar incidente</DialogTitle>
          <DialogDescription>
            Un incidente cerrado no se reabre. Indique la causa y qué se cambió para que no se repita; luego hará la revisión.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate>
          <FieldGroup>
            <Field data-invalid={Boolean(errors.cause)}>
              <FieldLabel htmlFor="close-cause">Causa</FieldLabel>
              <Textarea id="close-cause" rows={3} {...form.register("cause")} />
              <FieldError errors={[errors.cause]} />
            </Field>
            <Field data-invalid={Boolean(errors.prevention)}>
              <FieldLabel htmlFor="close-prevention">Qué se cambió para que no se repita</FieldLabel>
              <Textarea id="close-prevention" rows={3} {...form.register("prevention")} />
              <FieldError errors={[errors.prevention]} />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Cancelar
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Cerrando…" : "Cerrar incidente"}
              </Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ReviewForm({ incidentId }: { incidentId: string }) {
  const form = useForm<ReviewFormInput>({
    resolver: zodResolver(reviewFormSchema, undefined, { raw: true }),
    defaultValues: { notes: "" },
  });
  const { submit, pending } = useFormAction(form, (values) => registerIncidentReview(incidentId, values));
  const errors = form.formState.errors;

  return (
    <form onSubmit={submit} noValidate>
      <FieldGroup>
        <Field data-invalid={Boolean(errors.notes)}>
          <FieldLabel htmlFor="review-notes">Revisión breve y sin culpables</FieldLabel>
          <Textarea id="review-notes" rows={4} placeholder="Qué pasó, qué funcionó, qué no y si hay que actualizar la política." {...form.register("notes")} />
          <FieldError errors={[errors.notes]} />
        </Field>
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? "Guardando…" : "Registrar revisión"}
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}

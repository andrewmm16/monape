"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { useFormAction } from "@/hooks/use-form-action";
import { createIncident } from "@/modules/incidents/actions";
import { incidentFormSchema, nowLimaInput, type IncidentFormInput } from "@/modules/incidents/schemas";

const emptyValues = (): IncidentFormInput => ({
  title: "",
  detectedAt: nowLimaInput(),
  detectedBy: "",
  severity: "media",
  description: "",
  affectedData: "",
  affectedPeople: "",
  sensitiveData: false,
});

/** Registro de un incidente con los datos iniciales; el plazo de 48 h corre desde «Detectado el». */
export function IncidentFormDialog() {
  const [open, setOpen] = useState(false);
  const form = useForm<IncidentFormInput>({
    resolver: zodResolver(incidentFormSchema, undefined, { raw: true }),
    defaultValues: emptyValues(),
  });
  const { submit, pending } = useFormAction(form, (values) => createIncident(values), { onSuccess: () => setOpen(false) });
  const errors = form.formState.errors;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) form.reset(emptyValues());
      }}
    >
      <DialogTrigger asChild>
        <Button>Registrar incidente</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Registrar incidente</DialogTitle>
          <DialogDescription>
            Anote lo que sepa ahora; puede completar el resto después. El plazo de 48 h para avisar a la Autoridad corre desde que se
            tomó conocimiento, no desde que termine de investigar.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate>
          <FieldGroup>
            <Field data-invalid={Boolean(errors.title)}>
              <FieldLabel htmlFor="incident-title">Título</FieldLabel>
              <Input id="incident-title" maxLength={200} {...form.register("title")} />
              <FieldError errors={[errors.title]} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field data-invalid={Boolean(errors.detectedAt)}>
                <FieldLabel htmlFor="incident-detected-at">Detectado el (hora de Perú)</FieldLabel>
                <Input id="incident-detected-at" type="datetime-local" {...form.register("detectedAt")} />
                <FieldError errors={[errors.detectedAt]} />
              </Field>
              <Field data-invalid={Boolean(errors.severity)}>
                <FieldLabel htmlFor="incident-severity">Gravedad</FieldLabel>
                <NativeSelect id="incident-severity" className="w-full" {...form.register("severity")}>
                  <NativeSelectOption value="alta">Alta (en menos de 1 hora)</NativeSelectOption>
                  <NativeSelectOption value="media">Media (el mismo día)</NativeSelectOption>
                  <NativeSelectOption value="baja">Baja (al siguiente día hábil)</NativeSelectOption>
                </NativeSelect>
                <FieldError errors={[errors.severity]} />
              </Field>
            </div>
            <Field data-invalid={Boolean(errors.detectedBy)}>
              <FieldLabel htmlFor="incident-detected-by">Quién lo detectó</FieldLabel>
              <Input id="incident-detected-by" maxLength={200} {...form.register("detectedBy")} />
              <FieldError errors={[errors.detectedBy]} />
            </Field>
            <Field data-invalid={Boolean(errors.description)}>
              <FieldLabel htmlFor="incident-description">Qué pasó</FieldLabel>
              <Textarea id="incident-description" rows={4} {...form.register("description")} />
              <FieldError errors={[errors.description]} />
            </Field>
            <Field data-invalid={Boolean(errors.affectedData)}>
              <FieldLabel htmlFor="incident-affected-data">Qué datos afectó</FieldLabel>
              <Textarea id="incident-affected-data" rows={2} {...form.register("affectedData")} />
              <FieldDescription>Si no hubo datos afectados, déjelo vacío. No escriba valores de claves ni datos de candidatos.</FieldDescription>
              <FieldError errors={[errors.affectedData]} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2 sm:items-end">
              <Field data-invalid={Boolean(errors.affectedPeople)}>
                <FieldLabel htmlFor="incident-affected-people">Personas afectadas</FieldLabel>
                <Input id="incident-affected-people" inputMode="numeric" placeholder="Aún no se sabe" {...form.register("affectedPeople")} />
                <FieldError errors={[errors.affectedPeople]} />
              </Field>
              <Controller
                control={form.control}
                name="sensitiveData"
                render={({ field }) => (
                  <Field orientation="horizontal">
                    <Checkbox id="incident-sensitive" checked={field.value === true} onCheckedChange={(checked) => field.onChange(checked === true)} />
                    <FieldLabel htmlFor="incident-sensitive" className="font-normal">
                      Hubo datos sensibles
                    </FieldLabel>
                  </Field>
                )}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Cancelar
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Guardando…" : "Registrar"}
              </Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { useFormAction } from "@/hooks/use-form-action";
import { addIncidentEvent } from "@/modules/incidents/actions";
import { RECIPIENT_PRESETS, eventFormSchema, nowLimaInput, type EventFormInput } from "@/modules/incidents/schemas";

const OTHER = "__otro__";

const emptyValues = (): EventFormInput => ({ kind: "accion", description: "", recipient: "", occurredAt: nowLimaInput() });

/** Agrega una acción, una notificación o una nota a la bitácora. Lo anotado no se puede editar ni borrar. */
export function EventForm({ incidentId }: { incidentId: string }) {
  const form = useForm<EventFormInput>({
    resolver: zodResolver(eventFormSchema, undefined, { raw: true }),
    defaultValues: emptyValues(),
  });
  const [choice, setChoice] = useState<string>(RECIPIENT_PRESETS[0]);
  const { submit, pending } = useFormAction(form, (values) => addIncidentEvent(incidentId, values), {
    onSuccess: () => form.reset(emptyValues()),
  });
  const errors = form.formState.errors;
  const kind = useWatch({ control: form.control, name: "kind" });

  const chooseRecipient = (value: string) => {
    setChoice(value);
    form.setValue("recipient", value === OTHER ? "" : value, { shouldValidate: form.formState.isSubmitted });
  };

  return (
    <form onSubmit={submit} noValidate>
      <FieldGroup>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={Boolean(errors.kind)}>
            <FieldLabel htmlFor="event-kind">Qué anota</FieldLabel>
            <NativeSelect
              id="event-kind"
              className="w-full"
              {...form.register("kind", {
                onChange: (event: { target: { value: string } }) => {
                  if (event.target.value === "notificacion") chooseRecipient(RECIPIENT_PRESETS[0]);
                  else form.setValue("recipient", "");
                },
              })}
            >
              <NativeSelectOption value="accion">Acción tomada</NativeSelectOption>
              <NativeSelectOption value="notificacion">Notificación enviada</NativeSelectOption>
              <NativeSelectOption value="nota">Nota</NativeSelectOption>
            </NativeSelect>
          </Field>
          <Field data-invalid={Boolean(errors.occurredAt)}>
            <FieldLabel htmlFor="event-occurred-at">Cuándo ocurrió (hora de Perú)</FieldLabel>
            <Input id="event-occurred-at" type="datetime-local" {...form.register("occurredAt")} />
            <FieldError errors={[errors.occurredAt]} />
          </Field>
        </div>
        {kind === "notificacion" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="event-recipient-choice">A quién se avisó</FieldLabel>
              <NativeSelect id="event-recipient-choice" className="w-full" value={choice} onChange={(event) => chooseRecipient(event.target.value)}>
                {RECIPIENT_PRESETS.map((name) => (
                  <NativeSelectOption key={name} value={name}>
                    {name}
                  </NativeSelectOption>
                ))}
                <NativeSelectOption value={OTHER}>El proveedor u otro…</NativeSelectOption>
              </NativeSelect>
            </Field>
            {choice === OTHER ? (
              <Field data-invalid={Boolean(errors.recipient)}>
                <FieldLabel htmlFor="event-recipient">Nombre</FieldLabel>
                <Input id="event-recipient" maxLength={200} placeholder="Supabase, Vercel, Resend…" {...form.register("recipient")} />
                <FieldError errors={[errors.recipient]} />
              </Field>
            ) : null}
          </div>
        ) : null}
        <Field data-invalid={Boolean(errors.description)}>
          <FieldLabel htmlFor="event-description">{kind === "notificacion" ? "Qué se comunicó" : kind === "nota" ? "Nota" : "Qué se hizo"}</FieldLabel>
          <Textarea id="event-description" rows={3} maxLength={2000} {...form.register("description")} />
          <FieldDescription>No escriba valores de claves ni datos personales de candidatos.</FieldDescription>
          <FieldError errors={[errors.description]} />
        </Field>
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? "Guardando…" : "Agregar a la bitácora"}
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}

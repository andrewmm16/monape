"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ListChecksIcon } from "lucide-react";
import { useForm, useWatch } from "react-hook-form";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { useFormAction } from "@/hooks/use-form-action";
import { addApplicationNote } from "@/modules/applications/actions";
import { noteSchema } from "@/modules/applications/schemas";

type NoteInput = z.input<typeof noteSchema>;

/**
 * `suggestion`: borrador generado a partir de la evaluación más reciente
 * (src/modules/evaluation/drafts.ts). Se inserta en el campo para que la
 * persona lo revise y edite; nunca se registra sin que pulse «Registrar».
 */
export function NoteForm({ applicationId, suggestion }: { applicationId: string; suggestion?: string | null }) {
  const form = useForm<NoteInput>({
    resolver: zodResolver(noteSchema, undefined, { raw: true }),
    defaultValues: { applicationId, note: "" },
  });
  const { submit, pending } = useFormAction(form, addApplicationNote, {
    onSuccess: () => form.reset({ applicationId, note: "" }),
  });

  const note = useWatch({ control: form.control, name: "note" });
  const alreadyInserted = Boolean(suggestion) && note.includes(suggestion!);

  const insertSuggestion = () => {
    // Se agrega al final para no perder lo que ya se haya escrito, y una sola vez.
    const current = form.getValues("note").trim();
    if (!suggestion || current.includes(suggestion)) return;
    form.setValue("note", current ? `${current}\n\n${suggestion}` : suggestion, { shouldDirty: true });
    form.clearErrors("note");
    form.setFocus("note");
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-2">
      <Field data-invalid={Boolean(form.formState.errors.note)}>
        <FieldLabel htmlFor="application-note">Nueva observación</FieldLabel>
        <Textarea
          id="application-note"
          rows={3}
          placeholder="Observaciones profesionales relacionadas con el puesto. Evite datos personales innecesarios."
          {...form.register("note")}
        />
        <FieldDescription>Una vez registrada, la observación no se puede editar ni borrar.</FieldDescription>
        <FieldError errors={[form.formState.errors.note]} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Guardando…" : "Registrar observación"}
        </Button>
        {suggestion ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={insertSuggestion}
            disabled={pending || alreadyInserted}
            title={alreadyInserted ? "El texto sugerido ya está en la observación." : undefined}
          >
            <ListChecksIcon /> {alreadyInserted ? "Sugerencia insertada" : "Sugerir a partir de la evaluación"}
          </Button>
        ) : null}
      </div>
    </form>
  );
}

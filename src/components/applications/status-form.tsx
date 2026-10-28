"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { ListChecksIcon, SparklesIcon, TriangleAlertIcon } from "lucide-react";
import { useForm, useWatch } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { useFormAction } from "@/hooks/use-form-action";
import { APPLICATION_STATUS_LABELS } from "@/lib/labels";
import { changeApplicationStatus } from "@/modules/applications/actions";
import { changeStatusSchema, STATUSES_REQUIRING_REASON, type ChangeStatusInput } from "@/modules/applications/schemas";
import {
  buildReasonDraft,
  buildStatusNoteDraft,
  decisionWarning,
  suggestStatus,
  type DraftInput,
} from "@/modules/evaluation/drafts";
import { Constants, type Enums } from "@/types/database";

type Status = Enums<"application_status">;
type TextField = "reason" | "note";

const isStatus = (value: string): value is Status => (Constants.public.Enums.application_status as readonly string[]).includes(value);

/**
 * `draft`: evaluación más reciente. Con ella se preselecciona el estado que
 * sugiere la compatibilidad y se redactan el motivo y la observación del
 * estado elegido. Todo es editable y nada se guarda sin «Actualizar estado».
 */
export function StatusForm({
  applicationId,
  current,
  draft,
}: {
  applicationId: string;
  current: Status;
  draft: DraftInput | null;
}) {
  const options = Constants.public.Enums.application_status.filter((status) => status !== current);
  const suggestion = draft ? suggestStatus(draft, current) : null;
  const draftsFor = (status: string) =>
    draft && isStatus(status)
      ? { reason: buildReasonDraft(draft, status), note: buildStatusNoteDraft(draft, status) }
      : { reason: "", note: "" };

  const initialStatus = suggestion?.status ?? "";
  const initialDrafts = draftsFor(initialStatus);
  // Último texto insertado automáticamente en cada campo: si la persona no lo
  // editó, se reemplaza al cambiar de estado; si lo editó, se respeta.
  const [autoText, setAutoText] = useState<Record<TextField, string>>(initialDrafts);

  const form = useForm<ChangeStatusInput>({
    resolver: zodResolver(changeStatusSchema, undefined, { raw: true }),
    defaultValues: { applicationId, status: initialStatus as Status, ...initialDrafts },
  });
  const { submit, pending } = useFormAction(form, changeApplicationStatus);
  const errors = form.formState.errors;
  const [selected, reason, note] = useWatch({ control: form.control, name: ["status", "reason", "note"] });
  const reasonRequired = (STATUSES_REQUIRING_REASON as readonly string[]).includes(selected);
  const selectedDrafts = draftsFor(selected);
  const warning = draft && isStatus(selected) ? decisionWarning(draft, selected) : null;

  const replaceUntouched = (status: string) => {
    const next = draftsFor(status);
    const updated = { ...autoText };
    for (const field of ["reason", "note"] as const) {
      const value = form.getValues(field).trim();
      if (value === "" || value === autoText[field].trim()) {
        form.setValue(field, next[field], { shouldDirty: true });
        updated[field] = next[field];
      }
    }
    setAutoText(updated);
  };

  // Inserta el borrador solo si el campo no lo contiene ya: pulsar varias
  // veces no repite el texto.
  const alreadyInserted = (["reason", "note"] as const).every(
    (field) => !selectedDrafts[field] || (field === "reason" ? reason : note).includes(selectedDrafts[field]),
  );
  const insertDrafts = () => {
    const updated = { ...autoText };
    for (const field of ["reason", "note"] as const) {
      const text = selectedDrafts[field];
      const value = form.getValues(field).trim();
      if (!text || value.includes(text)) continue;
      form.setValue(field, value ? `${value}\n\n${text}` : text, { shouldDirty: true });
      if (!value) updated[field] = text;
    }
    setAutoText(updated);
    form.clearErrors(["reason", "note"]);
  };
  const statusField = form.register("status");

  return (
    <form onSubmit={submit} noValidate>
      <FieldGroup className="gap-3">
        <Field data-invalid={Boolean(errors.status)}>
          <FieldLabel htmlFor="status">Nuevo estado</FieldLabel>
          <NativeSelect
            id="status"
            className="w-full"
            {...statusField}
            onChange={(event) => {
              void statusField.onChange(event);
              replaceUntouched(event.target.value);
            }}
          >
            <NativeSelectOption value="" disabled>
              Seleccione el nuevo estado…
            </NativeSelectOption>
            {options.map((status) => (
              <NativeSelectOption key={status} value={status}>
                {APPLICATION_STATUS_LABELS[status]}
                {status === suggestion?.status ? " (sugerido)" : ""}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          {suggestion ? (
            <FieldDescription className="flex items-start gap-1.5">
              <SparklesIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>
                Sugerido según la {suggestion.basis}. Revise el estado, el motivo y la observación antes de guardar.
              </span>
            </FieldDescription>
          ) : null}
          <FieldError errors={[errors.status]} />
        </Field>
        {warning ? (
          <p
            role="status"
            className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-50"
          >
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
            {warning}
          </p>
        ) : null}
        <Field data-invalid={Boolean(errors.reason)}>
          <FieldLabel htmlFor="reason">Motivo {reasonRequired ? "(obligatorio)" : "(opcional)"}</FieldLabel>
          <Textarea id="reason" rows={4} {...form.register("reason")} />
          {selected === "no_seleccionado" ? (
            <FieldDescription>
              La decisión debe basarse en la revisión de RRHH, no solo en la compatibilidad orientativa.
            </FieldDescription>
          ) : null}
          <FieldError errors={[errors.reason]} />
        </Field>
        <Field data-invalid={Boolean(errors.note)}>
          <FieldLabel htmlFor="note">Observación interna (opcional)</FieldLabel>
          <Textarea id="note" rows={6} {...form.register("note")} />
          <FieldError errors={[errors.note]} />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={pending}>
            {pending ? "Guardando…" : "Actualizar estado"}
          </Button>
          {draft && selected ? (
            <Button
              type="button"
              variant="outline"
              onClick={insertDrafts}
              disabled={pending || alreadyInserted}
              title={alreadyInserted ? "El texto sugerido ya está en el motivo y la observación." : undefined}
            >
              <ListChecksIcon /> {alreadyInserted ? "Sugerencia insertada" : "Sugerir a partir de la evaluación"}
            </Button>
          ) : null}
        </div>
      </FieldGroup>
    </form>
  );
}

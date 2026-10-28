"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { useFormAction } from "@/hooks/use-form-action";
import { REVIEW_OUTCOME_LABELS } from "@/lib/labels";
import { reviewEvaluation } from "@/modules/applications/actions";
import { reviewSchema, type ReviewInput } from "@/modules/applications/schemas";
import { Constants } from "@/types/database";

export function ReviewForm({ applicationId, evaluationId }: { applicationId: string; evaluationId: string }) {
  const form = useForm<ReviewInput>({
    resolver: zodResolver(reviewSchema, undefined, { raw: true }),
    defaultValues: { evaluationId, outcome: "conforme", notes: "" },
  });
  const { submit, pending } = useFormAction(form, (values) => reviewEvaluation(applicationId, values));
  const errors = form.formState.errors;

  return (
    <form onSubmit={submit} noValidate className="rounded-md border p-3">
      <FieldGroup className="gap-3">
        <Field>
          <FieldLabel htmlFor="outcome">Resultado de la revisión</FieldLabel>
          <NativeSelect id="outcome" className="w-full" {...form.register("outcome")}>
            {Constants.public.Enums.evaluation_review_outcome.map((outcome) => (
              <NativeSelectOption key={outcome} value={outcome}>
                {REVIEW_OUTCOME_LABELS[outcome]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Field data-invalid={Boolean(errors.notes)}>
          <FieldLabel htmlFor="notes">Observaciones y correcciones</FieldLabel>
          <Textarea
            id="notes"
            rows={3}
            placeholder="Ej.: la experiencia en SAP se verificó en entrevista; el requisito de colegiatura sigue pendiente."
            {...form.register("notes")}
          />
          <FieldError errors={[errors.notes]} />
        </Field>
        <Button type="submit" size="sm" disabled={pending} className="self-start">
          {pending ? "Guardando…" : "Registrar revisión"}
        </Button>
      </FieldGroup>
    </form>
  );
}

"use client";

import { useState, type ReactNode } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm, useWatch } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { useFormAction } from "@/hooks/use-form-action";
import { KILLER_COMPARATOR_LABELS, KILLER_QUESTION_TYPE_LABELS } from "@/lib/labels";
import { addKillerQuestion, updateKillerQuestion } from "@/modules/vacancies/actions";
import { killerQuestionFormSchema, type KillerQuestionFormInput } from "@/modules/vacancies/schemas";
import { Constants } from "@/types/database";

const EMPTY: KillerQuestionFormInput = {
  question: "",
  questionType: "si_no",
  helpText: "",
  isRequired: true,
  expectedBoolean: "si",
  comparator: "mayor_igual",
  threshold: "",
  options: "",
  acceptedOptions: "",
};

export function KillerQuestionDialog({
  vacancyId,
  questionId,
  initialValues,
  trigger,
}: {
  vacancyId: string;
  questionId?: string;
  initialValues?: KillerQuestionFormInput;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const form = useForm<KillerQuestionFormInput>({
    resolver: zodResolver(killerQuestionFormSchema, undefined, { raw: true }),
    defaultValues: initialValues ?? EMPTY,
  });
  const { submit, pending } = useFormAction(
    form,
    (values) => (questionId ? updateKillerQuestion(vacancyId, questionId, values) : addKillerQuestion(vacancyId, values)),
    {
      onSuccess: () => {
        setOpen(false);
        if (!questionId) form.reset(EMPTY);
      },
    },
  );
  const errors = form.formState.errors;
  const questionType = useWatch({ control: form.control, name: "questionType" });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{questionId ? "Editar pregunta eliminatoria" : "Nueva pregunta eliminatoria"}</DialogTitle>
          <DialogDescription>
            El candidato la responde al postular. Si su respuesta no cumple, la postulación se marca para su revisión:
            nunca se descarta ni se bloquea automáticamente.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate>
          <FieldGroup>
            <Field data-invalid={Boolean(errors.question)}>
              <FieldLabel htmlFor="kq-question">Pregunta</FieldLabel>
              <Input id="kq-question" placeholder="Ej.: ¿Cuenta con licencia de conducir A-II?" {...form.register("question")} />
              <FieldError errors={[errors.question]} />
            </Field>
            <Field data-invalid={Boolean(errors.helpText)}>
              <FieldLabel htmlFor="kq-help">Aclaración para el candidato (opcional)</FieldLabel>
              <Input id="kq-help" {...form.register("helpText")} />
              <FieldDescription>Precisa o aclara lo que se pregunta, sin indicar qué respuesta cumple.</FieldDescription>
              <FieldError errors={[errors.helpText]} />
            </Field>
            <Field>
              <FieldLabel htmlFor="kq-type">Tipo de respuesta</FieldLabel>
              <NativeSelect id="kq-type" className="w-full" {...form.register("questionType")}>
                {Constants.public.Enums.killer_question_type.map((type) => (
                  <NativeSelectOption key={type} value={type}>
                    {KILLER_QUESTION_TYPE_LABELS[type]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>

            {questionType === "si_no" ? (
              <Field data-invalid={Boolean(errors.expectedBoolean)}>
                <FieldLabel htmlFor="kq-expected">Respuesta que cumple</FieldLabel>
                <NativeSelect id="kq-expected" className="w-full" {...form.register("expectedBoolean")}>
                  <NativeSelectOption value="si">Sí</NativeSelectOption>
                  <NativeSelectOption value="no">No</NativeSelectOption>
                </NativeSelect>
                <FieldError errors={[errors.expectedBoolean]} />
              </Field>
            ) : null}

            {questionType === "numero" ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field data-invalid={Boolean(errors.comparator)}>
                  <FieldLabel htmlFor="kq-comparator">Cumple si la respuesta es</FieldLabel>
                  <NativeSelect id="kq-comparator" className="w-full" {...form.register("comparator")}>
                    {Constants.public.Enums.killer_number_comparator.map((comparator) => (
                      <NativeSelectOption key={comparator} value={comparator}>
                        {KILLER_COMPARATOR_LABELS[comparator]}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  <FieldError errors={[errors.comparator]} />
                </Field>
                <Field data-invalid={Boolean(errors.threshold)}>
                  <FieldLabel htmlFor="kq-threshold">Valor</FieldLabel>
                  <Input id="kq-threshold" inputMode="decimal" placeholder="Ej.: 2" {...form.register("threshold")} />
                  <FieldError errors={[errors.threshold]} />
                </Field>
              </div>
            ) : null}

            {questionType === "opcion_unica" ? (
              <>
                <Field data-invalid={Boolean(errors.options)}>
                  <FieldLabel htmlFor="kq-options">Opciones</FieldLabel>
                  <Textarea id="kq-options" rows={4} placeholder={"Lima\nCallao\nOtra ciudad"} {...form.register("options")} />
                  <FieldDescription>Una por línea (de 2 a 20). El candidato elige una.</FieldDescription>
                  <FieldError errors={[errors.options]} />
                </Field>
                <Field data-invalid={Boolean(errors.acceptedOptions)}>
                  <FieldLabel htmlFor="kq-accepted">Opciones que cumplen</FieldLabel>
                  <Textarea id="kq-accepted" rows={2} placeholder={"Lima\nCallao"} {...form.register("acceptedOptions")} />
                  <FieldDescription>Una por línea, escritas igual que en la lista de opciones.</FieldDescription>
                  <FieldError errors={[errors.acceptedOptions]} />
                </Field>
              </>
            ) : null}

            <Controller
              control={form.control}
              name="isRequired"
              render={({ field }) => (
                <Field orientation="horizontal">
                  <Checkbox id="kq-required" checked={field.value} onCheckedChange={(checked) => field.onChange(checked === true)} />
                  <FieldLabel htmlFor="kq-required" className="font-normal">
                    El candidato debe responderla para enviar la postulación
                  </FieldLabel>
                </Field>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Cancelar
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Guardando…" : "Guardar"}
              </Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}

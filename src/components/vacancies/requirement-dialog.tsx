"use client";

import { useId, useState, type ReactNode } from "react";
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
import { REQUIREMENT_CATEGORY_LABELS, REQUIREMENT_PRIORITY_LABELS } from "@/lib/labels";
import { addRequirement, updateRequirement } from "@/modules/vacancies/actions";
import { requirementFormSchema, type RequirementFormInput } from "@/modules/vacancies/schemas";
import { appendTerms, splitKeywords, suggestTerms } from "@/modules/vacancies/term-suggestions";
import { Constants } from "@/types/database";

const EMPTY: RequirementFormInput = {
  category: "habilidad_tecnica",
  priority: "obligatorio",
  description: "",
  keywords: "",
  weight: 3,
  minYears: "",
  isEssential: false,
};

export function RequirementDialog({
  vacancyId,
  requirementId,
  initialValues,
  trigger,
}: {
  vacancyId: string;
  requirementId?: string;
  initialValues?: RequirementFormInput;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const form = useForm<RequirementFormInput>({
    resolver: zodResolver(requirementFormSchema, undefined, { raw: true }),
    defaultValues: initialValues ?? EMPTY,
  });
  const { submit, pending } = useFormAction(
    form,
    (values) => (requirementId ? updateRequirement(vacancyId, requirementId, values) : addRequirement(vacancyId, values)),
    {
      onSuccess: () => {
        setOpen(false);
        if (!requirementId) form.reset(EMPTY);
      },
    },
  );
  const errors = form.formState.errors;
  const suggestionsId = useId();
  const description = useWatch({ control: form.control, name: "description" });
  const keywords = useWatch({ control: form.control, name: "keywords" });
  const suggestions = suggestTerms(description ?? "", splitKeywords(keywords ?? ""));

  const limitReached = suggestions.length > 0 && appendTerms(keywords ?? "", suggestions).added.length === 0;

  // Agrega términos al campo con el mismo formato separado por comas del formulario,
  // sin superar los límites del esquema (20 términos y 1000 caracteres).
  function addKeywords(terms: string[]) {
    const { value, added } = appendTerms(form.getValues("keywords") ?? "", terms);
    if (added.length === 0) return;
    form.setValue("keywords", value, { shouldDirty: true, shouldValidate: form.formState.isSubmitted });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{requirementId ? "Editar requisito" : "Nuevo requisito"}</DialogTitle>
          <DialogDescription>
            Use criterios relacionados con las funciones reales del puesto. Cualquier cambio exige volver a aprobar los
            criterios.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate>
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="category">Tipo</FieldLabel>
                <NativeSelect id="category" className="w-full" {...form.register("category")}>
                  {Constants.public.Enums.requirement_category.map((category) => (
                    <NativeSelectOption key={category} value={category}>
                      {REQUIREMENT_CATEGORY_LABELS[category]}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor="priority">Prioridad</FieldLabel>
                <NativeSelect id="priority" className="w-full" {...form.register("priority")}>
                  {Constants.public.Enums.requirement_priority.map((priority) => (
                    <NativeSelectOption key={priority} value={priority}>
                      {REQUIREMENT_PRIORITY_LABELS[priority]}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
            </div>
            <Field data-invalid={Boolean(errors.description)}>
              <FieldLabel htmlFor="description">Requisito</FieldLabel>
              <Input id="description" placeholder="Ej.: Bachiller en Ingeniería Industrial" {...form.register("description")} />
              <FieldError errors={[errors.description]} />
            </Field>
            <Field data-invalid={Boolean(errors.keywords)}>
              <FieldLabel htmlFor="keywords">Términos de búsqueda</FieldLabel>
              <Textarea id="keywords" rows={2} placeholder="Ej.: Ingeniería Industrial, Ing. Industrial" {...form.register("keywords")} />
              <FieldDescription>
                Separados por comas. El motor de reglas busca estos términos en el CV; sin términos, el requisito queda
                pendiente de revisión manual.
              </FieldDescription>
              <FieldError errors={[errors.keywords]} />
              {suggestions.length > 0 && (
                <div role="group" aria-labelledby={suggestionsId} className="grid gap-2">
                  <p id={suggestionsId} className="text-sm font-medium">
                    Términos relacionados sugeridos
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {suggestions.map((term) => (
                      <Button
                        key={term}
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 sm:h-7"
                        disabled={appendTerms(keywords ?? "", [term]).added.length === 0}
                        onClick={() => addKeywords([term])}
                      >
                        <span aria-hidden="true">+</span> {term}
                      </Button>
                    ))}
                    <Button type="button" variant="secondary" size="sm" className="h-8 sm:h-7" disabled={limitReached} onClick={() => addKeywords(suggestions)}>
                      Agregar todos
                    </Button>
                  </div>
                  <FieldDescription>
                    Sugerencias de un diccionario fijo: agregue solo las que correspondan al requisito.
                    {limitReached && " Se alcanzó el límite de términos o de caracteres: no se pueden agregar más."}
                  </FieldDescription>
                </div>
              )}
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field data-invalid={Boolean(errors.weight)}>
                <FieldLabel htmlFor="weight">Peso (1 a 10)</FieldLabel>
                <Input id="weight" type="number" min={1} max={10} step={1} {...form.register("weight")} />
                <FieldError errors={[errors.weight]} />
              </Field>
              <Field data-invalid={Boolean(errors.minYears)}>
                <FieldLabel htmlFor="minYears">Años mínimos (opcional)</FieldLabel>
                <Input id="minYears" inputMode="decimal" placeholder="Solo para experiencia" {...form.register("minYears")} />
                <FieldError errors={[errors.minYears]} />
              </Field>
            </div>
            <Controller
              control={form.control}
              name="isEssential"
              render={({ field }) => (
                <Field orientation="horizontal">
                  <Checkbox id="isEssential" checked={field.value} onCheckedChange={(checked) => field.onChange(checked === true)} />
                  <FieldLabel htmlFor="isEssential" className="font-normal">
                    Requisito legal o esencial (exige verificación documental)
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

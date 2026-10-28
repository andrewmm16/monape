"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { useFormAction } from "@/hooks/use-form-action";
import { EMPLOYMENT_TYPE_LABELS, SALARY_PERIOD_LABELS, WORK_MODALITY_LABELS } from "@/lib/labels";
import { createVacancy, updateVacancy } from "@/modules/vacancies/actions";
import { vacancyFormSchema, type VacancyFormInput } from "@/modules/vacancies/schemas";
import { Constants } from "@/types/database";

type Props = {
  vacancyId?: string;
  defaultValues: VacancyFormInput;
  owners: { id: string; full_name: string }[];
};

export function VacancyForm({ vacancyId, defaultValues, owners }: Props) {
  const router = useRouter();
  const form = useForm<VacancyFormInput>({
    resolver: zodResolver(vacancyFormSchema, undefined, { raw: true }),
    defaultValues,
  });
  const { submit, pending } = useFormAction(
    form,
    async (values) => {
      if (vacancyId) {
        const result = await updateVacancy(vacancyId, values);
        return result.ok ? { ...result, data: { id: vacancyId } } : result;
      }
      return createVacancy(values);
    },
    { onSuccess: ({ id }) => router.push(`/vacantes/${id}`), refresh: false },
  );
  const errors = form.formState.errors;

  return (
    <form onSubmit={submit} noValidate className="max-w-3xl">
      <FieldGroup>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={Boolean(errors.title)}>
            <FieldLabel htmlFor="title">Título del puesto</FieldLabel>
            <Input id="title" {...form.register("title")} aria-invalid={Boolean(errors.title)} />
            <FieldError errors={[errors.title]} />
          </Field>
          <Field data-invalid={Boolean(errors.department)}>
            <FieldLabel htmlFor="department">Área o departamento</FieldLabel>
            <Input id="department" {...form.register("department")} aria-invalid={Boolean(errors.department)} />
            <FieldError errors={[errors.department]} />
          </Field>
        </div>

        <Field data-invalid={Boolean(errors.description)}>
          <FieldLabel htmlFor="description">Descripción</FieldLabel>
          <Textarea id="description" rows={4} {...form.register("description")} />
          <FieldError errors={[errors.description]} />
        </Field>
        <Field data-invalid={Boolean(errors.responsibilities)}>
          <FieldLabel htmlFor="responsibilities">Responsabilidades</FieldLabel>
          <Textarea id="responsibilities" rows={4} {...form.register("responsibilities")} />
          <FieldDescription>
            Formación, experiencia, habilidades, competencias y certificaciones se registran como requisitos
            ponderados en la ficha de la vacante.
          </FieldDescription>
          <FieldError errors={[errors.responsibilities]} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field data-invalid={Boolean(errors.location)}>
            <FieldLabel htmlFor="location">Ubicación</FieldLabel>
            <Input id="location" {...form.register("location")} />
            <FieldError errors={[errors.location]} />
          </Field>
          <Field>
            <FieldLabel htmlFor="modality">Modalidad</FieldLabel>
            <NativeSelect id="modality" className="w-full" {...form.register("modality")}>
              <NativeSelectOption value="">Sin definir</NativeSelectOption>
              {Constants.public.Enums.work_modality.map((modality) => (
                <NativeSelectOption key={modality} value={modality}>
                  {WORK_MODALITY_LABELS[modality]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field data-invalid={Boolean(errors.contractType)}>
            <FieldLabel htmlFor="contractType">Tipo de contrato</FieldLabel>
            <Input id="contractType" placeholder="Si se conoce" {...form.register("contractType")} />
            <FieldError errors={[errors.contractType]} />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field data-invalid={Boolean(errors.openingDate)}>
            <FieldLabel htmlFor="openingDate">Fecha de apertura</FieldLabel>
            <Input id="openingDate" type="date" {...form.register("openingDate")} />
            <FieldError errors={[errors.openingDate]} />
          </Field>
          <Field data-invalid={Boolean(errors.closingDate)}>
            <FieldLabel htmlFor="closingDate">Fecha de cierre</FieldLabel>
            <Input id="closingDate" type="date" {...form.register("closingDate")} />
            <FieldError errors={[errors.closingDate]} />
          </Field>
          <Field>
            <FieldLabel htmlFor="ownerId">Responsable del proceso</FieldLabel>
            <NativeSelect id="ownerId" className="w-full" {...form.register("ownerId")}>
              <NativeSelectOption value="">Sin asignar</NativeSelectOption>
              {owners.map((owner) => (
                <NativeSelectOption key={owner.id} value={owner.id}>
                  {owner.full_name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
        </div>

        <fieldset className="space-y-4 rounded-lg border p-4">
          <legend className="px-1 text-sm font-medium">Publicación</legend>
          <p className="text-sm text-muted-foreground">
            Al publicar la vacante aparece en la página pública, en Google y en los buscadores de empleo, salvo que sea
            confidencial. Para salir allí necesita una descripción de al menos 50 caracteres, el tipo de empleo y, si no es
            remota, la ciudad y la región.
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field data-invalid={Boolean(errors.city)}>
              <FieldLabel htmlFor="city">Ciudad</FieldLabel>
              <Input id="city" {...form.register("city")} />
              <FieldError errors={[errors.city]} />
            </Field>
            <Field data-invalid={Boolean(errors.region)}>
              <FieldLabel htmlFor="region">Región</FieldLabel>
              <Input id="region" {...form.register("region")} />
              <FieldError errors={[errors.region]} />
            </Field>
            <Field>
              <FieldLabel htmlFor="employmentType">Tipo de empleo</FieldLabel>
              <NativeSelect id="employmentType" className="w-full" {...form.register("employmentType")}>
                <NativeSelectOption value="">Sin definir</NativeSelectOption>
                {Constants.public.Enums.employment_type.map((type) => (
                  <NativeSelectOption key={type} value={type}>
                    {EMPLOYMENT_TYPE_LABELS[type]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-4">
            <Field data-invalid={Boolean(errors.salaryMin)}>
              <FieldLabel htmlFor="salaryMin">Sueldo mínimo</FieldLabel>
              <Input id="salaryMin" inputMode="decimal" placeholder="Opcional" {...form.register("salaryMin")} />
              <FieldError errors={[errors.salaryMin]} />
            </Field>
            <Field data-invalid={Boolean(errors.salaryMax)}>
              <FieldLabel htmlFor="salaryMax">Sueldo máximo</FieldLabel>
              <Input id="salaryMax" inputMode="decimal" placeholder="Opcional" {...form.register("salaryMax")} />
              <FieldError errors={[errors.salaryMax]} />
            </Field>
            <Field data-invalid={Boolean(errors.salaryCurrency)}>
              <FieldLabel htmlFor="salaryCurrency">Moneda</FieldLabel>
              <NativeSelect id="salaryCurrency" className="w-full" {...form.register("salaryCurrency")}>
                <NativeSelectOption value="">Sin definir</NativeSelectOption>
                <NativeSelectOption value="PEN">Soles (PEN)</NativeSelectOption>
                <NativeSelectOption value="USD">Dólares (USD)</NativeSelectOption>
              </NativeSelect>
              <FieldError errors={[errors.salaryCurrency]} />
            </Field>
            <Field data-invalid={Boolean(errors.salaryPeriod)}>
              <FieldLabel htmlFor="salaryPeriod">Periodo</FieldLabel>
              <NativeSelect id="salaryPeriod" className="w-full" {...form.register("salaryPeriod")}>
                <NativeSelectOption value="">Sin definir</NativeSelectOption>
                {Constants.public.Enums.salary_period.map((period) => (
                  <NativeSelectOption key={period} value={period}>
                    {SALARY_PERIOD_LABELS[period]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <FieldError errors={[errors.salaryPeriod]} />
            </Field>
          </div>
          <Controller
            control={form.control}
            name="isConfidential"
            render={({ field }) => (
              <Field orientation="horizontal">
                <Checkbox id="isConfidential" checked={field.value} onCheckedChange={(checked) => field.onChange(checked === true)} />
                <FieldLabel htmlFor="isConfidential" className="font-normal">
                  Confidencial: no aparece en la página pública, Google ni los buscadores de empleo
                </FieldLabel>
              </Field>
            )}
          />
        </fieldset>

        <div className="flex gap-2">
          <Button type="submit" disabled={pending}>
            {pending ? "Guardando…" : vacancyId ? "Guardar cambios" : "Crear vacante"}
          </Button>
          <Button type="button" variant="outline" onClick={() => router.back()} disabled={pending}>
            Cancelar
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}

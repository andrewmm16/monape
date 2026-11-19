"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useFormAction } from "@/hooks/use-form-action";
import { saveSecurityOfficer } from "@/modules/incidents/actions";
import { officerFormSchema, type OfficerFormInput } from "@/modules/incidents/schemas";

export function OfficerForm({ initialValues }: { initialValues: OfficerFormInput }) {
  const form = useForm<OfficerFormInput>({
    resolver: zodResolver(officerFormSchema, undefined, { raw: true }),
    defaultValues: initialValues,
  });
  const { submit, pending } = useFormAction(form, (values) => saveSecurityOfficer(values));
  const errors = form.formState.errors;

  return (
    <form onSubmit={submit} noValidate>
      <FieldGroup>
        <Field data-invalid={Boolean(errors.name)}>
          <FieldLabel htmlFor="officer-name">Nombre</FieldLabel>
          <Input id="officer-name" maxLength={200} autoComplete="off" {...form.register("name")} />
          <FieldError errors={[errors.name]} />
        </Field>
        <Field data-invalid={Boolean(errors.email)}>
          <FieldLabel htmlFor="officer-email">Correo</FieldLabel>
          <Input id="officer-email" type="email" maxLength={254} autoComplete="off" {...form.register("email")} />
          <FieldError errors={[errors.email]} />
        </Field>
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}

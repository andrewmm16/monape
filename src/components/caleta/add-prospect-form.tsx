"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { UserPlusIcon } from "lucide-react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { useFormAction } from "@/hooks/use-form-action";
import { CALETA_SOURCE_LABELS } from "@/lib/labels";
import { createProspect } from "@/modules/caleta/actions";
import { CALETA_SOURCES, prospectCreateSchema, type ProspectCreateInput } from "@/modules/caleta/schemas";

function defaults(vacancyId: string): ProspectCreateInput {
  return {
    vacancyId,
    fullName: "",
    headline: "",
    linkedinUrl: "",
    location: "",
    source: "linkedin",
    sourceDetail: "",
    profileText: "",
    email: "",
    phone: "",
  };
}

/** Alta de un prospecto: al guardar se puntúa contra los requisitos de la vacante. */
export function AddProspectForm({ vacancyId }: { vacancyId: string }) {
  const form = useForm<ProspectCreateInput>({
    resolver: zodResolver(prospectCreateSchema, undefined, { raw: true }),
    defaultValues: defaults(vacancyId),
  });
  const { submit, pending } = useFormAction(form, createProspect, {
    onSuccess: () => form.reset(defaults(vacancyId)),
  });
  const errors = form.formState.errors;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserPlusIcon className="size-4" aria-hidden /> Agregar prospecto
        </CardTitle>
        <CardDescription>
          Pega lo que copiaste del perfil (LinkedIn, CIP…). Se puntúa al instante contra los requisitos del puesto. El
          teléfono es opcional: se completa cuando la persona lo comparte en el contacto.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} noValidate>
          <input type="hidden" {...form.register("vacancyId")} />
          <FieldGroup className="gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field data-invalid={Boolean(errors.fullName)}>
                <FieldLabel htmlFor="fullName">Nombre</FieldLabel>
                <Input id="fullName" {...form.register("fullName")} autoComplete="off" />
                <FieldError errors={[errors.fullName]} />
              </Field>
              <Field data-invalid={Boolean(errors.headline)}>
                <FieldLabel htmlFor="headline">Titular / cargo (opcional)</FieldLabel>
                <Input id="headline" placeholder="Ingeniero Sanitario | SEDAPAL" {...form.register("headline")} />
                <FieldError errors={[errors.headline]} />
              </Field>
              <Field data-invalid={Boolean(errors.linkedinUrl)}>
                <FieldLabel htmlFor="linkedinUrl">URL de LinkedIn (opcional)</FieldLabel>
                <Input id="linkedinUrl" placeholder="https://linkedin.com/in/…" {...form.register("linkedinUrl")} />
                <FieldError errors={[errors.linkedinUrl]} />
              </Field>
              <Field data-invalid={Boolean(errors.location)}>
                <FieldLabel htmlFor="location">Ubicación (opcional)</FieldLabel>
                <Input id="location" placeholder="Lima" {...form.register("location")} />
                <FieldError errors={[errors.location]} />
              </Field>
              <Field data-invalid={Boolean(errors.source)}>
                <FieldLabel htmlFor="source">Fuente</FieldLabel>
                <NativeSelect id="source" className="w-full" {...form.register("source")}>
                  {CALETA_SOURCES.map((value) => (
                    <NativeSelectOption key={value} value={value}>
                      {CALETA_SOURCE_LABELS[value]}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <FieldError errors={[errors.source]} />
              </Field>
              <Field data-invalid={Boolean(errors.sourceDetail)}>
                <FieldLabel htmlFor="sourceDetail">Detalle de la fuente (opcional)</FieldLabel>
                <Input id="sourceDetail" placeholder="Grupo «Empleos Ingeniería Perú»" {...form.register("sourceDetail")} />
                <FieldError errors={[errors.sourceDetail]} />
              </Field>
            </div>
            <Field data-invalid={Boolean(errors.profileText)}>
              <FieldLabel htmlFor="profileText">Texto del perfil</FieldLabel>
              <Textarea
                id="profileText"
                rows={8}
                placeholder="Pega aquí la experiencia, aptitudes y formación del perfil…"
                {...form.register("profileText")}
              />
              <FieldDescription>
                A más completo el texto (experiencia, software, años), mejor puntúa el motor de reglas.
              </FieldDescription>
              <FieldError errors={[errors.profileText]} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field data-invalid={Boolean(errors.phone)}>
                <FieldLabel htmlFor="phone">Teléfono (opcional)</FieldLabel>
                <Input id="phone" placeholder="+51 9…" {...form.register("phone")} />
                <FieldError errors={[errors.phone]} />
              </Field>
              <Field data-invalid={Boolean(errors.email)}>
                <FieldLabel htmlFor="email">Correo (opcional)</FieldLabel>
                <Input id="email" type="email" {...form.register("email")} />
                <FieldError errors={[errors.email]} />
              </Field>
            </div>
            <div>
              <Button type="submit" disabled={pending}>
                {pending ? "Puntuando…" : "Agregar y puntuar"}
              </Button>
            </div>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}

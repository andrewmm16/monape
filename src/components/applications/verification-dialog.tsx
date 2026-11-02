"use client";

import { useState, type ReactNode } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
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
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { useFormAction } from "@/hooks/use-form-action";
import { VERIFICATION_SOURCE_LABELS } from "@/lib/labels";
import { removeRequirementVerification, verifyRequirements } from "@/modules/applications/actions";
import { verificationItemSchema, type VerificationItemInput } from "@/modules/applications/schemas";
import { Constants } from "@/types/database";

/** Diálogo para verificar (o cambiar la verificación de) un requisito. */
export function VerifyRequirementDialog({
  applicationId,
  requirementId,
  requirementDescription,
  initialValues,
  trigger,
}: {
  applicationId: string;
  requirementId: string;
  requirementDescription: string;
  initialValues?: { result: "acreditado" | "no_cumplido"; source: VerificationItemInput["source"]; note: string };
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const defaults: VerificationItemInput = {
    requirementId,
    result: initialValues?.result ?? "acreditado",
    source: initialValues?.source ?? "entrevista",
    note: initialValues?.note ?? "",
  };
  const form = useForm<VerificationItemInput>({
    resolver: zodResolver(verificationItemSchema, undefined, { raw: true }),
    defaultValues: defaults,
  });
  const { submit, pending } = useFormAction(form, (values) => verifyRequirements(applicationId, [values]), {
    onSuccess: () => setOpen(false),
  });
  const errors = form.formState.errors;
  const id = `verify-${requirementId}`;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) form.reset(defaults);
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Verificar requisito</DialogTitle>
          <DialogDescription>
            {requirementDescription}. Lo que registre queda separado de lo que dice el CV y recalcula la puntuación.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate>
          <FieldGroup className="gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field data-invalid={Boolean(errors.result)}>
                <FieldLabel htmlFor={`${id}-result`}>Resultado</FieldLabel>
                <NativeSelect id={`${id}-result`} className="w-full" {...form.register("result")}>
                  <NativeSelectOption value="acreditado">Cumple</NativeSelectOption>
                  <NativeSelectOption value="no_cumplido">No cumple</NativeSelectOption>
                </NativeSelect>
                <FieldError errors={[errors.result]} />
              </Field>
              <Field data-invalid={Boolean(errors.source)}>
                <FieldLabel htmlFor={`${id}-source`}>Fuente</FieldLabel>
                <NativeSelect id={`${id}-source`} className="w-full" {...form.register("source")}>
                  {Constants.public.Enums.verification_source.map((source) => (
                    <NativeSelectOption key={source} value={source}>
                      {VERIFICATION_SOURCE_LABELS[source]}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <FieldError errors={[errors.source]} />
              </Field>
            </div>
            <Field data-invalid={Boolean(errors.note)}>
              <FieldLabel htmlFor={`${id}-note`}>Nota</FieldLabel>
              <Textarea
                id={`${id}-note`}
                rows={3}
                placeholder="Ej.: Conversación fluida de 10 minutos."
                {...form.register("note")}
              />
              <FieldDescription>Obligatoria. Indique qué comprobó.</FieldDescription>
              <FieldError errors={[errors.note]} />
            </Field>
            <DialogFooter className="gap-2">
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

const removeSchema = z.object({
  note: z.string().trim().min(3, "Escriba una nota de al menos 3 caracteres").max(1000, "Máximo 1000 caracteres"),
});
type RemoveInput = z.input<typeof removeSchema>;

/** Diálogo para quitar la verificación de un requisito (exige una nota). */
export function RemoveVerificationDialog({
  applicationId,
  requirementId,
  requirementDescription,
  trigger,
}: {
  applicationId: string;
  requirementId: string;
  requirementDescription: string;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const form = useForm<RemoveInput>({
    resolver: zodResolver(removeSchema, undefined, { raw: true }),
    defaultValues: { note: "" },
  });
  const { submit, pending } = useFormAction(
    form,
    (values) => removeRequirementVerification(applicationId, requirementId, values.note),
    {
      onSuccess: () => {
        setOpen(false);
        form.reset({ note: "" });
      },
    },
  );
  const errors = form.formState.errors;
  const id = `unverify-${requirementId}`;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Quitar verificación</DialogTitle>
          <DialogDescription>
            {requirementDescription}. El requisito volverá a valorarse solo con lo que dice el CV. El cambio queda
            registrado en el historial.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate>
          <FieldGroup className="gap-3">
            <Field data-invalid={Boolean(errors.note)}>
              <FieldLabel htmlFor={`${id}-note`}>Motivo</FieldLabel>
              <Textarea id={`${id}-note`} rows={3} placeholder="Ej.: Se registró en el candidato equivocado." {...form.register("note")} />
              <FieldError errors={[errors.note]} />
            </Field>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Cancelar
              </Button>
              <Button type="submit" variant="destructive" disabled={pending}>
                {pending ? "Quitando…" : "Quitar verificación"}
              </Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
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
import { useFormAction } from "@/hooks/use-form-action";
import { activateNotice } from "@/modules/privacy/actions";
import { activateNoticeSchema, type ActivateNoticeInput } from "@/modules/privacy/schemas";

const EMPTY = { approvalReference: "", confirmed: false } as unknown as ActivateNoticeInput;

/** Activar un borrador: pide la referencia de aprobación y la confirmación de legal. */
export function NoticeActivateDialog({ noticeId, version }: { noticeId: string; version: number }) {
  const [open, setOpen] = useState(false);
  const form = useForm<ActivateNoticeInput>({
    resolver: zodResolver(activateNoticeSchema, undefined, { raw: true }),
    defaultValues: EMPTY,
  });
  const { submit, pending } = useFormAction(form, (values) => activateNotice(noticeId, values), {
    onSuccess: () => setOpen(false),
  });
  const errors = form.formState.errors;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) form.reset(EMPTY);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" type="button">
          Activar
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Activar la versión {version}</DialogTitle>
          <DialogDescription>
            La versión vigente actual, si existe, quedará retirada. Una vez activa, el texto ya no se puede modificar.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate>
          <FieldGroup>
            <Field data-invalid={Boolean(errors.approvalReference)}>
              <FieldLabel htmlFor="approval-reference">Referencia de aprobación</FieldLabel>
              <Input
                id="approval-reference"
                maxLength={500}
                placeholder="Ej.: Informe legal N.° 012-2026"
                {...form.register("approvalReference")}
              />
              <FieldDescription>Documento, correo o acta con que el área legal aprobó el texto.</FieldDescription>
              <FieldError errors={[errors.approvalReference]} />
            </Field>
            <Controller
              control={form.control}
              name="confirmed"
              render={({ field }) => (
                <Field orientation="horizontal" data-invalid={Boolean(errors.confirmed)}>
                  <Checkbox
                    id="legal-confirmed"
                    checked={field.value === true}
                    onCheckedChange={(checked) => field.onChange(checked === true)}
                  />
                  <FieldLabel htmlFor="legal-confirmed" className="font-normal">
                    Confirmo que el área legal aprobó este texto
                  </FieldLabel>
                </Field>
              )}
            />
            <FieldError errors={[errors.confirmed]} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Cancelar
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Activando…" : "Activar versión"}
              </Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}

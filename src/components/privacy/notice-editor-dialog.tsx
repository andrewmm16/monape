"use client";

import { useState, type ReactNode } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { NoticeText } from "@/components/privacy/notice-text";
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useFormAction } from "@/hooks/use-form-action";
import { createNotice, updateNotice } from "@/modules/privacy/actions";
import { noticeFormSchema, type NoticeFormInput } from "@/modules/privacy/schemas";

/** Crea (sin noticeId) o edita un borrador, con vista previa en texto plano. */
export function NoticeEditorDialog({
  noticeId,
  initialValues,
  trigger,
}: {
  noticeId?: string;
  initialValues: NoticeFormInput;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const form = useForm<NoticeFormInput>({
    resolver: zodResolver(noticeFormSchema, undefined, { raw: true }),
    defaultValues: initialValues,
  });
  const { submit, pending } = useFormAction(
    form,
    (values) => (noticeId ? updateNotice(noticeId, values) : createNotice(values)),
    { onSuccess: () => setOpen(false) },
  );
  const errors = form.formState.errors;
  const body = useWatch({ control: form.control, name: "body" });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) form.reset(initialValues);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{noticeId ? "Editar borrador" : "Nuevo borrador"}</DialogTitle>
          <DialogDescription>
            El texto se muestra siempre como texto plano: no se interpreta HTML ni Markdown. Complete los marcadores entre
            corchetes con el área legal antes de activarlo.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate>
          <FieldGroup>
            <Field data-invalid={Boolean(errors.title)}>
              <FieldLabel htmlFor="notice-title">Título</FieldLabel>
              <Input id="notice-title" maxLength={200} {...form.register("title")} />
              <FieldError errors={[errors.title]} />
            </Field>
            <Field data-invalid={Boolean(errors.body)}>
              <FieldLabel htmlFor="notice-body">Texto del aviso</FieldLabel>
              <Textarea id="notice-body" rows={12} {...form.register("body")} />
              <FieldDescription>Separe los párrafos con una línea en blanco. Máximo 20 000 caracteres.</FieldDescription>
              <FieldError errors={[errors.body]} />
            </Field>
            <section aria-label="Vista previa" className="space-y-2 rounded-md border bg-muted/40 p-4">
              <h3 className="text-sm font-medium">Vista previa</h3>
              {body?.trim() ? <NoticeText text={body} /> : <p className="text-sm text-muted-foreground">Sin texto.</p>}
            </section>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Cancelar
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Guardando…" : "Guardar borrador"}
              </Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}

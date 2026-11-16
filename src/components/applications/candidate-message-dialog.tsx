"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
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
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useFormAction } from "@/hooks/use-form-action";
import { sendCandidateMessage } from "@/modules/applications/actions";
import { candidateMessageSchema, type CandidateMessageInput } from "@/modules/applications/schemas";

export function CandidateMessageDialog({ applicationId, candidateName }: { applicationId: string; candidateName: string }) {
  const [open, setOpen] = useState(false);
  const form = useForm<CandidateMessageInput>({
    resolver: zodResolver(candidateMessageSchema, undefined, { raw: true }),
    defaultValues: { applicationId, subject: "", body: "" },
  });
  const { submit, pending } = useFormAction(form, (values) => sendCandidateMessage(values), {
    onSuccess: () => {
      setOpen(false);
      form.reset({ applicationId, subject: "", body: "" });
    },
  });
  const errors = form.formState.errors;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline">
          Escribir al candidato
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Escribir a {candidateName}</DialogTitle>
          <DialogDescription>
            Se envía un correo directo a la persona candidata. En el historial queda registrado el envío con el asunto (no el
            cuerpo). No cambia el estado del proceso.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="space-y-4">
          <Field data-invalid={Boolean(errors.subject)}>
            <FieldLabel htmlFor="cm-subject">Asunto</FieldLabel>
            <Input id="cm-subject" placeholder="Ej.: Documentos para tu entrevista" {...form.register("subject")} />
            <FieldError errors={[errors.subject]} />
          </Field>
          <Field data-invalid={Boolean(errors.body)}>
            <FieldLabel htmlFor="cm-body">Mensaje</FieldLabel>
            <Textarea id="cm-body" rows={8} {...form.register("body")} />
            <FieldDescription>
              Escriba el correo completo, con saludo y despedida. Se envía tal cual, sin texto automático.
            </FieldDescription>
            <FieldError errors={[errors.body]} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Enviando…" : "Enviar correo"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

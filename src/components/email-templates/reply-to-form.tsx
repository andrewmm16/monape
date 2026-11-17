"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { saveEmailReplyTo } from "@/modules/email-templates/actions";

/** Dirección a la que llegan las respuestas de los candidatos (Reply-To de los correos). */
export function ReplyToForm({ current }: { current: string | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(current ?? "");
  const dirty = value.trim() !== (current ?? "");

  const save = () =>
    startTransition(async () => {
      const result = await saveEmailReplyTo({ replyTo: value });
      if (result.ok) {
        toast.success(result.message ?? "Correo de respuestas guardado.");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Respuestas de los candidatos</CardTitle>
        <CardDescription>
          Los correos pueden salir desde una dirección que no recibe mensajes. Indique a qué buzón deben llegar las
          respuestas de los candidatos, por ejemplo a una invitación de la base de talentos. Sin esta dirección no se
          pueden enviar invitaciones.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (dirty && !pending) save();
          }}
        >
          <Field>
            <FieldLabel htmlFor="reply-to">Correo para respuestas</FieldLabel>
            <Input
              id="reply-to"
              type="email"
              value={value}
              maxLength={254}
              placeholder="rrhh@suempresa.com"
              autoComplete="email"
              onChange={(event) => setValue(event.target.value)}
            />
            <FieldDescription>
              {current ? `Hoy las respuestas llegan a ${current}.` : "Aún no está configurado."} Déjelo vacío y guarde para quitarlo.
            </FieldDescription>
          </Field>
          <Button type="submit" disabled={pending || !dirty}>
            {pending ? "Guardando…" : "Guardar"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

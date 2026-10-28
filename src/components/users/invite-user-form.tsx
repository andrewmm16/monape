"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { useFormAction } from "@/hooks/use-form-action";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import { inviteUserSchema, type InviteUserInput } from "@/modules/auth/schemas";
import { inviteUser } from "@/modules/users/actions";
import { Constants } from "@/types/database";

const EMPTY: InviteUserInput = { email: "", fullName: "", role: "rrhh" };

export function InviteUserForm() {
  const form = useForm<InviteUserInput>({
    resolver: zodResolver(inviteUserSchema, undefined, { raw: true }),
    defaultValues: EMPTY,
  });
  const { submit, pending } = useFormAction(form, inviteUser, { onSuccess: () => form.reset(EMPTY) });
  const errors = form.formState.errors;
  return (
    <form onSubmit={submit} noValidate className="grid gap-3 md:grid-cols-[1fr_1fr_12rem_auto] md:items-end">
      <Field data-invalid={Boolean(errors.fullName)}>
        <FieldLabel htmlFor="invite-name">Nombre</FieldLabel>
        <Input id="invite-name" {...form.register("fullName")} />
        <FieldError errors={[errors.fullName]} />
      </Field>
      <Field data-invalid={Boolean(errors.email)}>
        <FieldLabel htmlFor="invite-email">Correo corporativo</FieldLabel>
        <Input id="invite-email" type="email" {...form.register("email")} />
        <FieldError errors={[errors.email]} />
      </Field>
      <Field>
        <FieldLabel htmlFor="invite-role">Rol</FieldLabel>
        <NativeSelect id="invite-role" className="w-full" {...form.register("role")}>
          {Constants.public.Enums.app_role.map((role) => (
            <NativeSelectOption key={role} value={role}>
              {ROLE_LABELS[role]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? "Enviando…" : "Invitar"}
      </Button>
    </form>
  );
}

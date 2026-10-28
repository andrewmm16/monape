"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { requestPasswordReset, signIn, updatePassword, type FormState } from "@/modules/auth/actions";

function errorsFor(state: FormState, field: string) {
  return state.fieldErrors?.[field]?.map((message) => ({ message }));
}

export function SignInForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(signIn, {});
  return (
    <form action={action} noValidate>
      <FieldGroup>
        {state.error ? (
          <Alert variant="destructive">
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        ) : null}
        <input type="hidden" name="next" value={next ?? ""} />
        <Field data-invalid={Boolean(state.fieldErrors?.email)}>
          <FieldLabel htmlFor="email">Correo corporativo</FieldLabel>
          <Input key={state.email} id="email" name="email" type="email" autoComplete="username" required defaultValue={state.email} aria-invalid={Boolean(state.fieldErrors?.email)} />
          <FieldError errors={errorsFor(state, "email")} />
        </Field>
        <Field data-invalid={Boolean(state.fieldErrors?.password)}>
          <div className="flex items-center justify-between">
            <FieldLabel htmlFor="password">Contraseña</FieldLabel>
            <Link href="/recuperar" className="text-xs text-muted-foreground underline-offset-4 hover:underline">
              ¿Olvidó su contraseña?
            </Link>
          </div>
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
          <FieldError errors={errorsFor(state, "password")} />
        </Field>
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? "Ingresando…" : "Ingresar"}
        </Button>
      </FieldGroup>
    </form>
  );
}

export function PasswordResetRequestForm() {
  const [state, action, pending] = useActionState(requestPasswordReset, {});
  if (state.message) {
    return (
      <div className="space-y-4">
        <Alert>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
        <Button asChild variant="outline" className="w-full">
          <Link href="/ingresar">Volver a ingresar</Link>
        </Button>
      </div>
    );
  }
  return (
    <form action={action} noValidate>
      <FieldGroup>
        <Field data-invalid={Boolean(state.fieldErrors?.email)}>
          <FieldLabel htmlFor="email">Correo corporativo</FieldLabel>
          <Input key={state.email} id="email" name="email" type="email" autoComplete="email" required defaultValue={state.email} />
          <FieldError errors={errorsFor(state, "email")} />
        </Field>
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? "Enviando…" : "Enviar enlace"}
        </Button>
        <Link href="/ingresar" className="text-center text-sm text-muted-foreground underline-offset-4 hover:underline">
          Volver a ingresar
        </Link>
      </FieldGroup>
    </form>
  );
}

export function NewPasswordForm() {
  const [state, action, pending] = useActionState(updatePassword, {});
  return (
    <form action={action} noValidate>
      <FieldGroup>
        {state.error ? (
          <Alert variant="destructive">
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        ) : null}
        <Field data-invalid={Boolean(state.fieldErrors?.password)}>
          <FieldLabel htmlFor="password">Nueva contraseña</FieldLabel>
          <Input id="password" name="password" type="password" autoComplete="new-password" required />
          <FieldError errors={errorsFor(state, "password")} />
        </Field>
        <Field data-invalid={Boolean(state.fieldErrors?.confirmation)}>
          <FieldLabel htmlFor="confirmation">Repita la contraseña</FieldLabel>
          <Input id="confirmation" name="confirmation" type="password" autoComplete="new-password" required />
          <FieldError errors={errorsFor(state, "confirmation")} />
        </Field>
        <p className="text-xs text-muted-foreground">Mínimo 12 caracteres, con letras y números.</p>
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? "Guardando…" : "Guardar contraseña"}
        </Button>
      </FieldGroup>
    </form>
  );
}

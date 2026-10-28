"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { BadgeCheckIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useForm } from "react-hook-form";
import { ActionButton } from "@/components/common/action-button";
import { OriginBadge } from "@/components/common/badges";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { useFormAction } from "@/hooks/use-form-action";
import { formatDate } from "@/lib/format";
import { DATA_ORIGIN_LABELS, PROFILE_ITEM_KIND_LABELS } from "@/lib/labels";
import { addProfileItem, deleteProfileItem, verifyProfileItem } from "@/modules/candidates/actions";
import { profileItemSchema, type ProfileItemInput } from "@/modules/candidates/schemas";
import { Constants, type Tables } from "@/types/database";

type Item = Tables<"candidate_profile_items"> & { verifier: { full_name: string } | null };

const EMPTY: ProfileItemInput = {
  kind: "experiencia",
  title: "",
  organization: "",
  startDate: "",
  endDate: "",
  description: "",
  origin: "declarado",
};

function AddItemForm({ candidateId, onDone }: { candidateId: string; onDone: () => void }) {
  const form = useForm<ProfileItemInput>({
    resolver: zodResolver(profileItemSchema, undefined, { raw: true }),
    defaultValues: EMPTY,
  });
  const { submit, pending } = useFormAction(form, (values) => addProfileItem(candidateId, values), {
    onSuccess: () => {
      form.reset(EMPTY);
      onDone();
    },
  });
  const errors = form.formState.errors;
  return (
    <form onSubmit={submit} noValidate className="rounded-md border p-4">
      <FieldGroup>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="kind">Tipo</FieldLabel>
            <NativeSelect id="kind" className="w-full" {...form.register("kind")}>
              {Constants.public.Enums.profile_item_kind.map((kind) => (
                <NativeSelectOption key={kind} value={kind}>
                  {PROFILE_ITEM_KIND_LABELS[kind]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor="origin">Origen del dato</FieldLabel>
            <NativeSelect id="origin" className="w-full" {...form.register("origin")}>
              {Constants.public.Enums.data_origin.map((origin) => (
                <NativeSelectOption key={origin} value={origin}>
                  {DATA_ORIGIN_LABELS[origin]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field data-invalid={Boolean(errors.title)}>
            <FieldLabel htmlFor="title">Cargo, título o habilidad</FieldLabel>
            <Input id="title" {...form.register("title")} />
            <FieldError errors={[errors.title]} />
          </Field>
          <Field data-invalid={Boolean(errors.organization)}>
            <FieldLabel htmlFor="organization">Empresa, institución o emisor</FieldLabel>
            <Input id="organization" {...form.register("organization")} />
            <FieldError errors={[errors.organization]} />
          </Field>
          <Field data-invalid={Boolean(errors.startDate)}>
            <FieldLabel htmlFor="startDate">Desde</FieldLabel>
            <Input id="startDate" type="date" {...form.register("startDate")} />
            <FieldError errors={[errors.startDate]} />
          </Field>
          <Field data-invalid={Boolean(errors.endDate)}>
            <FieldLabel htmlFor="endDate">Hasta</FieldLabel>
            <Input id="endDate" type="date" {...form.register("endDate")} />
            <FieldError errors={[errors.endDate]} />
          </Field>
        </div>
        <Field data-invalid={Boolean(errors.description)}>
          <FieldLabel htmlFor="description">Descripción</FieldLabel>
          <Textarea id="description" rows={2} {...form.register("description")} />
          <FieldError errors={[errors.description]} />
        </Field>
        <div className="flex gap-2">
          <Button type="submit" disabled={pending}>
            {pending ? "Guardando…" : "Agregar"}
          </Button>
          <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
            Cancelar
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}

export function ProfileItemsSection({ candidateId, items, canManage }: { candidateId: string; items: Item[]; canManage: boolean }) {
  const [adding, setAdding] = useState(false);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Perfil profesional</CardTitle>
        <CardDescription>
          Experiencia, formación, habilidades y certificaciones. Que algo no figure aquí no significa que la persona no lo
          tenga.
        </CardDescription>
        {canManage && !adding ? (
          <CardAction>
            <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
              <PlusIcon /> Agregar
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {adding ? <AddItemForm candidateId={candidateId} onDone={() => setAdding(false)} /> : null}
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin registros.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {items.map((item) => (
              <li key={item.id} className="flex flex-col gap-2 px-3 py-2 text-sm sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted-foreground">{PROFILE_ITEM_KIND_LABELS[item.kind]}</span>
                    <OriginBadge origin={item.origin} />
                  </div>
                  <div className="font-medium">{item.title}</div>
                  {item.organization ? <div className="text-muted-foreground">{item.organization}</div> : null}
                  {item.start_date || item.end_date ? (
                    <div className="text-xs text-muted-foreground">
                      {formatDate(item.start_date)} – {item.end_date ? formatDate(item.end_date) : "actualidad"}
                    </div>
                  ) : null}
                  {item.description ? <p className="mt-1 text-xs whitespace-pre-wrap">{item.description}</p> : null}
                  {item.origin === "verificado" && item.verifier ? (
                    <div className="text-xs text-muted-foreground">Verificado por {item.verifier.full_name}</div>
                  ) : null}
                </div>
                {canManage ? (
                  <div className="flex gap-1">
                    {item.origin !== "verificado" ? (
                      <ActionButton size="xs" variant="ghost" action={verifyProfileItem.bind(null, candidateId, item.id)}>
                        <BadgeCheckIcon /> Verificar
                      </ActionButton>
                    ) : null}
                    <ActionButton
                      size="icon-xs"
                      variant="ghost"
                      action={deleteProfileItem.bind(null, candidateId, item.id)}
                      confirm={{ title: "¿Eliminar registro?", description: "Se eliminará del perfil del candidato.", confirmLabel: "Eliminar" }}
                    >
                      <Trash2Icon aria-label="Eliminar" />
                    </ActionButton>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

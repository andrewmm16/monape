"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { TriangleAlertIcon } from "lucide-react";
import { useForm } from "react-hook-form";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { useFormAction } from "@/hooks/use-form-action";
import { CANDIDATE_SOURCE_LABELS } from "@/lib/labels";
import {
  createCandidate,
  updateCandidate,
  type CreateCandidateResult,
  type DuplicateMatch,
} from "@/modules/candidates/actions";
import { createCandidateSchema, type CreateCandidateInput } from "@/modules/candidates/schemas";
import { Constants } from "@/types/database";

const REASON_LABELS: Record<string, string> = { correo: "mismo correo", telefono: "mismo teléfono", nombre: "mismo nombre" };

type Props = {
  candidateId?: string;
  defaultValues: CreateCandidateInput;
  vacancies?: { id: string; title: string }[];
  onDone?: () => void;
};

export function CandidateForm({ candidateId, defaultValues, vacancies, onDone }: Props) {
  const router = useRouter();
  const [duplicates, setDuplicates] = useState<DuplicateMatch[]>([]);
  const form = useForm<CreateCandidateInput>({
    resolver: zodResolver(createCandidateSchema, undefined, { raw: true }),
    defaultValues,
  });

  const { submit, pending } = useFormAction<CreateCandidateInput, CreateCandidateResult | { status: "updated" }>(
    form,
    async (values) => {
      if (candidateId) {
        const result = await updateCandidate(candidateId, values);
        return result.ok ? { ...result, data: { status: "updated" as const } } : result;
      }
      return createCandidate(values);
    },
    {
      refresh: false,
      onSuccess: (data) => {
        if (data.status === "duplicates") {
          setDuplicates(data.duplicates);
          return;
        }
        if (data.status === "created") router.push(`/candidatos/${data.id}`);
        else {
          onDone?.();
          router.refresh();
        }
      },
    },
  );
  const errors = form.formState.errors;

  const confirmCreation = () => {
    form.setValue("confirmDuplicate", true);
    setDuplicates([]);
    void submit();
  };

  return (
    <form onSubmit={submit} noValidate className="max-w-3xl">
      <FieldGroup>
        <AlertDialog open={duplicates.length > 0} onOpenChange={(open) => !open && setDuplicates([])}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogMedia className="bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-200">
                <TriangleAlertIcon />
              </AlertDialogMedia>
              <AlertDialogTitle>Posibles candidatos duplicados</AlertDialogTitle>
              <AlertDialogDescription>
                Ya hay {duplicates.length === 1 ? "un candidato" : `${duplicates.length} candidatos`} con datos
                parecidos. Revise si la persona ya está registrada antes de crear un nuevo registro.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <ul className="space-y-1 rounded-md border px-3 py-2 text-sm">
              {duplicates.map((duplicate) => (
                <li key={duplicate.id}>
                  <Link href={`/candidatos/${duplicate.id}`} className="font-medium underline" target="_blank">
                    {duplicate.full_name}
                  </Link>{" "}
                  <span className="text-muted-foreground">
                    ({duplicate.match_reasons.map((r) => REASON_LABELS[r] ?? r).join(", ")})
                  </span>
                </li>
              ))}
            </ul>
            <AlertDialogFooter>
              <AlertDialogCancel>Revisar datos</AlertDialogCancel>
              <AlertDialogAction
                disabled={pending}
                onClick={(event) => {
                  event.preventDefault();
                  confirmCreation();
                }}
              >
                Es otra persona: registrar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <Field data-invalid={Boolean(errors.fullName)}>
          <FieldLabel htmlFor="fullName">Nombre completo</FieldLabel>
          <Input id="fullName" autoComplete="off" {...form.register("fullName")} aria-invalid={Boolean(errors.fullName)} />
          <FieldError errors={[errors.fullName]} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={Boolean(errors.email)}>
            <FieldLabel htmlFor="email">Correo</FieldLabel>
            <Input id="email" type="email" autoComplete="off" {...form.register("email")} />
            <FieldError errors={[errors.email]} />
          </Field>
          <Field data-invalid={Boolean(errors.phone)}>
            <FieldLabel htmlFor="phone">Teléfono</FieldLabel>
            <Input id="phone" autoComplete="off" {...form.register("phone")} />
            <FieldError errors={[errors.phone]} />
          </Field>
          <Field data-invalid={Boolean(errors.location)}>
            <FieldLabel htmlFor="location">Ubicación</FieldLabel>
            <Input id="location" placeholder="Ciudad / región" {...form.register("location")} />
            <FieldError errors={[errors.location]} />
          </Field>
          <Field data-invalid={Boolean(errors.linkedinUrl)}>
            <FieldLabel htmlFor="linkedinUrl">Perfil de LinkedIn</FieldLabel>
            <Input id="linkedinUrl" placeholder="https://www.linkedin.com/in/…" {...form.register("linkedinUrl")} />
            <FieldError errors={[errors.linkedinUrl]} />
          </Field>
          <Field>
            <FieldLabel htmlFor="source">Fuente de la candidatura</FieldLabel>
            <NativeSelect id="source" className="w-full" {...form.register("source")}>
              {Constants.public.Enums.candidate_source.map((source) => (
                <NativeSelectOption key={source} value={source}>
                  {CANDIDATE_SOURCE_LABELS[source]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field data-invalid={Boolean(errors.sourceDetail)}>
            <FieldLabel htmlFor="sourceDetail">Detalle de la fuente</FieldLabel>
            <Input id="sourceDetail" placeholder="Ej.: nombre de quien refiere" {...form.register("sourceDetail")} />
            <FieldError errors={[errors.sourceDetail]} />
          </Field>
        </div>
        {vacancies ? (
          <Field>
            <FieldLabel htmlFor="vacancyId">Postula a</FieldLabel>
            <NativeSelect id="vacancyId" className="w-full" {...form.register("vacancyId")}>
              <NativeSelectOption value="">Sin vacante por ahora</NativeSelectOption>
              {vacancies.map((vacancy) => (
                <NativeSelectOption key={vacancy.id} value={vacancy.id}>
                  {vacancy.title}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <FieldDescription>Solo vacantes en borrador o publicadas.</FieldDescription>
          </Field>
        ) : null}
        <p className="text-xs text-muted-foreground">
          Registre solo los datos necesarios para el proceso de selección. No ingrese datos sensibles (salud, religión,
          afiliaciones, etc.).
        </p>
        <div className="flex gap-2">
          <Button type="submit" disabled={pending}>
            {pending ? "Guardando…" : candidateId ? "Guardar cambios" : "Registrar candidato"}
          </Button>
          {onDone ? (
            <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
              Cancelar
            </Button>
          ) : null}
        </div>
      </FieldGroup>
    </form>
  );
}

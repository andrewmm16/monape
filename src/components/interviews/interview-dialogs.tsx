"use client";

import { useEffect, useState, type ReactNode } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
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
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { useFormAction } from "@/hooks/use-form-action";
import type { ActionResult } from "@/lib/action-result";
import { ASSESSMENT_LABELS, APPLICATION_STATUS_LABELS, INTERVIEW_MODALITY_LABELS, REQUIREMENT_PRIORITY_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";
import {
  cancelInterview,
  loadInterviewRequirements,
  recordInterviewResult,
  rescheduleInterview,
  scheduleInterview,
} from "@/modules/interviews/actions";
import { isoToLima, limaToIso } from "@/modules/interviews/datetime";
import {
  cancelInterviewSchema,
  CLOSED_STATUSES,
  interviewFormSchema,
  recordResultFormSchema,
  type InterviewFormValues,
  type InterviewRequirement,
  type RecordResultFormValues,
} from "@/modules/interviews/schemas";
import { Constants, type Enums } from "@/types/database";

const DAY_MS = 24 * 60 * 60 * 1000;

function defaultScheduleValues(): InterviewFormValues {
  return {
    date: isoToLima(new Date(Date.now() + DAY_MS)).date,
    time: "10:00",
    durationMinutes: "45",
    modality: "presencial",
    location: "",
    interviewers: "",
    instructions: "",
  };
}

export type InterviewForEdit = {
  id: string;
  scheduled_at: string;
  duration_minutes: number;
  modality: Enums<"interview_modality">;
  location: string | null;
  interviewers: string | null;
  instructions: string | null;
};

function valuesOf(interview: InterviewForEdit): InterviewFormValues {
  const { date, time } = isoToLima(interview.scheduled_at);
  return {
    date,
    time,
    durationMinutes: String(interview.duration_minutes),
    modality: interview.modality,
    location: interview.location ?? "",
    interviewers: interview.interviewers ?? "",
    instructions: interview.instructions ?? "",
  };
}

type FormDialogProps = {
  trigger?: ReactNode;
  defaultOpen?: boolean;
} & (
  | { applicationId: string; interview?: undefined }
  | { interview: InterviewForEdit; applicationId?: undefined }
);

/** Agendar (con `applicationId`) o reprogramar (con `interview`) una entrevista. */
export function InterviewFormDialog({ trigger, defaultOpen = false, applicationId, interview }: FormDialogProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [openedAt, setOpenedAt] = useState(() => Date.now());
  const editing = Boolean(interview);
  const form = useForm<InterviewFormValues>({
    resolver: zodResolver(interviewFormSchema, undefined, { raw: true }),
    defaultValues: interview ? valuesOf(interview) : defaultScheduleValues(),
  });
  const { submit, pending } = useFormAction(
    form,
    (values): Promise<ActionResult<unknown>> =>
      interview
        ? rescheduleInterview({ interviewId: interview.id, ...values })
        : scheduleInterview({ applicationId: applicationId!, ...values }),
    { onSuccess: () => setOpen(false) },
  );
  const errors = form.formState.errors;
  const id = `interview-${interview?.id ?? applicationId}`;

  const [date, time] = useWatch({ control: form.control, name: ["date", "time"] });
  const iso = limaToIso(date, time);
  const isPastDate = iso !== null && Date.parse(iso) < openedAt;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          form.reset(interview ? valuesOf(interview) : defaultScheduleValues());
          setOpenedAt(Date.now());
        }
        setOpen(next);
      }}
    >
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Reprogramar entrevista" : "Programar entrevista"}</DialogTitle>
          <DialogDescription>
            Fecha y hora de Perú (Lima).{" "}
            {editing
              ? "El cambio queda registrado en el historial."
              : "La postulación pasará a «Entrevista programada» si aún no lo está."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate>
          <FieldGroup className="gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field data-invalid={Boolean(errors.date)}>
                <FieldLabel htmlFor={`${id}-date`}>Fecha</FieldLabel>
                <Input id={`${id}-date`} type="date" {...form.register("date")} />
                <FieldError errors={[errors.date]} />
              </Field>
              <Field data-invalid={Boolean(errors.time)}>
                <FieldLabel htmlFor={`${id}-time`}>Hora</FieldLabel>
                <Input id={`${id}-time`} type="time" {...form.register("time")} />
                <FieldError errors={[errors.time]} />
              </Field>
            </div>
            {isPastDate ? (
              <p
                role="status"
                className="rounded-md border border-warning-foreground/40 bg-warning px-3 py-2 text-sm text-warning-foreground"
              >
                La fecha ya pasó. Se admite para registrar una entrevista que ya se hizo; después podrá registrar su resultado.
              </p>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field data-invalid={Boolean(errors.durationMinutes)}>
                <FieldLabel htmlFor={`${id}-duration`}>Duración (minutos)</FieldLabel>
                <Input id={`${id}-duration`} type="number" inputMode="numeric" min={15} max={480} step={5} {...form.register("durationMinutes")} />
                <FieldError errors={[errors.durationMinutes]} />
              </Field>
              <Field data-invalid={Boolean(errors.modality)}>
                <FieldLabel htmlFor={`${id}-modality`}>Modalidad</FieldLabel>
                <NativeSelect id={`${id}-modality`} className="w-full" {...form.register("modality")}>
                  {Constants.public.Enums.interview_modality.map((modality) => (
                    <NativeSelectOption key={modality} value={modality}>
                      {INTERVIEW_MODALITY_LABELS[modality]}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <FieldError errors={[errors.modality]} />
              </Field>
            </div>
            <Field data-invalid={Boolean(errors.location)}>
              <FieldLabel htmlFor={`${id}-location`}>Lugar o enlace</FieldLabel>
              <Input id={`${id}-location`} placeholder="Dirección o enlace de la reunión" {...form.register("location")} />
              <FieldError errors={[errors.location]} />
            </Field>
            <Field data-invalid={Boolean(errors.interviewers)}>
              <FieldLabel htmlFor={`${id}-interviewers`}>Entrevistadores</FieldLabel>
              <Input id={`${id}-interviewers`} placeholder="Nombres, separados por comas" {...form.register("interviewers")} />
              <FieldDescription>Pueden ser personas que no usan la plataforma.</FieldDescription>
              <FieldError errors={[errors.interviewers]} />
            </Field>
            <Field data-invalid={Boolean(errors.instructions)}>
              <FieldLabel htmlFor={`${id}-instructions`}>Indicaciones</FieldLabel>
              <Textarea id={`${id}-instructions`} rows={3} placeholder="Opcional" {...form.register("instructions")} />
              <FieldError errors={[errors.instructions]} />
            </Field>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Cancelar
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Guardando…" : editing ? "Reprogramar" : "Programar"}
              </Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Cancela una entrevista programada (motivo obligatorio). */
export function CancelInterviewDialog({
  interviewId,
  applicationStatus,
  trigger,
}: {
  interviewId: string;
  applicationStatus: Enums<"application_status">;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const form = useForm<{ reason: string }>({
    resolver: zodResolver(cancelInterviewSchema.pick({ reason: true }), undefined, { raw: true }),
    defaultValues: { reason: "" },
  });
  const { submit, pending } = useFormAction(form, (values) => cancelInterview({ interviewId, reason: values.reason }), {
    onSuccess: () => setOpen(false),
  });
  const errors = form.formState.errors;
  const id = `cancel-interview-${interviewId}`;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) form.reset({ reason: "" });
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Cancelar entrevista</DialogTitle>
          <DialogDescription>
            La entrevista queda cancelada y registrada en el historial. La postulación mantiene su estado actual (
            {APPLICATION_STATUS_LABELS[applicationStatus]}); si ya no corresponde, puede cambiarlo a mano en su ficha.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate>
          <FieldGroup className="gap-3">
            <Field data-invalid={Boolean(errors.reason)}>
              <FieldLabel htmlFor={`${id}-reason`}>Motivo</FieldLabel>
              <Textarea id={`${id}-reason`} rows={3} placeholder="Ej.: El candidato pidió otra fecha." {...form.register("reason")} />
              <FieldError errors={[errors.reason]} />
            </Field>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Volver
              </Button>
              <Button type="submit" variant="destructive" disabled={pending}>
                {pending ? "Cancelando…" : "Cancelar entrevista"}
              </Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const OUTCOME_OPTIONS = [
  { value: "paso", label: "Pasó" },
  { value: "no_paso", label: "No pasó" },
  { value: "no_asistio", label: "No asistió" },
] as const;

/** Qué pasará con la postulación al registrar cada resultado. */
function consequenceText(
  outcome: RecordResultFormValues["outcome"] | undefined,
  status: Enums<"application_status">,
  vacancyArchived: boolean,
): string | null {
  if (!outcome) return null;
  const closed = vacancyArchived || (CLOSED_STATUSES as readonly string[]).includes(status);
  if (outcome === "no_asistio") {
    return `La postulación mantiene su estado (${APPLICATION_STATUS_LABELS[status]}). Si corresponde, puede cambiarlo a mano en su ficha.`;
  }
  if (closed) {
    return `La entrevista queda registrada, pero la postulación no cambia de estado (${APPLICATION_STATUS_LABELS[status]}).`;
  }
  if (outcome === "paso") {
    return status === "en_evaluacion"
      ? "La postulación ya está «En evaluación»; no cambia de estado."
      : "La postulación pasará a «En evaluación».";
  }
  return "La postulación pasará a «No seleccionado» y se moverá a Descartados; se puede reactivar cambiando su estado. No se borra nada.";
}

/** Registra el resultado de una entrevista y, opcionalmente, los requisitos comprobados en ella. */
export function RecordResultDialog({
  interviewId,
  scheduledLabel,
  applicationStatus,
  vacancyArchived,
  trigger,
}: {
  interviewId: string;
  /** Fecha y hora ya formateadas, para el título. */
  scheduledLabel: string;
  applicationStatus: Enums<"application_status">;
  vacancyArchived: boolean;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [requirements, setRequirements] = useState<InterviewRequirement[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const form = useForm<RecordResultFormValues>({
    resolver: zodResolver(recordResultFormSchema, undefined, { raw: true }),
    defaultValues: { outcome: undefined, notes: "", checks: [] },
  });
  const { submit, pending } = useFormAction(
    form,
    (values) =>
      recordInterviewResult({
        interviewId,
        outcome: values.outcome,
        notes: values.notes,
        verifications:
          values.outcome === "no_asistio"
            ? []
            : values.checks.flatMap((check) =>
                check.choice ? [{ requirementId: check.requirementId, result: check.choice, note: check.note }] : [],
              ),
      }),
    { onSuccess: () => setOpen(false) },
  );
  const errors = form.formState.errors;
  const id = `result-${interviewId}`;
  const outcome = useWatch({ control: form.control, name: "outcome" });
  const checks = useWatch({ control: form.control, name: "checks" });

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void loadInterviewRequirements(interviewId).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setLoadError(result.error);
        setRequirements([]);
        return;
      }
      setLoadError(null);
      setRequirements(result.data);
      form.setValue(
        "checks",
        result.data.map((requirement) => ({ requirementId: requirement.id, choice: "" as const, note: "" })),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [open, interviewId, form]);

  const consequence = consequenceText(outcome, applicationStatus, vacancyArchived);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          form.reset({ outcome: undefined, notes: "", checks: [] });
          setRequirements(null);
          setLoadError(null);
        }
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Registrar resultado</DialogTitle>
          <DialogDescription>Entrevista del {scheduledLabel}. El resultado queda en el historial de la postulación.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate>
          <FieldGroup className="gap-3">
            <fieldset className="space-y-2" aria-describedby={errors.outcome ? `${id}-outcome-error` : undefined}>
              <legend className="mb-1 text-sm font-medium">Resultado</legend>
              <div className="grid gap-2 sm:grid-cols-3">
                {OUTCOME_OPTIONS.map((option) => (
                  <label
                    key={option.value}
                    className={cn(
                      "flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:border-brand/60",
                      outcome === option.value && "border-brand bg-brand/5 font-medium",
                    )}
                  >
                    <input type="radio" value={option.value} className="size-4 accent-primary" {...form.register("outcome")} />
                    {option.label}
                  </label>
                ))}
              </div>
              <div id={`${id}-outcome-error`}>
                <FieldError errors={[errors.outcome]} />
              </div>
            </fieldset>

            {consequence ? (
              <p role="status" className="rounded-md bg-muted px-3 py-2 text-sm" data-testid="interview-consequence">
                {consequence}
              </p>
            ) : null}

            <Field data-invalid={Boolean(errors.notes)}>
              <FieldLabel htmlFor={`${id}-notes`}>
                {outcome === "no_paso" ? "Motivo (obligatorio)" : "Notas de la entrevista"}
              </FieldLabel>
              <Textarea id={`${id}-notes`} rows={3} placeholder={outcome === "no_paso" ? "Ej.: No cumple la experiencia requerida." : "Opcional"} {...form.register("notes")} />
              <FieldError errors={[errors.notes]} />
            </Field>

            {outcome && outcome !== "no_asistio" ? (
              <fieldset className="space-y-2 rounded-md border p-3">
                <legend className="px-1 text-sm font-medium">Requisitos comprobados en la entrevista</legend>
                <p className="text-xs text-muted-foreground">
                  Opcional. Lo que marque se guarda como verificado en entrevista y recalcula la puntuación.
                </p>
                {requirements === null ? (
                  <p className="text-sm text-muted-foreground">Cargando requisitos…</p>
                ) : loadError ? (
                  <p className="text-sm text-destructive">{loadError}</p>
                ) : requirements.length === 0 ? (
                  <p className="text-sm text-muted-foreground">La vacante no tiene requisitos vigentes.</p>
                ) : (
                  <ul className="space-y-3">
                    {requirements.map((requirement, index) => (
                      <li key={requirement.id} className="space-y-2 rounded-md border p-2">
                        <div className="text-sm font-medium">{requirement.description}</div>
                        <div className="text-xs text-muted-foreground">
                          {REQUIREMENT_PRIORITY_LABELS[requirement.priority]} · Valoración actual:{" "}
                          {requirement.assessment ? ASSESSMENT_LABELS[requirement.assessment] : "sin evaluación"}
                          {requirement.verified ? " (verificada por RRHH)" : ""}
                        </div>
                        <div className="grid gap-2 sm:grid-cols-[11rem_1fr]">
                          <NativeSelect
                            aria-label={`Resultado de «${requirement.description}»`}
                            className="w-full"
                            {...form.register(`checks.${index}.choice`)}
                          >
                            <option value="">Sin cambios</option>
                            <option value="acreditado">Cumple</option>
                            <option value="no_cumplido">No cumple</option>
                          </NativeSelect>
                          {checks?.[index]?.choice ? (
                            <div>
                              <Input
                                aria-label={`Nota de «${requirement.description}»`}
                                placeholder="Nota (opcional)"
                                {...form.register(`checks.${index}.note`)}
                              />
                              <FieldError errors={[errors.checks?.[index]?.note]} />
                            </div>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </fieldset>
            ) : null}

            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Cancelar
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Guardando…" : "Registrar resultado"}
              </Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}

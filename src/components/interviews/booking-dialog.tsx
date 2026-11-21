"use client";

import { useState, type ReactNode } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { useRouter } from "next/navigation";
import { CopyIcon, PlusIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
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
import { INTERVIEW_MODALITY_LABELS } from "@/lib/labels";
import { bookingFormSchema, MAX_BOOKING_SLOTS, type BookingFormValues } from "@/modules/interviews/booking";
import { inviteToBook } from "@/modules/interviews/actions";
import { isoToLima } from "@/modules/interviews/datetime";
import { Constants } from "@/types/database";

const DAY_MS = 24 * 60 * 60 * 1000;

function defaults(): BookingFormValues {
  const tomorrow = isoToLima(new Date(Date.now() + DAY_MS)).date;
  return {
    slots: [
      { date: tomorrow, time: "10:00" },
      { date: tomorrow, time: "15:00" },
    ],
    durationMinutes: "45",
    modality: "virtual",
    location: "",
    interviewers: "",
    interviewerEmails: "",
    instructions: "",
    deadlineDate: "",
    deadlineTime: "",
  };
}

const LOCATION_LABEL = {
  presencial: { label: "Dirección", placeholder: "Calle, número y distrito" },
  virtual: { label: "Enlace de la reunión", placeholder: "https://…" },
  telefonica: { label: "Teléfono o indicación", placeholder: "Opcional" },
} as const;

/**
 * «Invitar a agendar» (autoagenda): RRHH ofrece de 1 a 6 horarios y la persona
 * elige uno desde su enlace. Al crearla se muestra el enlace para copiarlo
 * (siempre; imprescindible si la persona no tiene correo).
 */
export function BookingDialog({
  applicationId,
  trigger,
  hideTrigger = false,
}: {
  applicationId: string;
  trigger: ReactNode;
  /** Con una invitación pendiente se oculta el botón, pero el diálogo sigue montado (con el enlace a la vista). */
  hideTrigger?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<{ url: string; emailed: boolean } | null>(null);
  const router = useRouter();
  const form = useForm<BookingFormValues>({
    resolver: zodResolver(bookingFormSchema, undefined, { raw: true }),
    defaultValues: defaults(),
  });
  const slots = useFieldArray({ control: form.control, name: "slots" });
  // Sin refrescar al crearla: con la invitación pendiente la página quita este botón (y el
  // diálogo con el enlace). Se refresca al cerrar, cuando RRHH ya copió el enlace.
  const { submit, pending } = useFormAction(form, (values) => inviteToBook({ applicationId, ...values }), {
    onSuccess: (data) => setResult(data),
    refresh: false,
  });
  const modality = useWatch({ control: form.control, name: "modality" });
  const errors = form.formState.errors;
  const id = `booking-${applicationId}`;
  const location = LOCATION_LABEL[modality] ?? LOCATION_LABEL.virtual;
  // Errores de los horarios: de la lista (cuántos) y de cada fila (fecha u hora).
  const slotErrors = [
    errors.slots?.root,
    errors.slots?.message ? { message: errors.slots.message } : undefined,
    ...slots.fields.flatMap((_, index) => [errors.slots?.[index]?.date, errors.slots?.[index]?.time]),
  ];

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Enlace copiado.");
    } catch {
      toast.error("No se pudo copiar: selecciónelo y cópielo a mano.");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          form.reset(defaults());
          setResult(null);
        } else if (result) {
          router.refresh();
        }
        setOpen(next);
      }}
    >
      {hideTrigger ? null : <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Invitar a agendar</DialogTitle>
          <DialogDescription>
            Ofrezca de 1 a {MAX_BOOKING_SLOTS} horarios (hora de Lima). La persona elige uno desde su enlace y la entrevista se
            programa sola.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-3" data-testid="booking-result">
            <p className="text-sm">
              {result.emailed
                ? "Le enviamos el correo con los horarios. También puede compartirle este enlace:"
                : "No se envió el correo (la persona no tiene correo o el envío está desactivado). Copie este enlace y envíeselo:"}
            </p>
            <div className="flex gap-2">
              <Input readOnly value={result.url} aria-label="Enlace para elegir horario" onFocus={(e) => e.currentTarget.select()} />
              <Button type="button" variant="outline" onClick={() => copy(result.url)}>
                <CopyIcon /> Copiar
              </Button>
            </div>
            <DialogFooter>
              <Button
                type="button"
                onClick={() => {
                  setOpen(false);
                  router.refresh();
                }}
              >
                Listo
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={submit} noValidate>
            <FieldGroup className="gap-3">
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Horarios</legend>
                {slots.fields.map((field, index) => (
                  <div key={field.id} className="flex items-end gap-2">
                    <Field className="flex-1" data-invalid={Boolean(errors.slots?.[index]?.date)}>
                      <FieldLabel htmlFor={`${id}-date-${index}`} className="sr-only">
                        Fecha del horario {index + 1}
                      </FieldLabel>
                      <Input id={`${id}-date-${index}`} type="date" {...form.register(`slots.${index}.date`)} />
                    </Field>
                    <Field className="w-32" data-invalid={Boolean(errors.slots?.[index]?.time)}>
                      <FieldLabel htmlFor={`${id}-time-${index}`} className="sr-only">
                        Hora del horario {index + 1}
                      </FieldLabel>
                      <Input id={`${id}-time-${index}`} type="time" {...form.register(`slots.${index}.time`)} />
                    </Field>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Quitar el horario ${index + 1}`}
                      disabled={slots.fields.length === 1}
                      onClick={() => slots.remove(index)}
                    >
                      <XIcon />
                    </Button>
                  </div>
                ))}
                <FieldError errors={slotErrors} />
                {slots.fields.length < MAX_BOOKING_SLOTS ? (
                  <Button type="button" variant="outline" size="sm" onClick={() => slots.append({ date: "", time: "" })}>
                    <PlusIcon /> Agregar horario
                  </Button>
                ) : null}
              </fieldset>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field data-invalid={Boolean(errors.durationMinutes)}>
                  <FieldLabel htmlFor={`${id}-duration`}>Duración (minutos)</FieldLabel>
                  <Input id={`${id}-duration`} type="number" inputMode="numeric" min={15} max={480} step={5} {...form.register("durationMinutes")} />
                  <FieldError errors={[errors.durationMinutes]} />
                </Field>
                <Field data-invalid={Boolean(errors.modality)}>
                  <FieldLabel htmlFor={`${id}-modality`}>Modalidad</FieldLabel>
                  <NativeSelect id={`${id}-modality`} {...form.register("modality")}>
                    {Constants.public.Enums.interview_modality.map((value) => (
                      <NativeSelectOption key={value} value={value}>
                        {INTERVIEW_MODALITY_LABELS[value]}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  <FieldError errors={[errors.modality]} />
                </Field>
              </div>
              <Field data-invalid={Boolean(errors.location)}>
                <FieldLabel htmlFor={`${id}-location`}>{location.label}</FieldLabel>
                <Input id={`${id}-location`} autoComplete="off" placeholder={location.placeholder} {...form.register("location")} />
                <FieldError errors={[errors.location]} />
              </Field>
              <Field data-invalid={Boolean(errors.interviewers)}>
                <FieldLabel htmlFor={`${id}-interviewers`}>Entrevistadores</FieldLabel>
                <Input id={`${id}-interviewers`} placeholder="Nombres, separados por comas" {...form.register("interviewers")} />
                <FieldError errors={[errors.interviewers]} />
              </Field>
              <Field data-invalid={Boolean(errors.interviewerEmails)}>
                <FieldLabel htmlFor={`${id}-emails`}>Correos de los entrevistadores</FieldLabel>
                <Input id={`${id}-emails`} inputMode="email" autoComplete="off" placeholder="Opcional. Separados por comas" {...form.register("interviewerEmails")} />
                <FieldDescription>Reciben el aviso cuando la persona elige y el recordatorio de siempre.</FieldDescription>
                <FieldError errors={[errors.interviewerEmails]} />
              </Field>
              <Field data-invalid={Boolean(errors.instructions)}>
                <FieldLabel htmlFor={`${id}-instructions`}>Indicaciones</FieldLabel>
                <Textarea id={`${id}-instructions`} rows={2} placeholder="Opcional" {...form.register("instructions")} />
                <FieldError errors={[errors.instructions]} />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field data-invalid={Boolean(errors.deadlineDate)}>
                  <FieldLabel htmlFor={`${id}-deadline-date`}>Puede elegir hasta (fecha)</FieldLabel>
                  <Input id={`${id}-deadline-date`} type="date" {...form.register("deadlineDate")} />
                  <FieldError errors={[errors.deadlineDate]} />
                </Field>
                <Field>
                  <FieldLabel htmlFor={`${id}-deadline-time`}>Hora</FieldLabel>
                  <Input id={`${id}-deadline-time`} type="time" {...form.register("deadlineTime")} />
                </Field>
              </div>
              <FieldDescription>Si lo deja vacío, puede elegir hasta 2 horas antes del primer horario.</FieldDescription>
              <DialogFooter className="gap-2">
                <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={pending}>
                  {pending ? "Enviando…" : "Enviar invitación"}
                </Button>
              </DialogFooter>
            </FieldGroup>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

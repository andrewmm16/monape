"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { bookInterviewSlot } from "@/modules/interviews/booking-actions";
import { cn } from "@/lib/utils";

/**
 * La persona candidata elige uno de los horarios ofrecidos y lo confirma. Si
 * otro lo tomó antes, la página se recarga con los que quedan.
 */
export function BookingPicker({ token, slots }: { token: string; slots: { id: string; label: string }[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (done) {
    return (
      <div role="status" className="flex items-start gap-3 rounded-md border border-brand/30 bg-brand/5 p-4 text-sm" data-testid="booking-confirmed">
        <CheckCircle2Icon className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden />
        <p>
          ¡Listo! Tu entrevista quedó agendada para el <span className="font-medium">{done}</span> (hora de Lima). Te llegará la
          confirmación por correo.
        </p>
      </div>
    );
  }

  function confirm() {
    if (!selected) return;
    setError(null);
    startTransition(async () => {
      const result = await bookInterviewSlot(token, selected);
      if (result.ok) {
        setDone(slots.find((slot) => slot.id === selected)?.label ?? "");
        router.refresh();
      } else {
        setError(result.message);
        setSelected(null);
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-4">
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium">Elige un horario (hora de Lima)</legend>
        {slots.map((slot) => (
          <label
            key={slot.id}
            className={cn(
              "flex min-h-11 cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm transition-colors hover:bg-accent/40",
              selected === slot.id && "border-brand bg-brand/5 ring-2 ring-brand/40",
            )}
          >
            <input
              type="radio"
              name="horario"
              value={slot.id}
              checked={selected === slot.id}
              onChange={() => setSelected(slot.id)}
              className="size-4 accent-[var(--brand)]"
            />
            {slot.label}
          </label>
        ))}
      </fieldset>
      {error ? (
        <p role="alert" className="rounded-md border border-warning-foreground/40 bg-warning px-3 py-2 text-sm text-warning-foreground">
          {error}
        </p>
      ) : null}
      <Button type="button" className="w-full sm:w-auto" disabled={!selected || pending} onClick={confirm}>
        {pending ? "Agendando…" : "Confirmar horario"}
      </Button>
    </div>
  );
}

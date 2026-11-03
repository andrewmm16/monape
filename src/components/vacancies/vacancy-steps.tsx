import { CheckIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Step = { label: string; done: boolean };

/** Pasos para dejar lista una vacante; el primero pendiente se marca como el siguiente. */
export function VacancySteps({ steps }: { steps: Step[] }) {
  const current = steps.findIndex((step) => !step.done);
  return (
    <ol className="flex flex-wrap gap-x-6 gap-y-2" aria-label="Pasos para publicar la vacante">
      {steps.map((step, index) => (
        <li
          key={step.label}
          aria-current={index === current ? "step" : undefined}
          className={cn(
            "flex items-center gap-2 text-sm",
            step.done ? "text-foreground" : index === current ? "font-medium text-brand" : "text-muted-foreground",
          )}
        >
          <span
            className={cn(
              "flex size-5 items-center justify-center rounded-full border text-xs",
              step.done ? "border-brand bg-brand text-white" : index === current ? "border-brand" : "",
            )}
          >
            {step.done ? <CheckIcon className="size-3" /> : index + 1}
          </span>
          {step.label}
        </li>
      ))}
    </ol>
  );
}

"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import type { FieldValues, Path, UseFormReturn } from "react-hook-form";
import { toast } from "sonner";
import type { ActionResult } from "@/lib/action-result";

/**
 * Envía un formulario de React Hook Form a una Server Action: muestra el
 * mensaje real devuelto por el servidor y asigna los errores por campo.
 */
export function useFormAction<TValues extends FieldValues, TData>(
  form: UseFormReturn<TValues>,
  action: (values: TValues) => Promise<ActionResult<TData>>,
  options: { onSuccess?: (data: TData) => void; refresh?: boolean } = {},
) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const submit = form.handleSubmit((values) =>
    new Promise<void>((resolve) => {
      startTransition(async () => {
        const result = await action(values);
        if (result.ok) {
          if (result.message) toast.success(result.message);
          options.onSuccess?.(result.data);
          if (options.refresh !== false) router.refresh();
        } else {
          for (const [field, messages] of Object.entries(result.fieldErrors ?? {})) {
            form.setError(field as Path<TValues>, { message: messages[0] });
          }
          toast.error(result.error);
        }
        resolve();
      });
    }),
  );

  return { submit, pending };
}

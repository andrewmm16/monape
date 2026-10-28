"use client";

import { useState, useTransition, type ComponentProps, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action-result";

type Props = {
  action: () => Promise<ActionResult<unknown>>;
  children: ReactNode;
  confirm?: { title: string; description: string; confirmLabel?: string };
  variant?: ComponentProps<typeof Button>["variant"];
  size?: ComponentProps<typeof Button>["size"];
  disabled?: boolean;
  pendingLabel?: string;
};

/** Botón que ejecuta una Server Action y muestra el resultado real. */
export function ActionButton({ action, children, confirm, variant, size, disabled, pendingLabel }: Props) {
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const router = useRouter();

  const run = () =>
    startTransition(async () => {
      const result = await action();
      setOpen(false);
      if (result.ok) {
        if (result.message) toast.success(result.message);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });

  const button = (
    <Button
      type="button"
      variant={variant}
      size={size}
      disabled={disabled || pending}
      onClick={confirm ? () => setOpen(true) : run}
    >
      {pending ? (pendingLabel ?? "Procesando…") : children}
    </Button>
  );

  if (!confirm) return button;
  return (
    <>
      {button}
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirm.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(event) => {
                event.preventDefault();
                run();
              }}
            >
              {pending ? "Procesando…" : (confirm.confirmLabel ?? "Confirmar")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

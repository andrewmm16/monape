"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { publishVacancy } from "@/modules/vacancies/actions";

/** Iniciales del portal cuando no hay archivo de logo. */
function initials(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words.slice(0, 2).map((word) => word[0]) : [name.slice(0, 2)]).join("").toUpperCase();
}

/**
 * Sección visible (no modal) para publicar la vacante. RRHH marca aquí los
 * portales donde el robot debe publicarla y, al pulsar Publicar, la vacante se
 * publica y se envía a los portales marcados en el mismo paso.
 */
export function PublishPortalsSection({
  vacancyId,
  portals,
  blockers,
  reopen,
  confidential,
}: {
  vacancyId: string;
  portals: { id: string; name: string; logo: string | null }[];
  blockers: string[];
  reopen: boolean;
  confidential: boolean;
}) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const blocked = blockers.length > 0;
  const label = reopen ? "Reabrir y publicar" : "Publicar";

  const toggle = (id: string, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const run = () =>
    startTransition(async () => {
      const result = await publishVacancy(vacancyId, [...selected]);
      if (result.ok) {
        toast.success(result.message ?? "Vacante publicada.");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });

  return (
    <Card className="overflow-visible">
      <CardHeader>
        <CardTitle>{reopen ? "Reabrir y publicar la vacante" : "Publicar la vacante"}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {confidential
            ? "La vacante es confidencial: se gestiona de forma interna y no aparece en la página pública ni en los buscadores de empleo."
            : "Al publicar, la vacante aparecerá en la página pública, en Google y en los buscadores de empleo."}{" "}
          Marque abajo los portales de empleo donde el robot debe publicarla; se enviarán al publicar (puede cambiarlos luego).
        </p>

        {blocked ? (
          <Alert variant="destructive">
            <AlertTitle>Faltan datos para publicar</AlertTitle>
            <AlertDescription>{blockers.join(" ")}</AlertDescription>
          </Alert>
        ) : null}

        {portals.length > 0 ? (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {portals.map((portal) => {
              const id = `publicar-${portal.id}`;
              const checked = selected.has(portal.id);
              return (
                <li key={portal.id}>
                  <label
                    htmlFor={id}
                    className={cn(
                      "relative flex aspect-square w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border bg-card p-3 text-center transition-colors hover:bg-accent/40",
                      checked && "border-brand bg-brand/5 ring-2 ring-brand/40",
                    )}
                  >
                    <Checkbox
                      id={id}
                      className="absolute left-2 top-2"
                      checked={checked}
                      onCheckedChange={(value) => toggle(portal.id, value === true)}
                    />
                    <span className="flex h-14 w-full items-center justify-center">
                      {portal.logo ? (
                        <Image src={portal.logo} alt="" width={56} height={56} unoptimized className="size-14 rounded-md object-contain" />
                      ) : (
                        <span
                          aria-hidden
                          className="flex size-14 items-center justify-center rounded-lg bg-muted text-lg font-semibold text-muted-foreground"
                        >
                          {initials(portal.name)}
                        </span>
                      )}
                    </span>
                    <span className="text-sm font-medium leading-tight">{portal.name}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            No hay portales con robot disponibles en este servidor. La vacante se publicará solo en la página pública.
          </p>
        )}

        {selected.size > 0 ? (
          <p className="text-xs text-muted-foreground">
            El robot trabaja desde la cuenta de la empresa en cada portal: confirme que la empresa autorizó la automatización.
          </p>
        ) : null}

      </CardContent>
      <div className="sticky bottom-0 z-10 -mb-(--card-spacing) flex justify-end rounded-b-xl border-t bg-card px-4 py-3">
        <Button type="button" onClick={run} disabled={pending || blocked}>
          {pending ? "Publicando…" : label}
        </Button>
      </div>
    </Card>
  );
}

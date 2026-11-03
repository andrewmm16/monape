"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLinkIcon } from "lucide-react";
import { toast } from "sonner";
import { ActionButton } from "@/components/common/action-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { formatDateTime } from "@/lib/format";
import { markPortalPublishedManually, markPortalWithdrawnManually } from "@/modules/portals/actions";
import type { PortalPublicationRow } from "@/modules/portals/queries";

/** Publicada a mano y vigente: RRHH la retira también a mano. */
const isManualLive = ({ publication }: PortalPublicationRow) => publication?.manual === true && publication.status === "publicada";
/** El robot la gestiona (en cola, en curso o publicada por él): no se registra a mano encima. */
const isRobotManaged = ({ publication }: PortalPublicationRow) =>
  publication !== null && !publication.manual && ["pendiente", "publicando", "retirar", "publicada"].includes(publication.status);

/**
 * Registro de una oferta publicada a mano en un portal: el código que muestra el
 * portal permite al lector de correo ligar las postulaciones con la vacante.
 */
export function ManualPublication({
  vacancyId,
  canPublish,
  rows,
}: {
  vacancyId: string;
  canPublish: boolean;
  rows: PortalPublicationRow[];
}) {
  const options = rows.filter((row) => !isRobotManaged(row));
  const [portalId, setPortalId] = useState("");
  const [code, setCode] = useState("");
  const [url, setUrl] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const live = rows.filter(isManualLive);
  const ready = canPublish && portalId !== "" && code.trim() !== "";

  const submit = () =>
    startTransition(async () => {
      const result = await markPortalPublishedManually(vacancyId, portalId, code, url);
      if (result.ok) {
        if (result.message) toast.success(result.message);
        setCode("");
        setUrl("");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Marcar publicada a mano</CardTitle>
        <p className="text-sm text-muted-foreground">
          El código lo muestra el portal al publicar; el lector de correo lo usa para ligar las postulaciones con esta
          vacante. Si el código estaba mal escrito, regístrelo de nuevo en el mismo portal para corregirlo.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="manual-portal">Portal</Label>
            <NativeSelect
              id="manual-portal"
              className="w-full"
              value={portalId}
              onChange={(event) => setPortalId(event.target.value)}
              disabled={!canPublish || pending}
            >
              <NativeSelectOption value="">Elija un portal</NativeSelectOption>
              {options.map(({ portal }) => (
                <NativeSelectOption key={portal.id} value={portal.id}>
                  {portal.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="manual-code">Código de la oferta</Label>
            <Input
              id="manual-code"
              value={code}
              maxLength={200}
              onChange={(event) => setCode(event.target.value)}
              disabled={!canPublish || pending}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="manual-url">Enlace (opcional)</Label>
            <Input
              id="manual-url"
              type="url"
              inputMode="url"
              placeholder="https://"
              value={url}
              maxLength={500}
              onChange={(event) => setUrl(event.target.value)}
              disabled={!canPublish || pending}
            />
          </div>
        </div>
        <Button type="button" disabled={!ready || pending} onClick={submit}>
          {pending ? "Guardando…" : "Marcar publicada a mano"}
        </Button>

        {live.length > 0 ? (
          <div className="divide-y rounded-lg border">
            {live.map(({ portal, publication }) =>
              publication ? (
                <div key={portal.id} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
                  <div className="space-y-0.5 text-muted-foreground">
                    <p className="font-medium text-foreground">
                      {portal.name} · Publicada a mano
                    </p>
                    <p>Código: {publication.external_id}</p>
                    {publication.published_at ? <p>Registrada: {formatDateTime(publication.published_at)}</p> : null}
                    {publication.external_url ? (
                      <a
                        href={publication.external_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-brand hover:underline"
                      >
                        Ver oferta en el portal <ExternalLinkIcon className="size-3.5" />
                      </a>
                    ) : null}
                  </div>
                  <ActionButton
                    variant="outline"
                    action={() => markPortalWithdrawnManually(publication.id, vacancyId)}
                    confirm={{
                      title: "¿Marcar la oferta como retirada?",
                      description: `Solo cambia el registro en la aplicación: retire la oferta de ${portal.name} desde el portal. Las postulaciones ya recibidas se conservan.`,
                      confirmLabel: "Marcar retirada",
                    }}
                  >
                    Marcar retirada
                  </ActionButton>
                </div>
              ) : null,
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

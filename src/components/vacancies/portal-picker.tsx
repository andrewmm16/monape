"use client";

import { useState } from "react";
import Image from "next/image";
import { ExternalLinkIcon } from "lucide-react";
import { ActionButton } from "@/components/common/action-button";
import { PortalPublicationBadge } from "@/components/common/badges";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { formatDateTime } from "@/lib/format";
import { PORTAL_ERROR_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { applyPortalSelection } from "@/modules/portals/actions";
import type { PortalPublicationRow } from "@/modules/portals/queries";

/** Portal con la ruta de su logo (`null` si no hay archivo: se muestran sus iniciales). */
export type PortalTileRow = PortalPublicationRow & { logo: string | null };

/**
 * La vacante está (o va a estar) en el portal: en cola, publicada, o con un retiro fallido
 * (estado error con id de oferta: la oferta sigue viva y desmarcar vuelve a pedir el retiro).
 */
const isActive = ({ publication }: PortalPublicationRow) =>
  publication?.status === "pendiente" ||
  publication?.status === "publicada" ||
  (publication?.status === "error" && publication.external_id !== null);
/** El robot está trabajando en ella: no se puede cambiar hasta que termine. */
const isBusy = ({ publication }: PortalPublicationRow) => publication?.status === "publicando" || publication?.status === "retirar";

function initials(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words.slice(0, 2).map((word) => word[0]) : [name.slice(0, 2)]).join("").toUpperCase();
}

/**
 * Edición de los portales de una vacante, como mosaicos cuadrados con el logo
 * de cada portal. El mosaico marcado significa «la vacante estará en este
 * portal»: marcar uno nuevo lo publica y desmarcar uno publicado lo retira. Los
 * cambios se aplican juntos con «Guardar cambios».
 */
export function PortalPicker({
  vacancyId,
  canPublish,
  rows,
}: {
  vacancyId: string;
  canPublish: boolean;
  rows: PortalTileRow[];
}) {
  // Solo guarda lo que la persona tocó; el resto se deduce del estado actual.
  const [touched, setTouched] = useState<ReadonlyMap<string, boolean>>(new Map());

  const editable = (row: PortalTileRow) => canPublish && row.portal.bot_enabled && !isBusy(row);
  const checkedOf = (row: PortalTileRow) =>
    editable(row) ? (touched.get(row.portal.id) ?? isActive(row)) : isActive(row) || row.publication?.status === "publicando";

  const editableRows = rows.filter(editable);
  const add = editableRows.filter((row) => !isActive(row) && checkedOf(row)).map((row) => row.portal.id);
  const remove = editableRows.filter((row) => isActive(row) && !checkedOf(row)).map((row) => row.portal.id);
  const changes = add.length + remove.length;
  const allChecked = editableRows.length > 0 && editableRows.every(checkedOf);

  const setOne = (id: string, on: boolean) => setTouched((current) => new Map(current).set(id, on));
  const setAll = (on: boolean) => setTouched(new Map(editableRows.map((row) => [row.portal.id, on])));

  const changeSummary = [
    add.length > 0 ? `publicar en ${add.length} portal(es)` : null,
    remove.length > 0 ? `retirar de ${remove.length} portal(es)` : null,
  ]
    .filter(Boolean)
    .join(" y ");

  const withDetails = rows.filter((row) => row.publication);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Checkbox
            id="portales-todos"
            checked={allChecked}
            disabled={editableRows.length === 0}
            onCheckedChange={(value) => setAll(value === true)}
          />
          <Label htmlFor="portales-todos" className="font-medium">
            Seleccionar todos los disponibles
          </Label>
        </div>
        <div className="flex items-center gap-2">
          {changes > 0 ? (
            <Button type="button" variant="ghost" onClick={() => setTouched(new Map())}>
              Descartar
            </Button>
          ) : null}
          <ActionButton
            disabled={changes === 0}
            action={() => applyPortalSelection(vacancyId, add, remove)}
            confirm={{
              title: "¿Guardar los cambios de portales?",
              description: `Se va a ${changeSummary}. El robot trabaja desde la cuenta de la empresa en cada portal: confirme que la empresa autorizó la automatización. Retirar una oferta no borra las postulaciones ya recibidas.`,
              confirmLabel: "Guardar cambios",
            }}
          >
            {changes === 0 ? "Sin cambios" : `Guardar cambios (${changes})`}
          </ActionButton>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {rows.map((row) => {
            const { portal, publication, logo } = row;
            const id = `portal-${portal.id}`;
            const checked = checkedOf(row);
            const enabled = editable(row);
            const note = !portal.bot_enabled
              ? "Robot aún no disponible"
              : willChange(add, remove, portal.id)
                ? remove.includes(portal.id)
                  ? "Se retirará al guardar"
                  : "Se publicará al guardar"
                : null;
            return (
              <li key={portal.id}>
                <label
                  htmlFor={id}
                  className={cn(
                    "relative flex aspect-square w-full flex-col items-center justify-center gap-2 rounded-xl border bg-card p-3 text-center transition-colors",
                    enabled ? "cursor-pointer hover:bg-accent/40" : "cursor-not-allowed opacity-60",
                    checked && "border-primary bg-primary/5 ring-2 ring-primary/40",
                  )}
                >
                  <Checkbox
                    id={id}
                    className="absolute left-2 top-2"
                    checked={checked}
                    disabled={!enabled}
                    onCheckedChange={(value) => setOne(portal.id, value === true)}
                  />
                  <span className="flex h-14 w-full items-center justify-center">
                    {logo ? (
                      <Image src={logo} alt="" width={56} height={56} unoptimized className="size-14 rounded-md object-contain" />
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
                  <span className="flex min-h-5 flex-wrap items-center justify-center gap-1">
                    {publication ? <PortalPublicationBadge status={publication.status} /> : null}
                    {note ? <span className="text-xs text-muted-foreground">{note}</span> : null}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>

        {withDetails.length > 0 ? (
          <div className="divide-y rounded-lg border">
            {withDetails.map(({ portal, publication }) =>
              publication ? (
                <div key={portal.id} className="space-y-0.5 p-3 text-sm text-muted-foreground">
                  <p className="font-medium text-foreground">{portal.name}</p>
                  <p>Solicitada: {formatDateTime(publication.requested_at)}</p>
                  {publication.published_at ? <p>Publicada: {formatDateTime(publication.published_at)}</p> : null}
                  {publication.last_synced_at ? (
                    <p>Última revisión de postulantes: {formatDateTime(publication.last_synced_at)}</p>
                  ) : publication.status === "publicada" ? (
                    <p>Aún no se han revisado los postulantes.</p>
                  ) : null}
                  {publication.status === "publicando" || publication.status === "retirar" ? (
                    <p>El robot está trabajando en este portal; podrá cambiarlo cuando termine.</p>
                  ) : null}
                  {publication.error_code ? (
                    <p className="text-foreground">
                      {PORTAL_ERROR_LABELS[publication.error_code] ?? "El robot no pudo completar la tarea."}
                    </p>
                  ) : null}
                  {publication.external_url ? (
                    <a
                      href={publication.external_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      Ver oferta en el portal <ExternalLinkIcon className="size-3.5" />
                    </a>
                  ) : null}
                </div>
              ) : null,
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function willChange(add: string[], remove: string[], id: string): boolean {
  return add.includes(id) || remove.includes(id);
}

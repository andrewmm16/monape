"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangleIcon, CheckCircle2Icon, UploadIcon } from "lucide-react";
import { toast } from "sonner";
import { ActionButton } from "@/components/common/action-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DUPLICATE_REASON_LABELS } from "@/lib/labels";
import {
  closeBatch,
  discardBatchItem,
  registerBatchItems,
  updateBatchItem,
  uploadBatchItem,
  type RegisterBatchSummary,
} from "@/modules/intake/actions";
import { MAX_BATCH_ITEMS } from "@/modules/intake/schemas";

const MAX_BYTES = 4 * 1024 * 1024;
const ACCEPT = ".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export type BatchItemView = {
  id: string;
  status: "listo" | "requiere_datos" | "error" | "registrado";
  filename: string;
  fullName: string;
  email: string;
  phone: string;
  /** Fragmento del CV que respalda el nombre propuesto. */
  nameEvidence: string | null;
  warnings: string[];
  /** El texto salió de un escaneo (OCR): nombre, correo y teléfono pueden tener errores. */
  fromOcr: boolean;
  applicationId: string | null;
  duplicates: { fullName: string; reasons: string[] }[];
};

type UploadEntry = { key: string; name: string; state: "subiendo" | "listo" | "error"; message?: string };

function ItemRow({
  item,
  checked,
  onCheckedChange,
  onSave,
}: {
  item: BatchItemView;
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  onSave: (values: { itemId: string; fullName: string; email: string; phone: string }) => void;
}) {
  const fromProps = { fullName: item.fullName, email: item.email, phone: item.phone };
  const [values, setValues] = useState(fromProps);
  // Último valor recibido del servidor, para saber si hay cambios sin guardar.
  const [synced, setSynced] = useState(fromProps);
  const [focused, setFocused] = useState(false);
  const dirty = values.fullName !== synced.fullName || values.email !== synced.email || values.phone !== synced.phone;
  if (fromProps.fullName !== synced.fullName || fromProps.email !== synced.email || fromProps.phone !== synced.phone) {
    // Los datos del servidor solo reemplazan lo escrito si la fila no tiene foco ni cambios sin guardar.
    setSynced(fromProps);
    if (!focused && !dirty) setValues(fromProps);
  }
  const editable = item.status === "listo" || item.status === "requiere_datos";

  const save = () => {
    if (!dirty) return;
    onSave({ itemId: item.id, ...values });
  };
  const field = (name: keyof typeof values, label: string, type = "text") => (
    <Input
      type={type}
      value={values[name]}
      onChange={(event) => setValues((current) => ({ ...current, [name]: event.target.value }))}
      onBlur={save}
      aria-label={`${label} de ${item.filename}`}
      className="min-w-40"
    />
  );

  return (
    <TableRow
      className="align-top"
      data-testid="batch-item"
      data-status={item.status}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        // Tab entre los campos de la misma fila no cuenta como salir de ella.
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      <TableCell>
        <Checkbox
          checked={checked}
          disabled={item.status !== "listo"}
          onCheckedChange={(value) => onCheckedChange(value === true)}
          aria-label={`Registrar ${item.filename}`}
        />
      </TableCell>
      <TableCell className="max-w-48 whitespace-normal">
        <span className="font-medium break-words">{item.filename}</span>
        {item.status === "error" ? (
          <div className="mt-1 text-xs text-destructive">{item.warnings[0] ?? "El archivo no es válido."}</div>
        ) : null}
      </TableCell>
      {editable ? (
        <>
          <TableCell className="whitespace-normal">
            {field("fullName", "Nombre")}
            {item.nameEvidence ? (
              <div className="mt-1 max-w-56 text-xs text-muted-foreground">Del CV: «{item.nameEvidence}»</div>
            ) : values.fullName.trim() === "" ? (
              <div className="mt-1 text-xs text-amber-700 dark:text-amber-300">Escriba el nombre.</div>
            ) : null}
          </TableCell>
          <TableCell>{field("email", "Correo", "email")}</TableCell>
          <TableCell>{field("phone", "Teléfono", "tel")}</TableCell>
        </>
      ) : (
        <TableCell colSpan={3} className="text-muted-foreground">
          —
        </TableCell>
      )}
      <TableCell className="max-w-64 text-xs whitespace-normal">
        {item.duplicates.length > 0 ? (
          <div className="mb-1 flex gap-1 text-amber-700 dark:text-amber-300">
            <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <div>
              <div className="font-medium">Posible duplicado</div>
              <ul>
                {item.duplicates.map((duplicate, index) => (
                  <li key={index}>
                    {duplicate.fullName} ({duplicate.reasons.map((r) => DUPLICATE_REASON_LABELS[r] ?? r).join(", ")})
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}
        {item.status !== "error" && item.fromOcr ? (
          <p className="mb-1 font-medium text-amber-700 dark:text-amber-300">
            Datos leídos de un escaneo: revise con cuidado el nombre, el correo y el teléfono.
          </p>
        ) : null}
        {item.status !== "error" && item.warnings.length > 0 ? (
          <ul className="list-disc pl-4 text-muted-foreground">
            {item.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        ) : null}
      </TableCell>
      <TableCell>
        <ActionButton variant="ghost" size="sm" action={() => discardBatchItem(item.id)}>
          Descartar
        </ActionButton>
      </TableCell>
    </TableRow>
  );
}

/** Pasos 2 a 5: subir los archivos, revisar, registrar y cerrar el lote. */
export function BatchWorkspace({
  vacancyId,
  batchId,
  portalName,
  items,
}: {
  vacancyId: string;
  batchId: string;
  portalName: string;
  items: BatchItemView[];
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const saves = useRef(new Set<Promise<unknown>>());
  const [uploads, setUploads] = useState<UploadEntry[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [choices, setChoices] = useState<Record<string, boolean>>({});
  const [summary, setSummary] = useState<RegisterBatchSummary | null>(null);
  const [registering, startRegistering] = useTransition();

  const pending = items.filter((item) => item.status !== "registrado");
  const registered = items.filter((item) => item.status === "registrado");
  // Los posibles duplicados quedan sin marcar: RRHH decide.
  const isChecked = (item: BatchItemView) =>
    item.status === "listo" && (choices[item.id] ?? item.duplicates.length === 0);
  const selected = pending.filter(isChecked);

  const uploadFiles = async (files: File[]) => {
    if (files.length === 0 || uploading) return;
    const room = MAX_BATCH_ITEMS - items.length;
    if (files.length > room) {
      toast.error(`Un lote admite como máximo ${MAX_BATCH_ITEMS} archivos. Quedan ${Math.max(0, room)} lugares.`);
      files = files.slice(0, Math.max(0, room));
      if (files.length === 0) return;
    }
    setUploading(true);
    setSummary(null);
    const entries: UploadEntry[] = files.map((file, index) => ({ key: `${Date.now()}-${index}`, name: file.name, state: "subiendo" }));
    setUploads(entries);
    const update = (index: number, patch: Partial<UploadEntry>) =>
      setUploads((current) => current.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)));

    // Uno por uno: el límite es de 4 MB por solicitud.
    for (const [index, file] of files.entries()) {
      if (file.size > MAX_BYTES) {
        update(index, { state: "error", message: "El archivo supera el tamaño máximo de 4 MB." });
        continue;
      }
      const formData = new FormData();
      formData.set("batchId", batchId);
      formData.set("file", file);
      try {
        const result = await uploadBatchItem(formData);
        if (!result.ok) {
          update(index, { state: "error", message: result.error });
          if (result.error.startsWith("Demasiadas solicitudes")) {
            for (let rest = index + 1; rest < files.length; rest += 1) {
              update(rest, { state: "error", message: "No se envió: límite de solicitudes alcanzado." });
            }
            break;
          }
        } else if (result.data.status === "error") {
          update(index, { state: "error", message: result.data.message });
        } else {
          update(index, { state: "listo" });
        }
      } catch {
        update(index, { state: "error", message: "No se pudo enviar el archivo." });
      }
    }
    setUploading(false);
    if (inputRef.current) inputRef.current.value = "";
    router.refresh();
  };

  const saveItem = (values: { itemId: string; fullName: string; email: string; phone: string }) => {
    const promise = updateBatchItem(values).then((result) => {
      if (!result.ok) toast.error(result.error);
      else router.refresh();
    });
    saves.current.add(promise);
    void promise.finally(() => saves.current.delete(promise));
  };

  const register = () =>
    startRegistering(async () => {
      // Espera las correcciones en curso para registrar lo que RRHH ve.
      await Promise.allSettled([...saves.current]);
      const result = await registerBatchItems(
        batchId,
        selected.map((item) => item.id),
      );
      if (result.ok) {
        setSummary(result.data);
        setChoices({});
      } else {
        toast.error(result.error);
      }
      router.refresh();
    });

  const done = uploads.filter((entry) => entry.state !== "subiendo").length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-card px-4 py-3 text-sm">
        <span>
          Portal de origen: <strong>{portalName}</strong> · {items.length} de {MAX_BATCH_ITEMS} archivos en el lote
        </span>
        <ActionButton
          variant="outline"
          size="sm"
          action={() => closeBatch(batchId)}
          confirm={{
            title: "¿Cerrar el lote?",
            description:
              "Los archivos que no se hayan registrado se borrarán junto con sus datos. Los ya registrados se conservan.",
            confirmLabel: "Cerrar lote",
          }}
        >
          Cerrar lote
        </ActionButton>
      </div>

      <section className="space-y-3" aria-label="Subir archivos">
        <label
          htmlFor={`batch-files-${vacancyId}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            void uploadFiles([...event.dataTransfer.files]);
          }}
          className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-8 text-center text-sm transition-colors ${
            dragging ? "border-primary bg-primary/5" : "hover:border-primary/60"
          }`}
        >
          <UploadIcon className="size-6 text-muted-foreground" aria-hidden />
          <span className="font-medium">Arrastre los CV aquí o haga clic para seleccionarlos</span>
          <span className="text-xs text-muted-foreground">PDF o DOCX, máximo 4 MB cada uno</span>
          <input
            ref={inputRef}
            id={`batch-files-${vacancyId}`}
            type="file"
            multiple
            accept={ACCEPT}
            className="sr-only"
            disabled={uploading}
            onChange={(event) => void uploadFiles([...(event.target.files ?? [])])}
          />
        </label>
        {uploads.length > 0 ? (
          <div className="space-y-2" aria-live="polite">
            <Progress value={(done / uploads.length) * 100} aria-label="Progreso de la carga" />
            <ul className="space-y-1 text-sm">
              {uploads.map((entry) => (
                <li key={entry.key} className="flex items-start gap-2">
                  {entry.state === "listo" ? (
                    <CheckCircle2Icon className="mt-0.5 size-4 text-emerald-600" aria-hidden />
                  ) : entry.state === "error" ? (
                    <AlertTriangleIcon className="mt-0.5 size-4 text-destructive" aria-hidden />
                  ) : (
                    <span className="mt-0.5 size-4 animate-pulse rounded-full bg-muted" aria-hidden />
                  )}
                  <span className="break-words">
                    {entry.name}
                    {entry.state === "subiendo" ? " · procesando…" : null}
                    {entry.state === "error" ? <span className="text-destructive"> · {entry.message}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      {summary ? (
        <Alert variant={summary.errors.length > 0 ? "destructive" : "default"}>
          <AlertTitle>Resumen del registro</AlertTitle>
          <AlertDescription>
            <p>
              Registrados: {summary.registered} · Evaluados por reglas: {summary.evaluated}
              {summary.notEvaluated > 0 ? ` · Sin evaluar por un error: ${summary.notEvaluated}` : ""} · Con error: {summary.errors.length}
            </p>
            {summary.registered > 0 && summary.evaluated === 0 && summary.notEvaluated === 0 ? (
              <p>No se evaluaron porque los criterios de la vacante aún no están aprobados.</p>
            ) : null}
            {summary.errors.length > 0 ? (
              <ul className="list-disc pl-4">
                {summary.errors.map((error) => (
                  <li key={error.itemId}>
                    {error.filename}: {error.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      <section className="space-y-3" aria-label="Revisión">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Revisión</h2>
          <Button type="button" onClick={register} disabled={selected.length === 0 || registering || uploading}>
            {registering ? "Registrando…" : `Registrar seleccionados (${selected.length})`}
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Revise el nombre, el correo y el teléfono de cada persona. El nombre propuesto sale del CV y puede ser incorrecto.
          Las filas con posible duplicado quedan sin marcar.
        </p>
        {pending.length === 0 ? (
          <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            No hay archivos pendientes de revisión.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border bg-card shadow-xs">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <span className="sr-only">Registrar</span>
                  </TableHead>
                  <TableHead>Archivo</TableHead>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Correo</TableHead>
                  <TableHead>Teléfono</TableHead>
                  <TableHead>Duplicados y advertencias</TableHead>
                  <TableHead>
                    <span className="sr-only">Acciones</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pending.map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    checked={isChecked(item)}
                    onCheckedChange={(value) => setChoices((current) => ({ ...current, [item.id]: value }))}
                    onSave={saveItem}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {registered.length > 0 ? (
        <section className="space-y-2" aria-label="Registrados">
          <h2 className="text-lg font-semibold">Registrados en este lote</h2>
          <ul className="space-y-1 text-sm">
            {registered.map((item) => (
              <li key={item.id}>
                {item.applicationId ? (
                  <Link href={`/postulaciones/${item.applicationId}`} className="font-medium hover:underline">
                    {item.fullName}
                  </Link>
                ) : (
                  item.fullName
                )}{" "}
                <span className="text-muted-foreground">({item.filename})</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

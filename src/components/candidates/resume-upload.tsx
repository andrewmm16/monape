"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UploadIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { EXTRACTION_STATUS_LABELS } from "@/lib/labels";
import { confirmResumeUpload, requestResumeUpload, uploadResume, type UploadResumeResult } from "@/modules/resumes/actions";
import { MAX_RESUME_UPLOAD_BYTES, maxResumeSizeMessage, needsDirectUpload, putToSignedUrl } from "@/modules/resumes/upload-limits";
import type { ActionResult } from "@/lib/action-result";

const UPLOAD_FAILED = "No se pudo subir el archivo. Revise su conexión e inténtelo nuevamente.";

/** Hasta 4 MB viaja en la Server Action; más grande, directo a Storage con URL firmada y confirmación. */
async function sendResume(candidateId: string, file: File): Promise<ActionResult<UploadResumeResult>> {
  if (!needsDirectUpload(file.size)) {
    const formData = new FormData();
    formData.set("candidateId", candidateId);
    formData.set("file", file);
    return uploadResume(formData);
  }
  const ticket = await requestResumeUpload({ candidateId, fileName: file.name, size: file.size });
  if (!ticket.ok) return ticket;
  if (!(await putToSignedUrl(ticket.data, file))) return { ok: false, error: UPLOAD_FAILED };
  return confirmResumeUpload({ candidateId, resumeId: ticket.data.resumeId, kind: ticket.data.kind, fileName: file.name });
}

export function ResumeUpload({ candidateId }: { candidateId: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!file) return;
    // Validación previa para dar respuesta inmediata; el servidor vuelve a validar todo.
    if (file.size > MAX_RESUME_UPLOAD_BYTES) {
      toast.error(maxResumeSizeMessage(MAX_RESUME_UPLOAD_BYTES));
      return;
    }
    startTransition(async () => {
      const result = await sendResume(candidateId, file).catch((): ActionResult<UploadResumeResult> => ({ ok: false, error: UPLOAD_FAILED }));
      if (result.ok) {
        const status = EXTRACTION_STATUS_LABELS[result.data.extractionStatus as keyof typeof EXTRACTION_STATUS_LABELS];
        toast.success(`CV cargado como versión ${result.data.version}. ${status ?? ""}.`);
        setFile(null);
        if (inputRef.current) inputRef.current.value = "";
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <Field className="sm:max-w-md">
        <FieldLabel htmlFor="resume-file">Cargar CV (PDF o DOCX, máx. 10 MB)</FieldLabel>
        <Input
          ref={inputRef}
          id="resume-file"
          type="file"
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          disabled={pending}
        />
        <FieldDescription>Se guarda en almacenamiento privado. Cada carga crea una nueva versión.</FieldDescription>
      </Field>
      <Button type="submit" disabled={!file || pending}>
        <UploadIcon /> {pending ? "Procesando…" : "Cargar"}
      </Button>
    </form>
  );
}

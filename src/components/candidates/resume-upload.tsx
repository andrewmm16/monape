"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UploadIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { EXTRACTION_STATUS_LABELS } from "@/lib/labels";
import { uploadResume } from "@/modules/resumes/actions";

const MAX_BYTES = 4 * 1024 * 1024;

export function ResumeUpload({ candidateId }: { candidateId: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!file) return;
    // Validación previa para dar respuesta inmediata; el servidor vuelve a validar todo.
    if (file.size > MAX_BYTES) {
      toast.error("El archivo supera el tamaño máximo de 4 MB.");
      return;
    }
    const formData = new FormData();
    formData.set("candidateId", candidateId);
    formData.set("file", file);
    startTransition(async () => {
      const result = await uploadResume(formData);
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
        <FieldLabel htmlFor="resume-file">Cargar CV (PDF o DOCX, máx. 4 MB)</FieldLabel>
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

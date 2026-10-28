"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ActionButton } from "@/components/common/action-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime } from "@/lib/format";
import { addProfileItem, applySuggestedField } from "@/modules/candidates/actions";
import { readScannedResume, saveCorrectedText } from "@/modules/resumes/actions";
import type { SuggestedFields } from "@/modules/resumes/suggestions";

type Extraction = {
  id: string;
  status: "completada" | "sin_texto" | "fallida";
  method: string;
  warnings: string[];
  raw_text: string | null;
  corrected_text: string | null;
  corrected_at: string | null;
  suggested_fields: unknown;
};

const FIELD_LABELS = { email: "Correo", phone: "Teléfono", linkedin_url: "LinkedIn" } as const;

export function ExtractionReview({
  candidateId,
  resumeId,
  extraction,
  canManage,
  isPdf,
  existingSkills,
}: {
  candidateId: string;
  resumeId: string;
  extraction: Extraction;
  canManage: boolean;
  isPdf: boolean;
  existingSkills: string[];
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(extraction.corrected_text ?? extraction.raw_text ?? "");
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const suggestions = (extraction.suggested_fields ?? { skills: [] }) as SuggestedFields;
  const currentText = extraction.corrected_text ?? extraction.raw_text;
  // Un PDF sin texto (no corregido a mano) puede leerse como escaneado; también se reintenta tras un OCR sin resultado.
  const canReadScan = canManage && isPdf && extraction.status === "sin_texto" && !extraction.corrected_text;
  const knownSkills = new Set(existingSkills.map((s) => s.toLowerCase()));

  const save = () =>
    startTransition(async () => {
      const result = await saveCorrectedText({ candidateId, extractionId: extraction.id, text });
      if (result.ok) {
        toast.success(result.message);
        setEditing(false);
        router.refresh();
      } else toast.error(result.error);
    });

  return (
    <div className="space-y-4">
      {extraction.warnings.length > 0 ? (
        <Alert>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {extraction.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-sm font-medium">
            Texto{" "}
            {extraction.corrected_text
              ? "corregido por RRHH"
              : extraction.method === "pdf_ocr" && extraction.status === "completada"
                ? "leído del escaneo (OCR local)"
                : "extraído automáticamente"}
            {extraction.corrected_at ? (
              <span className="font-normal text-muted-foreground"> · {formatDateTime(extraction.corrected_at)}</span>
            ) : null}
          </h4>
          <div className="flex flex-wrap gap-2">
            {canReadScan && !editing ? (
              <ActionButton action={readScannedResume.bind(null, resumeId)} size="sm" variant="outline" pendingLabel="Leyendo escaneo…">
                Leer escaneo automáticamente
              </ActionButton>
            ) : null}
            {canManage && !editing ? (
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                {currentText ? "Corregir texto" : "Transcribir texto"}
              </Button>
            ) : null}
          </div>
        </div>
        {editing ? (
          <div className="space-y-2">
            <Textarea rows={14} value={text} onChange={(event) => setText(event.target.value)} className="font-mono text-xs" />
            <p className="text-xs text-muted-foreground">
              Corrija solo errores de lectura. No agregue información que no figure en el documento.
            </p>
            <div className="flex gap-2">
              <Button size="sm" onClick={save} disabled={pending}>
                {pending ? "Guardando…" : "Guardar texto"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setEditing(false)} disabled={pending}>
                Cancelar
              </Button>
            </div>
          </div>
        ) : currentText ? (
          <pre className="max-h-72 overflow-auto rounded-md border bg-muted/40 p-3 text-xs whitespace-pre-wrap">{currentText}</pre>
        ) : (
          <p className="text-sm text-muted-foreground">No hay texto disponible para este documento.</p>
        )}
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-medium">Datos detectados en el CV</h4>
        <p className="text-xs text-muted-foreground">
          Sugerencias automáticas basadas en el texto literal. No se aplican a la ficha sin su confirmación.
        </p>
        <ul className="divide-y rounded-md border text-sm">
          {(Object.keys(FIELD_LABELS) as (keyof typeof FIELD_LABELS)[]).map((field) => {
            const suggestion = suggestions[field];
            return (
              <li key={field} className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <span className="text-xs text-muted-foreground">{FIELD_LABELS[field]}: </span>
                  {suggestion ? (
                    <>
                      <span className="break-all">{suggestion.value}</span>
                      <div className="text-xs text-muted-foreground">Contexto: «{suggestion.evidence}»</div>
                    </>
                  ) : (
                    <span className="text-muted-foreground">No detectado</span>
                  )}
                </div>
                {canManage && suggestion ? (
                  <ActionButton size="xs" variant="outline" action={applySuggestedField.bind(null, candidateId, extraction.id, field)}>
                    Aplicar a la ficha
                  </ActionButton>
                ) : null}
              </li>
            );
          })}
        </ul>
        {suggestions.skills?.length ? (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Herramientas y habilidades mencionadas:</p>
            <div className="flex flex-wrap gap-2">
              {suggestions.skills.map((skill) =>
                canManage && !knownSkills.has(skill.value.toLowerCase()) ? (
                  <ActionButton
                    key={skill.value}
                    size="xs"
                    variant="outline"
                    action={addProfileItem.bind(
                      null,
                      candidateId,
                      { kind: "habilidad", title: skill.value, organization: "", startDate: "", endDate: "", description: "", origin: "extraido" },
                      resumeId,
                    )}
                  >
                    + {skill.value}
                  </ActionButton>
                ) : (
                  <span key={skill.value} className="rounded-md border px-2 py-0.5 text-xs" title={skill.evidence}>
                    {skill.value}
                  </span>
                ),
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

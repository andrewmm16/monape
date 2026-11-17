"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  EMAIL_TEMPLATE_VARIABLES,
  EXAMPLE_TEMPLATE_VARS,
  substituteVariables,
  type EmailTemplateContent,
  type EmailTemplateKey,
} from "@/modules/email-templates/defaults";
import { resetEmailTemplate, saveEmailTemplate } from "@/modules/email-templates/actions";
import { TEMPLATE_BODY_MAX, TEMPLATE_SUBJECT_MAX } from "@/modules/email-templates/schemas";

export function TemplateEditor({
  templateKey,
  label,
  when,
  defaults,
  edited,
  extras,
}: {
  templateKey: EmailTemplateKey;
  label: string;
  when: string;
  defaults: EmailTemplateContent;
  edited: (EmailTemplateContent & { updatedAt: string | null }) | undefined;
  /** Partes que agrega el sistema (no editables), para mostrarlas en la vista previa. */
  extras?: { button: string; buttonNote: string; footer: string };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const initial = edited ?? defaults;
  const [subject, setSubject] = useState(initial.subject);
  const [body, setBody] = useState(initial.body);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const isEdited = Boolean(edited);

  const dirty = subject !== initial.subject || body !== initial.body;
  const valid = subject.trim().length > 0 && body.trim().length > 0;
  const previewVars = EXAMPLE_TEMPLATE_VARS;
  const previewSubject = substituteVariables(subject, previewVars).trim();
  const previewParagraphs = substituteVariables(body, previewVars)
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  const insertVariable = (token: string) => {
    const field = bodyRef.current;
    if (!field) {
      setBody((current) => current + token);
      return;
    }
    const start = field.selectionStart ?? body.length;
    const end = field.selectionEnd ?? body.length;
    const next = body.slice(0, start) + token + body.slice(end);
    setBody(next);
    requestAnimationFrame(() => {
      field.focus();
      field.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const save = () =>
    startTransition(async () => {
      const result = await saveEmailTemplate({ key: templateKey, subject, body });
      if (result.ok) {
        toast.success(result.message ?? "Plantilla guardada.");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });

  const restore = () =>
    startTransition(async () => {
      const result = await resetEmailTemplate(templateKey);
      if (result.ok) {
        setSubject(defaults.subject);
        setBody(defaults.body);
        toast.success(result.message ?? "Plantilla restaurada.");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{label}</CardTitle>
          <Badge variant="outline" className={isEdited ? "bg-info text-info-foreground border-transparent" : "text-muted-foreground"}>
            {isEdited ? "Personalizada" : "Texto original"}
          </Badge>
        </div>
        <CardDescription>{when}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Field>
          <FieldLabel htmlFor={`subject-${templateKey}`}>Asunto</FieldLabel>
          <Input
            id={`subject-${templateKey}`}
            value={subject}
            maxLength={TEMPLATE_SUBJECT_MAX}
            onChange={(event) => setSubject(event.target.value)}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor={`body-${templateKey}`}>Mensaje</FieldLabel>
          <Textarea
            id={`body-${templateKey}`}
            ref={bodyRef}
            rows={7}
            value={body}
            maxLength={TEMPLATE_BODY_MAX}
            onChange={(event) => setBody(event.target.value)}
          />
          <FieldDescription>
            Separe los párrafos con una línea en blanco. El saludo («Hola …») y la despedida se agregan solos.
          </FieldDescription>
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <span className="text-xs text-muted-foreground">Insertar:</span>
            {EMAIL_TEMPLATE_VARIABLES.map((variable) => (
              <Button
                key={variable.token}
                type="button"
                variant="outline"
                size="sm"
                className="h-7 font-mono text-xs"
                title={variable.help}
                onClick={() => insertVariable(variable.token)}
              >
                {variable.token}
              </Button>
            ))}
          </div>
        </Field>

        <div className="rounded-md border bg-muted/30 p-3">
          <p className="mb-2 text-xs font-medium text-muted-foreground">Vista previa (con datos de ejemplo)</p>
          <p className="text-sm font-semibold">{previewSubject || "(sin asunto)"}</p>
          <div className="mt-2 space-y-2 text-sm">
            <p>Hola {previewVars.nombre},</p>
            {previewParagraphs.map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
            {extras ? (
              <p className="flex flex-wrap items-center gap-2">
                <span className="inline-block rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-background">
                  {extras.button}
                </span>
                <span className="text-xs text-muted-foreground">{extras.buttonNote}</span>
              </p>
            ) : null}
            <p>
              Saludos cordiales,
              <br />
              Recursos Humanos
            </p>
            {extras ? <p className="border-t pt-2 text-xs text-muted-foreground">{extras.footer}</p> : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" onClick={save} disabled={pending || !dirty || !valid}>
            {pending ? "Guardando…" : "Guardar"}
          </Button>
          {isEdited ? (
            <Button type="button" variant="outline" onClick={restore} disabled={pending}>
              Restaurar al texto original
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

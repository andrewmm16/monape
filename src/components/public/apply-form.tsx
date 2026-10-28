"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { submitOnlineApplication } from "@/modules/online-apply/actions";
import { solveChallenge } from "@/modules/online-apply/pow";
import { onlineApplicationSchema } from "@/modules/online-apply/schema";

const MAX_CV_BYTES = 4 * 1024 * 1024;
/** El servidor exige al menos 3 s entre la emisión del desafío y el envío. */
const MIN_WAIT_MS = 3500;
/** El servidor rechaza desafíos de más de 30 minutos: se renueva antes. */
const MAX_CHALLENGE_AGE_MS = 25 * 60 * 1000;

type Solved = { challenge: string; solution: string; receivedAt: number };
type FieldName = "fullName" | "email" | "phone" | "location" | "linkedinUrl" | "cv" | "acceptNotice";
type Errors = Partial<Record<FieldName, string>>;

const FIELD_IDS: Record<FieldName, string> = {
  fullName: "apply-full-name",
  email: "apply-email",
  phone: "apply-phone",
  location: "apply-location",
  linkedinUrl: "apply-linkedin",
  cv: "apply-cv",
  acceptNotice: "apply-accept-notice",
};

const FIELD_ORDER: FieldName[] = ["fullName", "email", "phone", "location", "linkedinUrl", "cv", "acceptNotice"];

function isFieldName(value: string): value is FieldName {
  return value in FIELD_IDS;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchAndSolve(vacancyCode: string): Promise<Solved> {
  const response = await fetch(`/empleos/desafio/${vacancyCode}`, { cache: "no-store" });
  if (!response.ok) throw new Error("desafio");
  const { challenge, bits } = (await response.json()) as { challenge: string; bits: number };
  const receivedAt = performance.now();
  const solution = await solveChallenge(challenge, bits);
  return { challenge, solution, receivedAt };
}

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? (
    <p id={`${id}-error`} className="text-sm text-destructive">
      {message}
    </p>
  ) : null;
}

export function ApplyForm({
  vacancyCode,
  noticeId,
  noticeVersion,
  companyName,
}: {
  vacancyCode: string;
  noticeId: string;
  noticeVersion: number;
  companyName: string;
}) {
  const challengeRef = useRef<Promise<Solved> | null>(null);
  const referrerRef = useRef<HTMLInputElement>(null);
  const [acceptNotice, setAcceptNotice] = useState(false);
  const [acceptTalentPool, setAcceptTalentPool] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [mustReload, setMustReload] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [reference, setReference] = useState<string | null>(null);

  useEffect(() => {
    // Campo oculto que rellena el navegador: de dónde llegó la persona.
    if (referrerRef.current) referrerRef.current.value = document.referrer;
  }, []);

  /** Pide y resuelve un desafío en segundo plano; un fallo se reintenta al enviar. */
  function startChallenge(): Promise<Solved> {
    if (!challengeRef.current) {
      const promise = fetchAndSolve(vacancyCode);
      promise.catch(() => {
        if (challengeRef.current === promise) challengeRef.current = null;
      });
      challengeRef.current = promise;
    }
    return challengeRef.current;
  }

  async function obtainChallenge(): Promise<Solved> {
    let solved = await startChallenge();
    if (performance.now() - solved.receivedAt > MAX_CHALLENGE_AGE_MS) {
      challengeRef.current = null;
      solved = await startChallenge();
    }
    const remaining = MIN_WAIT_MS - (performance.now() - solved.receivedAt);
    if (remaining > 0) await wait(remaining);
    return solved;
  }

  function showErrors(next: Errors) {
    setErrors(next);
    const first = FIELD_ORDER.find((name) => next[name]);
    if (first) document.getElementById(FIELD_IDS[first])?.focus();
  }

  function validate(form: HTMLFormElement): Errors {
    const data = new FormData(form);
    const text = (name: string) => (typeof data.get(name) === "string" ? (data.get(name) as string) : "");
    const next: Errors = {};
    const parsed = onlineApplicationSchema.safeParse({
      fullName: text("fullName"),
      email: text("email"),
      phone: text("phone"),
      location: text("location"),
      linkedinUrl: text("linkedinUrl"),
      acceptNotice,
      acceptTalentPool,
      noticeId,
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "");
        if (isFieldName(key) && !next[key]) next[key] = issue.message;
      }
    }
    const file = data.get("cv");
    if (!(file instanceof File) || file.size === 0) next.cv = "Adjunte su CV en PDF o Word.";
    else if (file.size > MAX_CV_BYTES) next.cv = "El archivo supera el tamaño máximo de 4 MB.";
    return next;
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const form = event.currentTarget;
    const found = validate(form);
    setFormError(null);
    if (Object.keys(found).length > 0) {
      showErrors(found);
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      const solved = await obtainChallenge();
      const data = new FormData(form);
      data.set("vacancyCode", vacancyCode);
      data.set("noticeId", noticeId);
      data.set("challenge", solved.challenge);
      data.set("solution", solved.solution);
      data.delete("acceptNotice");
      data.delete("acceptTalentPool");
      if (acceptNotice) data.set("acceptNotice", "on");
      if (acceptTalentPool) data.set("acceptTalentPool", "on");

      // El desafío es de un solo uso: sirva o no, el siguiente envío pide otro.
      challengeRef.current = null;
      const result = await submitOnlineApplication(data);
      if (result.ok) {
        setReference(result.reference);
        return;
      }
      if (result.refreshChallenge) void startChallenge().catch(() => undefined);
      if (result.reload) setMustReload(true);
      const serverErrors: Errors = {};
      for (const [key, messages] of Object.entries(result.fieldErrors ?? {})) {
        if (isFieldName(key) && messages[0]) serverErrors[key] = messages[0];
      }
      if (Object.keys(serverErrors).length > 0) showErrors(serverErrors);
      setFormError(result.message);
    } catch {
      challengeRef.current = null;
      setFormError("No se pudo enviar su postulación. Revise su conexión e inténtelo nuevamente.");
    } finally {
      setSubmitting(false);
    }
  }

  if (reference) {
    return (
      <div role="status" className="space-y-2 rounded-lg border bg-background px-4 py-4 text-sm">
        <p>
          Recibimos su postulación. Número de referencia: <strong data-testid="apply-reference">{reference}</strong>. Si su perfil
          avanza en el proceso, el equipo de selección se comunicará con usted
        </p>
      </div>
    );
  }

  const describedBy = (name: FieldName) => (errors[name] ? `${FIELD_IDS[name]}-error` : undefined);

  return (
    <form
      onSubmit={onSubmit}
      onFocus={() => void startChallenge().catch(() => undefined)}
      onChange={() => void startChallenge().catch(() => undefined)}
      noValidate
      className="space-y-4"
    >
      <div className="space-y-1.5">
        <Label htmlFor={FIELD_IDS.fullName}>Nombre completo</Label>
        <Input
          id={FIELD_IDS.fullName}
          name="fullName"
          autoComplete="name"
          maxLength={160}
          className="h-10"
          aria-invalid={errors.fullName ? true : undefined}
          aria-describedby={describedBy("fullName")}
        />
        <FieldError id={FIELD_IDS.fullName} message={errors.fullName} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={FIELD_IDS.email}>Correo electrónico</Label>
        <Input
          id={FIELD_IDS.email}
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          maxLength={254}
          className="h-10"
          aria-invalid={errors.email ? true : undefined}
          aria-describedby={describedBy("email")}
        />
        <FieldError id={FIELD_IDS.email} message={errors.email} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={FIELD_IDS.phone}>Teléfono</Label>
        <Input
          id={FIELD_IDS.phone}
          name="phone"
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          maxLength={40}
          className="h-10"
          aria-invalid={errors.phone ? true : undefined}
          aria-describedby={describedBy("phone")}
        />
        <FieldError id={FIELD_IDS.phone} message={errors.phone} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={FIELD_IDS.location}>Ciudad (opcional)</Label>
        <Input
          id={FIELD_IDS.location}
          name="location"
          autoComplete="address-level2"
          maxLength={160}
          className="h-10"
          aria-invalid={errors.location ? true : undefined}
          aria-describedby={describedBy("location")}
        />
        <FieldError id={FIELD_IDS.location} message={errors.location} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={FIELD_IDS.linkedinUrl}>Perfil de LinkedIn (opcional)</Label>
        <Input
          id={FIELD_IDS.linkedinUrl}
          name="linkedinUrl"
          type="url"
          inputMode="url"
          autoComplete="off"
          maxLength={300}
          className="h-10"
          aria-invalid={errors.linkedinUrl ? true : undefined}
          aria-describedby={describedBy("linkedinUrl")}
        />
        <FieldError id={FIELD_IDS.linkedinUrl} message={errors.linkedinUrl} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={FIELD_IDS.cv}>CV (PDF o Word, hasta 4 MB)</Label>
        <Input
          id={FIELD_IDS.cv}
          name="cv"
          type="file"
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="h-auto py-1.5"
          aria-invalid={errors.cv ? true : undefined}
          aria-describedby={[describedBy("cv"), "apply-cv-hint"].filter(Boolean).join(" ")}
        />
        <p id="apply-cv-hint" className="text-sm text-muted-foreground">
          No incluya en su CV DNI, fotografía, fecha de nacimiento, estado civil ni datos de salud
        </p>
        <FieldError id={FIELD_IDS.cv} message={errors.cv} />
      </div>

      <div className="space-y-3 rounded-lg border bg-background px-3 py-3">
        <p className="text-sm">
          Sus datos serán tratados por {companyName} para este proceso de selección.{" "}
          <Link href={`/empleos/privacidad?v=${noticeId}`} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">
            Leer el aviso de privacidad completo
          </Link>
        </p>
        <div className="space-y-1.5">
          <div className="flex items-start gap-2">
            <Checkbox
              id={FIELD_IDS.acceptNotice}
              checked={acceptNotice}
              onCheckedChange={(value) => setAcceptNotice(value === true)}
              aria-invalid={errors.acceptNotice ? true : undefined}
              aria-describedby={describedBy("acceptNotice")}
              className="mt-0.5"
            />
            <Label htmlFor={FIELD_IDS.acceptNotice} className="items-start font-normal leading-snug">
              He leído y acepto el aviso de privacidad (versión {noticeVersion})
            </Label>
          </div>
          <FieldError id={FIELD_IDS.acceptNotice} message={errors.acceptNotice} />
        </div>
        <div className="flex items-start gap-2">
          <Checkbox
            id="apply-accept-talent-pool"
            checked={acceptTalentPool}
            onCheckedChange={(value) => setAcceptTalentPool(value === true)}
            className="mt-0.5"
          />
          <Label htmlFor="apply-accept-talent-pool" className="items-start font-normal leading-snug">
            Acepto que conserven mi CV para futuras vacantes (opcional)
          </Label>
        </div>
      </div>

      {/* Campo trampa: fuera de pantalla y fuera del orden de tabulación. */}
      <div aria-hidden="true" className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden">
        <label htmlFor="apply-website">No complete este campo</label>
        <input id="apply-website" name="website" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
      </div>
      <input ref={referrerRef} type="hidden" name="referrer" defaultValue="" />

      <div aria-live="polite" className="space-y-2">
        {formError ? (
          <p role="alert" className="text-sm text-destructive">
            {formError}
          </p>
        ) : null}
        {mustReload ? (
          <Button type="button" variant="outline" onClick={() => window.location.reload()}>
            Recargar la página
          </Button>
        ) : null}
      </div>

      <Button type="submit" size="lg" className="h-11 w-full sm:w-auto" disabled={submitting || mustReload} aria-busy={submitting}>
        {submitting ? "Enviando su postulación…" : "Enviar postulación"}
      </Button>
    </form>
  );
}

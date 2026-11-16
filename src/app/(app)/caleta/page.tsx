import type { Metadata } from "next";
import Link from "next/link";
import {
  CheckIcon,
  CircleHelpIcon,
  ExternalLinkIcon,
  MailIcon,
  MessageCircleIcon,
  MinusIcon,
  PhoneIcon,
  XIcon,
} from "lucide-react";
import { AccessDenied } from "@/components/common/access-denied";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { AddProspectForm } from "@/components/caleta/add-prospect-form";
import { ProspectActions } from "@/components/caleta/prospect-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { can } from "@/lib/auth/permissions";
import { CALETA_EN_STANDBY } from "@/lib/flags";
import { requirePageUser } from "@/lib/auth/session";
import {
  ASSESSMENT_LABELS,
  CALETA_CONTACT_CHANNEL_LABELS,
  CALETA_SOURCE_LABELS,
  CALETA_STATUS_LABELS,
  COMPATIBILITY_LEVEL_LABELS,
  REQUIREMENT_PRIORITY_LABELS,
} from "@/lib/labels";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  buildOutreachMessage,
  LINKEDIN_WEEKLY_SAFE_LIMIT,
  linkedinWindowStart,
  mailtoLink,
  waLink,
} from "@/modules/caleta/outreach";
import {
  countContactedSince,
  listCaletaVacancies,
  listProspects,
  listVacancyRequirements,
  type CaletaProspect,
  type CaletaRequirement,
} from "@/modules/caleta/queries";
import type { EvaluationResult } from "@/modules/evaluation/types";
import type { Enums } from "@/types/database";

export const metadata: Metadata = { title: "Reclutador Caleta" };

const STATUS_ORDER: Enums<"caleta_status">[] = [
  "encontrado",
  "contactado",
  "conectado",
  "respondio",
  "interesado",
  "derivado",
  "descartado",
];

type Assessment = Enums<"requirement_assessment">;

const ASSESSMENT_STYLE: Record<Assessment, { Icon: typeof CheckIcon; className: string }> = {
  acreditado: { Icon: CheckIcon, className: "text-success-foreground" },
  no_cumplido: { Icon: XIcon, className: "text-destructive" },
  sin_evidencia: { Icon: MinusIcon, className: "text-muted-foreground" },
  pendiente_verificacion: { Icon: CircleHelpIcon, className: "text-warning-foreground" },
};

function scoreBadgeVariant(level: Enums<"compatibility_level"> | undefined) {
  if (level === "alta") return "default" as const;
  if (level === "parcial") return "secondary" as const;
  return "outline" as const;
}

function RequirementChecklist({
  requirements,
  detail,
}: {
  requirements: CaletaRequirement[];
  detail: EvaluationResult | null;
}) {
  const byId = new Map((detail?.items ?? []).map((item) => [item.requirementId, item.assessment]));
  const sorted = [...requirements].sort((a, b) =>
    a.priority === b.priority ? 0 : a.priority === "obligatorio" ? -1 : 1,
  );
  return (
    <ul className="flex flex-col gap-1.5">
      {sorted.map((requirement) => {
        const assessment = (byId.get(requirement.id) ?? "sin_evidencia") as Assessment;
        const { Icon, className } = ASSESSMENT_STYLE[assessment];
        return (
          <li key={requirement.id} className="flex items-start gap-2 text-sm">
            <Icon className={`mt-0.5 size-4 shrink-0 ${className}`} aria-hidden />
            <span className="min-w-0 flex-1">
              {requirement.description}
              {requirement.priority === "deseable" ? (
                <span className="ml-1 text-xs text-muted-foreground">({REQUIREMENT_PRIORITY_LABELS.deseable})</span>
              ) : null}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">{ASSESSMENT_LABELS[assessment]}</span>
          </li>
        );
      })}
    </ul>
  );
}

const dateFmt = new Intl.DateTimeFormat("es-PE", { day: "2-digit", month: "short", year: "numeric" });

function ProspectCard({
  prospect,
  requirements,
  vacancyTitle,
  canDelete,
  canDerive,
}: {
  prospect: CaletaProspect;
  requirements: CaletaRequirement[];
  vacancyTitle: string;
  canDelete: boolean;
  canDerive: boolean;
}) {
  const detail = (prospect.score_detail as unknown as EvaluationResult | null) ?? null;
  const level = detail?.level;
  const derived = prospect.status === "derivado";

  return (
    <Card>
      <CardHeader>
        <CardTitle>{prospect.full_name}</CardTitle>
        {prospect.headline || prospect.location ? (
          <CardDescription>
            {[prospect.headline, prospect.location].filter(Boolean).join(" · ")}
          </CardDescription>
        ) : null}
        <CardAction className="flex flex-col items-end gap-1">
          <Badge variant={scoreBadgeVariant(level)} className="tabular-nums">
            {prospect.score ?? "—"}%
          </Badge>
          {level ? <span className="text-right text-xs text-muted-foreground">{COMPATIBILITY_LEVEL_LABELS[level]}</span> : null}
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Progress value={prospect.score ?? 0} />

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <Badge variant="outline">{CALETA_SOURCE_LABELS[prospect.source]}</Badge>
          {prospect.linkedin_url ? (
            <a
              href={prospect.linkedin_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 hover:text-foreground hover:underline"
            >
              <ExternalLinkIcon className="size-3.5" aria-hidden /> LinkedIn
            </a>
          ) : null}
          {prospect.phone ? (
            <>
              <span className="inline-flex items-center gap-1">
                <PhoneIcon className="size-3.5" aria-hidden /> {prospect.phone}
              </span>
              <a
                href={waLink(prospect.phone, prospect.full_name, vacancyTitle)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-success-foreground hover:underline"
              >
                <MessageCircleIcon className="size-3.5" aria-hidden /> WhatsApp
              </a>
            </>
          ) : (
            <span className="italic">Sin teléfono aún</span>
          )}
          {prospect.email ? (
            <a
              href={mailtoLink(prospect.email, prospect.full_name, vacancyTitle)}
              className="inline-flex items-center gap-1 hover:text-foreground hover:underline"
            >
              <MailIcon className="size-3.5" aria-hidden /> {prospect.email}
            </a>
          ) : null}
        </div>

        {prospect.contacted_at ? (
          <div className="flex items-center gap-1 text-xs text-success-foreground">
            <CheckIcon className="size-3.5" aria-hidden />
            {prospect.contact_channel === "linkedin" && prospect.status === "contactado"
              ? "Invitación enviada por LinkedIn, esperando que acepte"
              : `Contactado${prospect.contact_channel ? ` por ${CALETA_CONTACT_CHANNEL_LABELS[prospect.contact_channel]}` : ""}`}
            {" · "}
            {dateFmt.format(new Date(prospect.contacted_at))}
          </div>
        ) : null}

        <RequirementChecklist requirements={requirements} detail={detail} />
      </CardContent>
      <CardFooter>
        <ProspectActions
          id={prospect.id}
          status={prospect.status}
          phone={prospect.phone}
          email={prospect.email}
          derived={derived}
          canDelete={canDelete}
          canDerive={canDerive}
          linkedinUrl={prospect.linkedin_url}
          contactNote={buildOutreachMessage(prospect.full_name, vacancyTitle, "linkedin")}
          contactChannel={prospect.contact_channel}
        />
      </CardFooter>
    </Card>
  );
}

export default async function CaletaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePageUser();
  if (!can(user.role, "caleta:use")) return <AccessDenied />;

  // Módulo en pausa: se bloquea el acceso aunque se entre por URL directa.
  if (CALETA_EN_STANDBY) {
    return (
      <>
        <PageHeader title="Reclutador Caleta" description="Sourcing proactivo de perfiles por puesto." />
        <EmptyState
          title="En pausa"
          description="El Reclutador Caleta está temporalmente en pausa. No está disponible por ahora; se reactivará más adelante."
        />
      </>
    );
  }

  const supabase = await createSupabaseServerClient();
  const vacancies = await listCaletaVacancies(supabase);

  if (vacancies.length === 0) {
    return (
      <>
        <PageHeader title="Reclutador Caleta" description="Sourcing proactivo de perfiles por puesto." />
        <EmptyState
          title="No hay puestos con requisitos"
          description="Crea las vacantes con sus requisitos (por ejemplo con «npm run db:seed:caleta») para poder puntuar prospectos."
        />
      </>
    );
  }

  const params = await searchParams;
  const requested = typeof params.vacante === "string" ? params.vacante : undefined;
  const selected = vacancies.find((v) => v.id === requested) ?? vacancies[0]!;

  const [requirements, prospects, invitesThisWeek] = await Promise.all([
    listVacancyRequirements(supabase, selected.id),
    listProspects(supabase, selected.id),
    countContactedSince(supabase, "linkedin", linkedinWindowStart()),
  ]);
  const remainingLinkedIn = Math.max(0, LINKEDIN_WEEKLY_SAFE_LIMIT - invitesThisWeek);
  const canDelete = can(user.role, "vacancies:delete"); // solo admin elimina (RLS)
  const canDerive = can(user.role, "candidates:manage"); // reclutador_caleta no deriva

  const grouped = STATUS_ORDER.map((status) => ({
    status,
    items: prospects.filter((p) => p.status === status),
  })).filter((group) => group.items.length > 0);

  return (
    <>
      <PageHeader
        title="Reclutador Caleta"
        description="Pega perfiles encontrados (LinkedIn, CIP, grupos), míralos puntuados contra el puesto y contáctalos por el canal donde el mensaje es esperado."
      />

      <div className="flex flex-wrap gap-2" aria-label="Puestos">
        {vacancies.map((vacancy) => (
          <Button
            key={vacancy.id}
            asChild
            size="sm"
            variant={vacancy.id === selected.id ? "default" : "outline"}
          >
            <Link href={`/caleta?vacante=${vacancy.id}`}>{vacancy.title}</Link>
          </Button>
        ))}
      </div>

      <div
        className={`rounded-md border px-3 py-2 text-xs ${
          remainingLinkedIn === 0
            ? "border-warning-foreground/40 bg-warning text-warning-foreground"
            : "border-border bg-muted/40 text-muted-foreground"
        }`}
      >
        Invitaciones de LinkedIn en los últimos 7 días: <strong className="tabular-nums">{invitesThisWeek}</strong> de{" "}
        <strong className="tabular-nums">{LINKEDIN_WEEKLY_SAFE_LIMIT}</strong> recomendadas.{" "}
        {remainingLinkedIn === 0
          ? "Llegaste al tope seguro de la semana: espera unos días para no arriesgar tu cuenta."
          : `Te quedan ${remainingLinkedIn}. Empieza por los de mayor puntaje (la lista ya está ordenada así).`}
        <br />
        Cómo: «Conectar en LinkedIn» abre el perfil → pulsa Conectar (o Más → Conectar) → Enviar sin nota. Cuando
        acepte, pulsa «Aceptó: copiar mensaje» y envíaselo por Mensaje (gratis entre contactos).
      </div>

      <AddProspectForm vacancyId={selected.id} />

      {prospects.length === 0 ? (
        <EmptyState
          title="Aún no hay prospectos para este puesto"
          description="Agrega el primero pegando un perfil arriba."
        />
      ) : (
        <div className="flex flex-col gap-6">
          {grouped.map((group) => (
            <section key={group.status} className="flex flex-col gap-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                {CALETA_STATUS_LABELS[group.status]}
                <Badge variant="secondary" className="tabular-nums">
                  {group.items.length}
                </Badge>
              </h2>
              <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
                {group.items.map((prospect) => (
                  <ProspectCard
                    key={prospect.id}
                    prospect={prospect}
                    requirements={requirements}
                    vacancyTitle={selected.title}
                    canDelete={canDelete}
                    canDerive={canDerive}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/format";
import { EMPLOYMENT_TYPE_LABELS, REQUIREMENT_PRIORITY_LABELS, WORK_MODALITY_LABELS } from "@/lib/labels";
import { logServerError } from "@/lib/errors";
import { ApplyForm } from "@/components/public/apply-form";
import { getOnlineApplyConfig } from "@/modules/online-apply/config";
import { getCurrentPrivacyNotice } from "@/modules/privacy/queries";
import { getPublicJobsConfig, requirePublicJobsConfig } from "@/modules/public-jobs/config";
import { formatSalaryText } from "@/modules/public-jobs/feed";
import { textToHtml } from "@/modules/public-jobs/html";
import { buildJobPosting, serializeJsonLd } from "@/modules/public-jobs/job-posting";
import { getPublicVacancy, listPublicRequirements } from "@/modules/public-jobs/queries";
import { buildJobSlug, parseJobSlug } from "@/modules/public-jobs/slug";

async function loadVacancy(slug: string) {
  const code = parseJobSlug(slug);
  if (!code) notFound();
  const vacancy = await getPublicVacancy(code);
  if (!vacancy) notFound();
  return vacancy;
}

export async function generateMetadata({ params }: PageProps<"/empleos/[slug]">): Promise<Metadata> {
  const config = getPublicJobsConfig();
  if (!config.enabled) return {};
  const { slug } = await params;
  const code = parseJobSlug(slug);
  const vacancy = code ? await getPublicVacancy(code) : null;
  if (!vacancy) return {};
  const canonical = `${config.siteUrl}/empleos/${buildJobSlug(vacancy.title, vacancy.code)}`;
  return {
    title: vacancy.title,
    description: `${vacancy.title} en ${config.companyName}.`,
    alternates: { canonical },
    // Una convocatoria cerrada sigue accesible pero sale de los buscadores.
    ...(vacancy.acceptingApplications ? {} : { robots: { index: false, follow: false } }),
  };
}

export default async function PublicJobPage({ params }: PageProps<"/empleos/[slug]">) {
  const site = requirePublicJobsConfig();
  const { slug } = await params;
  const vacancy = await loadVacancy(slug);

  const canonicalSlug = buildJobSlug(vacancy.title, vacancy.code);
  if (slug !== canonicalSlug) permanentRedirect(`/empleos/${canonicalSlug}`);

  if (!vacancy.acceptingApplications) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">{vacancy.title}</h1>
        <p role="status" className="rounded-lg border bg-background px-4 py-3 text-sm">
          Esta convocatoria ya no recibe postulaciones
        </p>
      </div>
    );
  }

  const requirements = await listPublicRequirements(vacancy.code);
  // El formulario se ofrece solo con la función encendida y un aviso vigente.
  // Si la consulta del aviso falla, la página sigue: sin formulario y con el botón deshabilitado.
  let notice: Awaited<ReturnType<typeof getCurrentPrivacyNotice>> = null;
  if (getOnlineApplyConfig().enabled) {
    try {
      notice = await getCurrentPrivacyNotice();
    } catch (error) {
      logServerError("public_job.notice", error);
    }
  }
  const offersForm = notice !== null;
  const jsonLd = serializeJsonLd(buildJobPosting(vacancy, site, { directApply: offersForm }));
  const location = [vacancy.city, vacancy.region].filter(Boolean).join(", ");

  return (
    <article className="space-y-6">
      {/* Datos estructurados: bloque de datos (no se ejecuta), por lo que la CSP no exige nonce. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{vacancy.title}</h1>
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span>{vacancy.department}</span>
          {location ? <span>{location}</span> : null}
          {vacancy.modality ? <span>{WORK_MODALITY_LABELS[vacancy.modality]}</span> : null}
          <span>{EMPLOYMENT_TYPE_LABELS[vacancy.employmentType]}</span>
          {vacancy.contractType ? <span>{vacancy.contractType}</span> : null}
          {vacancy.salary ? <span>{formatSalaryText(vacancy.salary)}</span> : null}
        </p>
        <p className="text-xs text-muted-foreground">
          Publicada el {formatDate(vacancy.firstPublishedAt)}
          {vacancy.closingDate ? ` · Postule hasta el ${formatDate(vacancy.closingDate)}` : ""}
        </p>
        {offersForm ? (
          <Button asChild className="mt-2">
            <a href="#postular">Postular</a>
          </Button>
        ) : null}
      </header>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Descripción</h2>
          </CardTitle>
        </CardHeader>
        <CardContent
          className="space-y-3 text-sm [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5"
          // El HTML lo genera textToHtml: todo el texto del usuario va escapado.
          dangerouslySetInnerHTML={{ __html: textToHtml(vacancy.description) }}
        />
      </Card>

      {vacancy.responsibilities.trim() ? (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Responsabilidades</h2>
            </CardTitle>
          </CardHeader>
          <CardContent
            className="space-y-3 text-sm [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5"
            dangerouslySetInnerHTML={{ __html: textToHtml(vacancy.responsibilities) }}
          />
        </Card>
      ) : null}

      {requirements.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Requisitos</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {requirements.map((requirement, index) => (
                <li key={index} className="flex flex-wrap items-baseline gap-2">
                  <span>{requirement.description}</span>
                  <span className="text-xs text-muted-foreground">({REQUIREMENT_PRIORITY_LABELS[requirement.priority]})</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {notice ? (
        <section id="postular" aria-labelledby="postular-titulo" className="scroll-mt-4 space-y-4">
          <h2 id="postular-titulo" className="text-xl font-semibold tracking-tight">
            Postular a esta vacante
          </h2>
          <ApplyForm vacancyCode={vacancy.code} noticeId={notice.id} noticeVersion={notice.version} companyName={site.companyName} />
        </section>
      ) : (
        <div className="space-y-2">
          <Button disabled>Postular</Button>
          <p className="text-sm text-muted-foreground">Las postulaciones en línea se habilitarán próximamente</p>
        </div>
      )}
    </article>
  );
}

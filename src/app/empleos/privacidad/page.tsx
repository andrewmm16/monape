import type { Metadata } from "next";
import { EmptyState } from "@/components/common/empty-state";
import { NoticeText } from "@/components/privacy/notice-text";
import { formatDate } from "@/lib/format";
import { requirePublicJobsConfig } from "@/modules/public-jobs/config";
import { getCurrentPrivacyNotice } from "@/modules/privacy/queries";

// Aviso vigente: no se indexa (la versión puede cambiar) ni se enlaza desde el sitemap.
export const metadata: Metadata = {
  title: "Aviso de privacidad",
  robots: { index: false, follow: false },
};

export default async function PublicPrivacyPage({ searchParams }: PageProps<"/empleos/privacidad">) {
  requirePublicJobsConfig();
  const notice = await getCurrentPrivacyNotice();
  // `?v=<id>` fija la versión que se mostró en el formulario; solo se respeta si
  // es la vigente (la consulta nunca devuelve borradores ni versiones retiradas).
  const { v } = await searchParams;
  const requested = typeof v === "string" ? v : null;
  const outdated = requested !== null && notice !== null && requested !== notice.id;

  if (!notice) {
    return <EmptyState title="No hay un aviso de privacidad vigente" description="Vuelva a consultar más adelante." />;
  }
  return (
    <article className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{notice.title}</h1>
        <p className="text-xs text-muted-foreground">
          Versión {notice.version} · vigente desde el {formatDate(notice.effectiveFrom)}
        </p>
      </header>
      {outdated ? (
        <p role="status" className="rounded-lg border bg-background px-4 py-3 text-sm">
          Esta versión ya no está vigente; se muestra la actual
        </p>
      ) : null}
      <NoticeText text={notice.body} />
    </article>
  );
}

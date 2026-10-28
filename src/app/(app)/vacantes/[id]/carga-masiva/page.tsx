import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { AccessDenied } from "@/components/common/access-denied";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { BatchWorkspace, type BatchItemView } from "@/components/intake/batch-workspace";
import { PortalPicker } from "@/components/intake/portal-picker";
import { can } from "@/lib/auth/permissions";
import { requirePageUser } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getOpenBatch, listActivePortals, listBatchDuplicates, listBatchItems } from "@/modules/intake/queries";
import { getVacancy } from "@/modules/vacancies/queries";

export const metadata: Metadata = { title: "Carga masiva de CV" };

export default async function BulkUploadPage({ params }: PageProps<"/vacantes/[id]/carga-masiva">) {
  const user = await requirePageUser();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  if (!can(user.role, "candidates:manage") || !can(user.role, "resumes:upload")) return <AccessDenied />;

  const supabase = await createSupabaseServerClient();
  const vacancy = await getVacancy(supabase, id).catch((error: unknown) => {
    if (error instanceof AppError && error.code === "not_found") notFound();
    throw error;
  });
  const admitsApplications = vacancy.status === "borrador" || vacancy.status === "publicada";
  const batch = admitsApplications ? await getOpenBatch(supabase, vacancy.id, user.id) : null;

  let content: React.ReactNode;
  if (!admitsApplications) {
    content = (
      <EmptyState
        title="La vacante no admite nuevas postulaciones"
        description="Solo se pueden cargar CV en vacantes en borrador o publicadas."
      />
    );
  } else if (batch) {
    const [rows, duplicates] = await Promise.all([listBatchItems(supabase, batch.id), listBatchDuplicates(supabase, batch.id)]);
    const duplicatesByItem = new Map<string, BatchItemView["duplicates"]>();
    for (const duplicate of duplicates) {
      if (!duplicate.item_id) continue;
      const list = duplicatesByItem.get(duplicate.item_id) ?? [];
      list.push({ fullName: duplicate.full_name ?? "", reasons: duplicate.match_reasons ?? [] });
      duplicatesByItem.set(duplicate.item_id, list);
    }
    const items: BatchItemView[] = rows.map((row) => {
      const suggested = row.suggested_fields as { name?: { evidence?: string } } | null;
      return {
        id: row.id,
        status: row.status,
        filename: row.original_filename,
        fullName: row.full_name ?? "",
        email: row.email ?? "",
        phone: row.phone ?? "",
        fromOcr: row.extraction_method === "pdf_ocr",
        nameEvidence: row.name_from_cv ? (suggested?.name?.evidence ?? null) : null,
        warnings: row.warnings ?? [],
        applicationId: row.application_id,
        duplicates: duplicatesByItem.get(row.id) ?? [],
      };
    });
    content = (
      <BatchWorkspace
        vacancyId={vacancy.id}
        batchId={batch.id}
        portalName={batch.job_portals?.name ?? "—"}
        items={items}
      />
    );
  } else {
    content = <PortalPicker vacancyId={vacancy.id} portals={await listActivePortals(supabase)} />;
  }

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`/vacantes/${vacancy.id}`} className="hover:underline">
            {vacancy.title}
          </Link>
        }
        title="Carga masiva de CV"
        description="Suba los CV descargados de un portal. Revise los datos de cada persona antes de registrarla; las postulaciones quedan asociadas a esta vacante y al portal."
      />
      {content}
    </>
  );
}

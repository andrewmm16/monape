import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PlusIcon } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { NoticeEditorDialog } from "@/components/privacy/notice-editor-dialog";
import { NoticeRowActions } from "@/components/privacy/notice-row-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can } from "@/lib/auth/permissions";
import { requirePageUser } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format";
import { PRIVACY_NOTICE_STATUS_LABELS } from "@/lib/labels";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listPrivacyNotices } from "@/modules/privacy/queries";
import { PRIVACY_NOTICE_TEMPLATE_BODY, PRIVACY_NOTICE_TEMPLATE_TITLE } from "@/modules/privacy/template";

export const metadata: Metadata = { title: "Aviso de privacidad" };

export default async function PrivacySettingsPage() {
  const user = await requirePageUser();
  // Solo administración: para el resto la página no existe.
  if (!can(user.role, "privacy:manage")) notFound();
  const supabase = await createSupabaseServerClient();
  const notices = await listPrivacyNotices(supabase);

  return (
    <>
      <PageHeader
        eyebrow="Configuración"
        title="Aviso de privacidad"
        description={
          <>
            Versiones del aviso que se muestra a los postulantes. Solo se activa un texto aprobado por el área legal. La
            versión vigente se publica en{" "}
            <Link href="/empleos/privacidad" className="underline">
              /empleos/privacidad
            </Link>
            .
          </>
        }
        actions={
          <NoticeEditorDialog
            initialValues={{ title: PRIVACY_NOTICE_TEMPLATE_TITLE, body: PRIVACY_NOTICE_TEMPLATE_BODY }}
            trigger={
              <Button type="button">
                <PlusIcon /> Nuevo borrador
              </Button>
            }
          />
        }
      />
      {notices.length === 0 ? (
        <EmptyState
          title="Aún no hay versiones"
          description="Cree un borrador a partir del texto sugerido, complételo con el área legal y actívelo cuando esté aprobado."
        />
      ) : (
        <div className="overflow-hidden rounded-md border bg-card shadow-xs">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Versión</TableHead>
                <TableHead>Título</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="hidden md:table-cell">Vigente desde</TableHead>
                <TableHead className="hidden lg:table-cell">Referencia de aprobación</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {notices.map((notice) => (
                <TableRow key={notice.id}>
                  <TableCell className="font-medium">{notice.version}</TableCell>
                  <TableCell className="max-w-xs break-words whitespace-normal">{notice.title}</TableCell>
                  <TableCell>
                    <Badge variant={notice.status === "vigente" ? "default" : "outline"}>
                      {PRIVACY_NOTICE_STATUS_LABELS[notice.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{formatDateTime(notice.effective_from)}</TableCell>
                  <TableCell className="hidden max-w-xs break-words whitespace-normal lg:table-cell">
                    {notice.approval_reference ?? "—"}
                  </TableCell>
                  <TableCell>
                    <NoticeRowActions notice={notice} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}

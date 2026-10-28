import type { Metadata } from "next";
import Link from "next/link";
import { PlusIcon } from "lucide-react";
import { z } from "zod";
import { VacancyStatusBadge } from "@/components/common/badges";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can } from "@/lib/auth/permissions";
import { requirePageUser } from "@/lib/auth/session";
import { formatDate } from "@/lib/format";
import { VACANCY_STATUS_LABELS, WORK_MODALITY_LABELS } from "@/lib/labels";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listVacancies } from "@/modules/vacancies/queries";
import { vacancyStatusSchema } from "@/modules/vacancies/schemas";
import { Constants } from "@/types/database";

export const metadata: Metadata = { title: "Vacantes" };

const statusFilter = vacancyStatusSchema.or(z.literal("")).catch("");

export default async function VacanciesPage({ searchParams }: PageProps<"/vacantes">) {
  const user = await requirePageUser();
  const params = await searchParams;
  const status = statusFilter.parse(params.estado);
  const q = typeof params.q === "string" ? params.q.slice(0, 100) : "";

  const supabase = await createSupabaseServerClient();
  const vacancies = await listVacancies(supabase, { status, q });
  const canManage = can(user.role, "vacancies:manage");

  return (
    <>
      <PageHeader
        title="Vacantes"
        description="Gestione vacantes, requisitos y criterios de evaluación."
        actions={
          canManage ? (
            <Button asChild>
              <Link href="/vacantes/nueva">
                <PlusIcon /> Nueva vacante
              </Link>
            </Button>
          ) : null
        }
      />
      <form method="get" className="flex flex-col gap-2 sm:flex-row" aria-label="Filtros de vacantes">
        <Input name="q" defaultValue={q} placeholder="Buscar por título o área" className="sm:w-72" aria-label="Buscar" />
        <NativeSelect name="estado" defaultValue={status} aria-label="Estado" className="sm:w-56">
          <NativeSelectOption value="">Activas (sin archivadas)</NativeSelectOption>
          {Constants.public.Enums.vacancy_status.map((value) => (
            <NativeSelectOption key={value} value={value}>
              {VACANCY_STATUS_LABELS[value]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <Button type="submit" variant="outline">
          Filtrar
        </Button>
      </form>

      {vacancies.length === 0 ? (
        <EmptyState title="No hay vacantes" description={canManage ? "Cree la primera vacante para comenzar." : undefined} />
      ) : (
        <div className="overflow-hidden rounded-md border bg-card shadow-xs">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vacante</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="hidden md:table-cell">Criterios</TableHead>
                <TableHead className="text-right">Candidatos</TableHead>
                <TableHead className="hidden lg:table-cell">Responsable</TableHead>
                <TableHead className="hidden lg:table-cell">Cierre</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {vacancies.map((vacancy) => (
                <TableRow key={vacancy.id}>
                  <TableCell className="whitespace-normal">
                    <Link href={`/vacantes/${vacancy.id}`} className="font-medium hover:underline">
                      {vacancy.title}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {vacancy.department}
                      {vacancy.modality ? ` · ${WORK_MODALITY_LABELS[vacancy.modality]}` : ""}
                      {vacancy.location ? ` · ${vacancy.location}` : ""}
                    </div>
                  </TableCell>
                  <TableCell>
                    <VacancyStatusBadge status={vacancy.status} />
                  </TableCell>
                  <TableCell className="hidden text-sm md:table-cell">
                    {vacancy.criteria_approved_at ? `Versión ${vacancy.criteria_version} aprobada` : "Pendiente de aprobación"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{vacancy.applications[0]?.count ?? 0}</TableCell>
                  <TableCell className="hidden lg:table-cell">{vacancy.owner?.full_name ?? "—"}</TableCell>
                  <TableCell className="hidden lg:table-cell">{formatDate(vacancy.closing_date)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}

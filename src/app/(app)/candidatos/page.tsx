import type { Metadata } from "next";
import Link from "next/link";
import { PlusIcon } from "lucide-react";
import { z } from "zod";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { Pagination } from "@/components/common/pagination";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can } from "@/lib/auth/permissions";
import { requirePageUser } from "@/lib/auth/session";
import { formatDate } from "@/lib/format";
import { CANDIDATE_SOURCE_LABELS } from "@/lib/labels";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { CANDIDATES_PAGE_SIZE, listCandidates } from "@/modules/candidates/queries";

export const metadata: Metadata = { title: "Candidatos" };

const paramsSchema = z.object({
  q: z.string().trim().max(100).catch(""),
  page: z.coerce.number().int().min(1).max(1000).catch(1),
});

export default async function CandidatesPage({ searchParams }: PageProps<"/candidatos">) {
  const user = await requirePageUser();
  const params = paramsSchema.parse(await searchParams);
  const supabase = await createSupabaseServerClient();
  const { rows, total } = await listCandidates(supabase, params);
  const canManage = can(user.role, "candidates:manage");

  return (
    <>
      <PageHeader
        title="Candidatos"
        description={canManage ? "Registro de candidatos, CV y postulaciones." : "Candidatos de las vacantes en las que participa."}
        actions={
          canManage ? (
            <Button asChild>
              <Link href="/candidatos/nuevo">
                <PlusIcon /> Registrar candidato
              </Link>
            </Button>
          ) : null
        }
      />
      <form method="get" className="flex gap-2" aria-label="Buscar candidatos">
        <Input name="q" defaultValue={params.q} placeholder="Buscar por nombre o correo" className="sm:w-80" aria-label="Buscar" />
        <Button type="submit" variant="outline">
          Buscar
        </Button>
      </form>
      {rows.length === 0 ? (
        <EmptyState title="No se encontraron candidatos" />
      ) : (
        <div className="overflow-hidden rounded-md border bg-card shadow-xs">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead className="hidden md:table-cell">Correo</TableHead>
                <TableHead className="hidden lg:table-cell">Fuente</TableHead>
                <TableHead className="text-right">Postulaciones</TableHead>
                <TableHead className="hidden md:table-cell">Registro</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((candidate) => (
                <TableRow key={candidate.id}>
                  <TableCell>
                    <Link href={`/candidatos/${candidate.id}`} className="font-medium hover:underline">
                      {candidate.full_name}
                    </Link>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{candidate.email ?? "—"}</TableCell>
                  <TableCell className="hidden lg:table-cell">{CANDIDATE_SOURCE_LABELS[candidate.source]}</TableCell>
                  <TableCell className="text-right tabular-nums">{candidate.applications[0]?.count ?? 0}</TableCell>
                  <TableCell className="hidden md:table-cell">{formatDate(candidate.created_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <Pagination
        page={params.page}
        pageSize={CANDIDATES_PAGE_SIZE}
        total={total}
        hrefForPage={(page) => `/candidatos?${new URLSearchParams({ ...(params.q ? { q: params.q } : {}), page: String(page) })}`}
      />
    </>
  );
}

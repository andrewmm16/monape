import type { Metadata } from "next";
import Link from "next/link";
import { AccessDenied } from "@/components/common/access-denied";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { Pagination } from "@/components/common/pagination";
import { ReactivateCandidateDialog } from "@/components/talent/reactivate-candidate-dialog";
import { TalentConsentBadge } from "@/components/talent/talent-consent-badge";
import { TalentTagBadge } from "@/components/talent/talent-tag-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can } from "@/lib/auth/permissions";
import { requirePageUser } from "@/lib/auth/session";
import { formatDate } from "@/lib/format";
import { APPLICATION_STATUS_LABELS, CANDIDATE_SOURCE_LABELS } from "@/lib/labels";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  TALENT_PAGE_SIZE,
  listReactivableVacancies,
  listTalentTags,
  searchTalentPool,
} from "@/modules/talent-pool/queries";
import { TALENT_APPLICATION_STATUSES, TALENT_SOURCES, talentFiltersSchema } from "@/modules/talent-pool/schema";

export const metadata: Metadata = { title: "Buscar en el pool de talento" };

const MAX_TAGS_SHOWN = 3;

export default async function TalentSearchPage({ searchParams }: PageProps<"/candidatos/buscar">) {
  const user = await requirePageUser();
  if (!can(user.role, "candidates:manage")) return <AccessDenied />;
  const filters = talentFiltersSchema.parse(await searchParams);
  const supabase = await createSupabaseServerClient();
  const [{ rows, total }, allTags, vacancies] = await Promise.all([
    searchTalentPool(supabase, filters),
    listTalentTags(supabase),
    listReactivableVacancies(supabase),
  ]);

  const hasFilters = Boolean(filters.q || filters.skills || filters.source || filters.location || filters.status || filters.tag);
  const hrefForPage = (page: number) => {
    const qs = new URLSearchParams();
    if (filters.q) qs.set("q", filters.q);
    if (filters.skills) qs.set("skills", filters.skills);
    if (filters.source) qs.set("source", filters.source);
    if (filters.location) qs.set("location", filters.location);
    if (filters.status) qs.set("status", filters.status);
    if (filters.tag) qs.set("tag", filters.tag);
    qs.set("page", String(page));
    return `/candidatos/buscar?${qs}`;
  };

  return (
    <>
      <PageHeader
        title="Pool de talento"
        description="Busque en el histórico de candidatos para reutilizarlos en nuevas vacantes. Los filtros se combinan."
      />
      <form method="get" className="grid gap-4 rounded-md border bg-card p-4 shadow-xs sm:grid-cols-2 lg:grid-cols-3" aria-label="Filtros de búsqueda">
        <div className="grid gap-1.5">
          <Label htmlFor="q">Nombre o texto del CV</Label>
          <Input id="q" name="q" defaultValue={filters.q} placeholder="Ej.: contabilidad" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="skills">Habilidades (separadas por coma)</Label>
          <Input id="skills" name="skills" defaultValue={filters.skills} placeholder="Ej.: Excel, SQL" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="location">Ubicación</Label>
          <Input id="location" name="location" defaultValue={filters.location} placeholder="Ej.: Lima" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="source">Fuente</Label>
          <NativeSelect id="source" name="source" defaultValue={filters.source ?? ""} className="w-full">
            <NativeSelectOption value="">Todas</NativeSelectOption>
            {TALENT_SOURCES.map((s) => (
              <NativeSelectOption key={s} value={s}>
                {CANDIDATE_SOURCE_LABELS[s]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="status">Estado en algún proceso previo</Label>
          <NativeSelect id="status" name="status" defaultValue={filters.status ?? ""} className="w-full">
            <NativeSelectOption value="">Cualquiera</NativeSelectOption>
            {TALENT_APPLICATION_STATUSES.map((s) => (
              <NativeSelectOption key={s} value={s}>
                {APPLICATION_STATUS_LABELS[s]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="tag">Etiqueta</Label>
          <NativeSelect id="tag" name="tag" defaultValue={filters.tag ?? ""} className="w-full">
            <NativeSelectOption value="">Todas</NativeSelectOption>
            {allTags.map((t) => (
              <NativeSelectOption key={t.id} value={t.id}>
                {t.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="flex items-end gap-2">
          <Button type="submit">Buscar</Button>
          {hasFilters ? (
            <Button asChild variant="outline">
              <Link href="/candidatos/buscar">Limpiar</Link>
            </Button>
          ) : null}
        </div>
      </form>
      {rows.length === 0 ? (
        <EmptyState title="No se encontraron candidatos" />
      ) : (
        <div className="overflow-x-auto rounded-md border bg-card shadow-xs">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead className="hidden md:table-cell">Ubicación</TableHead>
                <TableHead className="hidden lg:table-cell">Fuente</TableHead>
                <TableHead className="hidden md:table-cell">Etiquetas</TableHead>
                <TableHead className="hidden lg:table-cell">Consentimiento</TableHead>
                <TableHead className="text-right">Postulaciones</TableHead>
                <TableHead className="hidden md:table-cell">Registro</TableHead>
                <TableHead className="text-right">
                  <span className="sr-only">Acciones</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <Link href={`/candidatos/${c.id}`} className="font-medium hover:underline">
                      {c.full_name}
                    </Link>
                    <span className="block text-xs text-muted-foreground md:hidden">{c.location ?? ""}</span>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{c.location ?? "—"}</TableCell>
                  <TableCell className="hidden lg:table-cell">{CANDIDATE_SOURCE_LABELS[c.source]}</TableCell>
                  <TableCell className="hidden md:table-cell">
                    {c.tags.length === 0 ? (
                      "—"
                    ) : (
                      <div className="flex flex-wrap items-center gap-1">
                        {c.tags.slice(0, MAX_TAGS_SHOWN).map((t) => (
                          <TalentTagBadge key={t.id} tag={t} />
                        ))}
                        {c.tags.length > MAX_TAGS_SHOWN ? (
                          <span className="text-xs text-muted-foreground">+{c.tags.length - MAX_TAGS_SHOWN}</span>
                        ) : null}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    <TalentConsentBadge state={c.consent} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{c.applications[0]?.count ?? 0}</TableCell>
                  <TableCell className="hidden md:table-cell">{formatDate(c.created_at)}</TableCell>
                  <TableCell className="text-right">
                    <ReactivateCandidateDialog candidateId={c.id} vacancies={vacancies} variant="outline" size="sm" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <Pagination page={filters.page} pageSize={TALENT_PAGE_SIZE} total={total} hrefForPage={hrefForPage} />
    </>
  );
}

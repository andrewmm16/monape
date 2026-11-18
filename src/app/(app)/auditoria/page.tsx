import type { Metadata } from "next";
import Link from "next/link";
import { AccessDenied } from "@/components/common/access-denied";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { Pagination } from "@/components/common/pagination";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can } from "@/lib/auth/permissions";
import { requirePageUser } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AUDIT_GROUPS, AUDIT_GROUP_KEYS, describeAuditEntry } from "@/modules/audit/labels";
import { AUDIT_PAGE_SIZE, listAuditLog } from "@/modules/audit/queries";
import { auditParamsSchema } from "@/modules/audit/schemas";
import { listActiveProfiles } from "@/modules/users/queries";

export const metadata: Metadata = { title: "Auditoría" };

export default async function AuditPage({ searchParams }: PageProps<"/auditoria">) {
  const user = await requirePageUser();
  if (!can(user.role, "audit:read")) return <AccessDenied message="Solo la administración consulta la auditoría." />;
  const params = auditParamsSchema.parse(await searchParams);
  const supabase = await createSupabaseServerClient();
  const [{ rows, total, page, context }, profiles] = await Promise.all([listAuditLog(supabase, params), listActiveProfiles(supabase)]);

  const hasFilters = Boolean(params.actor || params.group || params.from || params.to);
  const hrefForPage = (target: number) => {
    const search = new URLSearchParams({ page: String(target) });
    if (params.actor) search.set("actor", params.actor);
    if (params.group) search.set("group", params.group);
    if (params.from) search.set("from", params.from);
    if (params.to) search.set("to", params.to);
    return `/auditoria?${search.toString()}`;
  };

  return (
    <>
      <PageHeader
        title="Auditoría"
        description="Registro de lo que se hace en la plataforma, de lo más reciente a lo más antiguo. No se puede modificar. Cada línea indica quién lo hizo, sobre qué vacante, portal, usuario o candidato, y qué cambió; no muestra el contenido de los CV."
      />
      <form method="get" className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-end" aria-label="Filtros de auditoría">
        <NativeSelect name="actor" defaultValue={params.actor} aria-label="Persona" className="md:w-56">
          <NativeSelectOption value="">Todas las personas</NativeSelectOption>
          <NativeSelectOption value="sistema">Robot / sistema</NativeSelectOption>
          {profiles.map((profile) => (
            <NativeSelectOption key={profile.id} value={profile.id}>
              {profile.full_name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect name="group" defaultValue={params.group} aria-label="Tipo" className="md:w-60">
          <NativeSelectOption value="">Todos los tipos</NativeSelectOption>
          {AUDIT_GROUP_KEYS.map((key) => (
            <NativeSelectOption key={key} value={key}>
              {AUDIT_GROUPS[key].label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Desde
          <Input type="date" name="from" defaultValue={params.from} className="md:w-40" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Hasta
          <Input type="date" name="to" defaultValue={params.to} className="md:w-40" />
        </label>
        <Button type="submit" variant="outline">
          Aplicar
        </Button>
        {hasFilters ? (
          <Button asChild variant="ghost">
            <Link href="/auditoria">Limpiar</Link>
          </Button>
        ) : null}
      </form>

      {rows.length === 0 ? (
        <EmptyState
          title="No hay registros"
          description={hasFilters ? "Ningún registro coincide con los filtros." : "Todavía no se ha registrado ninguna acción."}
        />
      ) : (
        <div className="overflow-hidden rounded-md border bg-card shadow-xs">
          <Table stacked>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Quién</TableHead>
                <TableHead>Qué hizo</TableHead>
                <TableHead className="text-right">Ver</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const { text, href, details } = describeAuditEntry(row, context);
                return (
                  <TableRow key={row.id} className="align-top">
                    <TableCell data-label="Fecha" className="whitespace-nowrap">{formatDateTime(row.created_at)}</TableCell>
                    <TableCell data-label="Quién" className="whitespace-normal">
                      {row.actor_name}
                      {row.actor_detail ? <div className="text-xs text-muted-foreground">{row.actor_detail}</div> : null}
                    </TableCell>
                    <TableCell data-label="Qué hizo" className="whitespace-normal">
                      <div>{text}</div>
                      {details.length > 0 ? (
                        <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                          {details.map((line) => (
                            <li key={line}>{line}</li>
                          ))}
                        </ul>
                      ) : null}
                      {row.ordered_by_name ? (
                        <div className="text-xs text-muted-foreground">Por orden de {row.ordered_by_name}</div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right">
                      {href ? (
                        <Link href={href} className="text-sm hover:underline">
                          Abrir
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      <Pagination page={page} pageSize={AUDIT_PAGE_SIZE} total={total} hrefForPage={hrefForPage} />
    </>
  );
}

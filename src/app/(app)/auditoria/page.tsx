import type { Metadata } from "next";
import Link from "next/link";
import { AccessDenied } from "@/components/common/access-denied";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { Pagination } from "@/components/common/pagination";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
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
        description="Registro de lo que hacen las personas en la plataforma, de lo más reciente a lo más antiguo. No se puede modificar. Por defecto no incluye lo que hacen el robot y el sistema: elija «Todo» en el primer filtro para verlo. No muestra el contenido de los CV."
      />
      <form method="get" className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-end" aria-label="Filtros de auditoría">
        <NativeSelect name="actor" defaultValue={params.actor} aria-label="Quién" className="md:w-64">
          <NativeSelectOption value="">Solo personas</NativeSelectOption>
          <NativeSelectOption value="todos">Todo, incluido robot y sistema</NativeSelectOption>
          <NativeSelectOption value="sistema">Solo robot / sistema</NativeSelectOption>
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
          description={hasFilters ? "Ningún registro coincide con los filtros." : "Todavía no se ha registrado ninguna acción de personas."}
        />
      ) : (
        <ul className="divide-y overflow-hidden rounded-md border bg-card shadow-xs">
          {rows.map((row) => {
            const { text, href, details } = describeAuditEntry(row, context);
            return (
              <li key={row.id} className="space-y-1 px-3 py-2.5 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 break-words">{text}</p>
                  {href ? (
                    <Link href={href} className="shrink-0 text-sm text-primary hover:underline">
                      Abrir ›
                    </Link>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(row.created_at)} · {row.actor_name}
                  {row.ordered_by_name ? ` · por orden de ${row.ordered_by_name}` : ""}
                </p>
                {details.length > 0 ? (
                  <details className="text-xs text-muted-foreground">
                    <summary className="cursor-pointer select-none py-1 hover:text-foreground">Ver detalle técnico</summary>
                    <ul className="mt-1 space-y-0.5 break-words">
                      {row.actor_detail ? <li>{row.actor_detail}</li> : null}
                      {details.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <Pagination page={page} pageSize={AUDIT_PAGE_SIZE} total={total} hrefForPage={hrefForPage} />
    </>
  );
}

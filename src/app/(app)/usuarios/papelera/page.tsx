import type { Metadata } from "next";
import Link from "next/link";
import { AccessDenied } from "@/components/common/access-denied";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TrashedUserActions } from "@/components/users/user-row-actions";
import { can, ROLE_LABELS } from "@/lib/auth/permissions";
import { requirePageUser } from "@/lib/auth/session";
import { formatDate } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listTrashedProfiles } from "@/modules/users/queries";

export const metadata: Metadata = { title: "Papelera de usuarios" };

export default async function TrashedUsersPage() {
  const user = await requirePageUser();
  if (!can(user.role, "users:manage")) return <AccessDenied message="Solo la administración gestiona usuarios." />;
  const supabase = await createSupabaseServerClient();
  const profiles = await listTrashedProfiles(supabase);

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/usuarios" className="hover:underline">
            Usuarios
          </Link>
        }
        title="Papelera"
        description="Usuarios desactivados: no tienen acceso. Reactívelos o elimínelos definitivamente."
      />
      {profiles.length === 0 ? (
        <EmptyState title="La papelera está vacía" description="Los usuarios que desactive aparecerán aquí." />
      ) : (
        <div className="overflow-hidden rounded-md border bg-card shadow-xs">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead className="hidden md:table-cell">Correo</TableHead>
                <TableHead>Rol</TableHead>
                <TableHead className="hidden lg:table-cell">Desactivado</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {profiles.map((profile) => (
                <TableRow key={profile.id}>
                  <TableCell className="font-medium">{profile.full_name}</TableCell>
                  <TableCell className="hidden md:table-cell">{profile.email}</TableCell>
                  <TableCell>{ROLE_LABELS[profile.role]}</TableCell>
                  <TableCell className="hidden lg:table-cell">{formatDate(profile.deactivated_at)}</TableCell>
                  <TableCell className="text-right">
                    <TrashedUserActions userId={profile.id} />
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

import type { Metadata } from "next";
import Link from "next/link";
import { Trash2Icon } from "lucide-react";
import { AccessDenied } from "@/components/common/access-denied";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { InviteUserForm } from "@/components/users/invite-user-form";
import { UserRowActions } from "@/components/users/user-row-actions";
import { can, ROLE_LABELS } from "@/lib/auth/permissions";
import { requirePageUser } from "@/lib/auth/session";
import { formatDate } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { countTrashedProfiles, listProfiles } from "@/modules/users/queries";

export const metadata: Metadata = { title: "Usuarios" };

export default async function UsersPage() {
  const user = await requirePageUser();
  if (!can(user.role, "users:manage")) return <AccessDenied message="Solo la administración gestiona usuarios." />;
  const supabase = await createSupabaseServerClient();
  const [profiles, trashed] = await Promise.all([listProfiles(supabase), countTrashedProfiles(supabase)]);

  return (
    <>
      <PageHeader
        title="Usuarios"
        description="No existe registro público: solo un administrador puede dar acceso a la plataforma."
        actions={
          <Button asChild variant="outline">
            <Link href="/usuarios/papelera">
              <Trash2Icon /> Papelera ({trashed})
            </Link>
          </Button>
        }
      />
      <Card>
        <CardHeader>
          <CardTitle>Invitar usuario</CardTitle>
          <CardDescription>
            La persona recibirá un correo de Supabase Auth con un enlace temporal para definir su contraseña.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <InviteUserForm />
        </CardContent>
      </Card>
      <div className="overflow-hidden rounded-md border bg-card shadow-xs">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead className="hidden md:table-cell">Correo</TableHead>
              <TableHead>Rol</TableHead>
              <TableHead className="hidden lg:table-cell">Alta</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {profiles.map((profile) => (
              <TableRow key={profile.id}>
                <TableCell className="font-medium">{profile.full_name}</TableCell>
                <TableCell className="hidden md:table-cell">{profile.email}</TableCell>
                <TableCell>{ROLE_LABELS[profile.role]}</TableCell>
                <TableCell className="hidden lg:table-cell">{formatDate(profile.created_at)}</TableCell>
                <TableCell className="text-right">
                  {profile.id === user.id ? (
                    <span className="text-xs text-muted-foreground">Su cuenta</span>
                  ) : (
                    <UserRowActions userId={profile.id} role={profile.role} />
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

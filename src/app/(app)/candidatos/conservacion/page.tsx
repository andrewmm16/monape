import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import { AnonymizeCandidateButton } from "@/components/candidates/anonymize-candidate-button";
import { AccessDenied } from "@/components/common/access-denied";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { TalentConsentBadge } from "@/components/talent/talent-consent-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can } from "@/lib/auth/permissions";
import { requirePageUser } from "@/lib/auth/session";
import { formatDate } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DEFAULT_RETENTION_MONTHS, listInactiveCandidates, RETENTION_MONTHS } from "@/modules/candidates/queries";

export const metadata: Metadata = { title: "Plazo de conservación" };

const paramsSchema = z.object({
  meses: z.coerce
    .number()
    .int()
    .refine((value) => (RETENTION_MONTHS as readonly number[]).includes(value))
    .catch(DEFAULT_RETENTION_MONTHS),
});

/** Candidatos sin actividad para anonimizar a mano (solo administración). */
export default async function RetentionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePageUser();
  if (!can(user.role, "candidates:anonymize")) {
    return <AccessDenied message="Solo la administración revisa el plazo de conservación." />;
  }
  const { meses } = paramsSchema.parse(await searchParams);
  const rows = await listInactiveCandidates(await createSupabaseServerClient(), meses);

  return (
    <>
      <PageHeader
        title="Plazo de conservación"
        description="Candidatos sin actividad y sin postulaciones en curso. Anonimizar quita sus datos personales y su CV; las postulaciones se conservan para los reportes."
      />
      <Alert>
        <AlertDescription>
          Nada se borra solo: revise cada caso. Quien dio su consentimiento para la base de talentos puede seguir siendo
          útil; quien lo revocó o no tiene constancia es el primero a considerar. Anonimizar no se puede deshacer.
        </AlertDescription>
      </Alert>
      <nav className="flex flex-wrap items-center gap-2" aria-label="Meses sin actividad">
        <span className="text-sm text-muted-foreground">Sin actividad hace más de:</span>
        {RETENTION_MONTHS.map((months) => (
          <Button key={months} asChild size="sm" variant={months === meses ? "default" : "outline"}>
            <Link href={`/candidatos/conservacion?meses=${months}`} aria-current={months === meses ? "page" : undefined}>
              {months} meses
            </Link>
          </Button>
        ))}
      </nav>
      {rows.length === 0 ? (
        <EmptyState title="No hay candidatos con ese tiempo sin actividad" />
      ) : (
        <div className="overflow-hidden rounded-md border bg-card shadow-xs">
          <Table aria-label="Candidatos sin actividad">
            <TableHeader>
              <TableRow>
                <TableHead>Candidato</TableHead>
                <TableHead>Última actividad</TableHead>
                <TableHead className="hidden sm:table-cell">Postulaciones</TableHead>
                <TableHead className="hidden md:table-cell">Base de talentos</TableHead>
                <TableHead className="text-right">Acción</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">
                    <Link href={`/candidatos/${row.id}`} className="hover:underline">
                      {row.fullName}
                    </Link>
                  </TableCell>
                  <TableCell>{formatDate(row.lastActivity)}</TableCell>
                  <TableCell className="hidden sm:table-cell">{row.applications}</TableCell>
                  <TableCell className="hidden md:table-cell">
                    <TalentConsentBadge state={row.poolConsent} />
                  </TableCell>
                  <TableCell className="text-right">
                    <AnonymizeCandidateButton candidateId={row.id} name={row.fullName} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {rows.length === 200 ? (
        <p className="text-xs text-muted-foreground">Se muestran los 200 más antiguos; al anonimizarlos aparecen los siguientes.</p>
      ) : null}
    </>
  );
}

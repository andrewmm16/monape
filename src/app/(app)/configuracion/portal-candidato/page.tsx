import type { Metadata } from "next";
import { CandidatePortalToggle } from "@/components/candidate-portal/portal-toggle";
import { AccessDenied } from "@/components/common/access-denied";
import { PageHeader } from "@/components/common/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { can } from "@/lib/auth/permissions";
import { requirePageUser } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isCandidatePortalEnabled } from "@/modules/candidate-portal/queries";

export const metadata: Metadata = { title: "Portal del candidato" };

export default async function CandidatePortalSettingsPage() {
  const user = await requirePageUser();
  if (!can(user.role, "candidate_portal:manage")) {
    return <AccessDenied message="Solo la administración configura el portal del candidato." />;
  }
  const enabled = await isCandidatePortalEnabled(await createSupabaseServerClient());

  return (
    <>
      <PageHeader
        eyebrow="Configuración"
        title="Portal del candidato"
        description="Cada persona puede consultar en qué etapa va su postulación con un enlace privado que genera RRHH desde su ficha."
      />
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>{enabled ? "Encendido" : "Apagado"}</CardTitle>
          <CardDescription>
            Muestra solo el puesto, la etapa (recibida, en revisión, entrevista, evaluación final, seleccionado o proceso
            terminado), las fechas y la próxima entrevista. Nunca muestra notas internas, la evaluación ni el motivo de
            una decisión. Apagado, los enlaces ya enviados no muestran nada.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CandidatePortalToggle enabled={enabled} />
        </CardContent>
      </Card>
    </>
  );
}

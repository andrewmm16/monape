"use client";

import { useState } from "react";
import Link from "next/link";
import { ActionButton } from "@/components/common/action-button";
import { ApplicationStatusBadge, CompatibilityBadge } from "@/components/common/badges";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { formatDate } from "@/lib/format";
import { isInProcess } from "@/modules/applications/schemas";
import { addApplication } from "@/modules/candidates/actions";
import type { Enums } from "@/types/database";

type Application = {
  id: string | null;
  vacancy_id: string | null;
  vacancy_title: string | null;
  vacancy_status: Enums<"vacancy_status"> | null;
  status: Enums<"application_status"> | null;
  applied_at: string | null;
  level: Enums<"compatibility_level"> | null;
  score: number | null;
  evaluation_outdated: boolean | null;
};

export function ApplicationsSection({
  candidateId,
  applications,
  openVacancies,
  canManage,
}: {
  candidateId: string;
  applications: Application[];
  openVacancies: { id: string; title: string }[];
  canManage: boolean;
}) {
  const [vacancyId, setVacancyId] = useState("");
  const appliedIds = new Set(applications.map((a) => a.vacancy_id));
  const available = openVacancies.filter((v) => !appliedIds.has(v.id));
  const inProcess = applications.find(isInProcess);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Postulaciones</CardTitle>
        <CardDescription>
          El estado del proceso lo decide RRHH y es independiente de la compatibilidad orientativa.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {applications.length === 0 ? (
          <p className="text-sm text-muted-foreground">El candidato aún no postula a ninguna vacante.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {applications.map((application) => (
              <li key={application.id} className="flex flex-col gap-2 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <Link href={`/postulaciones/${application.id}`} className="font-medium hover:underline">
                    {application.vacancy_title}
                  </Link>
                  <div className="text-xs text-muted-foreground">Postulación: {formatDate(application.applied_at)}</div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <CompatibilityBadge level={application.level} />
                  {application.status ? <ApplicationStatusBadge status={application.status} /> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
        {canManage && inProcess ? (
          <p className="text-sm text-muted-foreground">
            Está en proceso en «{inProcess.vacancy_title}». Podrá asociarlo a otra vacante cuando esa postulación
            termine (seleccionado, no seleccionado, en reserva o retirado) o la vacante se archive.
          </p>
        ) : canManage && available.length > 0 ? (
          <div className="flex flex-col gap-2 sm:flex-row">
            <NativeSelect
              aria-label="Vacante"
              className="w-full sm:w-80"
              value={vacancyId}
              onChange={(event) => setVacancyId(event.target.value)}
            >
              <NativeSelectOption value="">Asociar a una vacante…</NativeSelectOption>
              {available.map((vacancy) => (
                <NativeSelectOption key={vacancy.id} value={vacancy.id}>
                  {vacancy.title}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <ActionButton
              variant="outline"
              disabled={!vacancyId}
              action={async () => {
                const result = await addApplication(candidateId, vacancyId);
                if (result.ok) setVacancyId("");
                return result;
              }}
            >
              Registrar postulación
            </ActionButton>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

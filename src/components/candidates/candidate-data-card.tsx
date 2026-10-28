"use client";

import { useState } from "react";
import { BadgeCheckIcon, PencilIcon } from "lucide-react";
import { ActionButton } from "@/components/common/action-button";
import { OriginBadge } from "@/components/common/badges";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CANDIDATE_SOURCE_LABELS } from "@/lib/labels";
import { verifyCandidateField } from "@/modules/candidates/actions";
import { TRACKED_FIELD_LABELS, TRACKED_FIELDS, type TrackedField } from "@/modules/candidates/schemas";
import type { Enums, Tables } from "@/types/database";
import { CandidateForm } from "./candidate-form";

type Origins = Partial<Record<TrackedField, Enums<"data_origin">>>;

export function CandidateDataCard({ candidate, canManage }: { candidate: Tables<"candidates">; canManage: boolean }) {
  const [editing, setEditing] = useState(false);
  const origins = (candidate.field_origins ?? {}) as Origins;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Datos del candidato</CardTitle>
        <CardDescription>
          Cada dato indica si fue declarado, extraído automáticamente del CV o verificado por RRHH.
        </CardDescription>
        {canManage && !editing ? (
          <CardAction>
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              <PencilIcon /> Editar
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent>
        {editing ? (
          <CandidateForm
            candidateId={candidate.id}
            onDone={() => setEditing(false)}
            defaultValues={{
              fullName: candidate.full_name,
              email: candidate.email ?? "",
              phone: candidate.phone ?? "",
              location: candidate.location ?? "",
              linkedinUrl: candidate.linkedin_url ?? "",
              source: candidate.source,
              sourceDetail: candidate.source_detail ?? "",
              vacancyId: "",
              confirmDuplicate: false,
            }}
          />
        ) : (
          <dl className="divide-y">
            {TRACKED_FIELDS.map((field) => {
              const value = candidate[field];
              const origin = origins[field];
              return (
                <div key={field} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <dt className="text-xs text-muted-foreground">{TRACKED_FIELD_LABELS[field]}</dt>
                    <dd className="text-sm break-words">{value || "—"}</dd>
                  </div>
                  {value ? (
                    <div className="flex items-center gap-2">
                      <OriginBadge origin={origin} />
                      {canManage && origin !== "verificado" ? (
                        <ActionButton size="xs" variant="ghost" action={verifyCandidateField.bind(null, candidate.id, field)}>
                          <BadgeCheckIcon /> Marcar verificado
                        </ActionButton>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
            <div className="py-2">
              <dt className="text-xs text-muted-foreground">Fuente</dt>
              <dd className="text-sm">
                {CANDIDATE_SOURCE_LABELS[candidate.source]}
                {candidate.source_detail ? ` · ${candidate.source_detail}` : ""}
              </dd>
            </div>
          </dl>
        )}
      </CardContent>
    </Card>
  );
}

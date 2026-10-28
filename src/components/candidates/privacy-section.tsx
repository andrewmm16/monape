"use client";

import { ActionButton } from "@/components/common/action-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";
import { CONSENT_METHOD_LABELS, CONSENT_PURPOSE_LABELS } from "@/lib/labels";
import { revokeConsent } from "@/modules/privacy/actions";
import type { Enums } from "@/types/database";

type Consent = {
  id: string;
  purpose: Enums<"consent_purpose">;
  granted: boolean;
  method: Enums<"consent_method">;
  created_at: string;
  revoked_at: string | null;
  notice: { version: number } | null;
};

/** Constancias de consentimiento del candidato. La revocación no borra la constancia. */
export function PrivacySection({
  candidateId,
  consents,
  canManage,
}: {
  candidateId: string;
  consents: Consent[];
  canManage: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Privacidad</CardTitle>
        <CardDescription>Constancias del aviso de privacidad aceptado y de los consentimientos por finalidad.</CardDescription>
      </CardHeader>
      <CardContent>
        {consents.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin constancias registradas</p>
        ) : (
          <ul className="divide-y">
            {consents.map((consent) => (
              <li key={consent.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                <div className="space-y-1">
                  <p className="font-medium">
                    {CONSENT_PURPOSE_LABELS[consent.purpose]}{" "}
                    <span className="font-normal text-muted-foreground">
                      · {consent.granted ? "otorgado" : "no otorgado"}
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Aviso versión {consent.notice?.version ?? "—"} · {formatDateTime(consent.created_at)} ·{" "}
                    {CONSENT_METHOD_LABELS[consent.method]}
                  </p>
                  {consent.revoked_at ? (
                    <Badge variant="outline">Revocado el {formatDateTime(consent.revoked_at)}</Badge>
                  ) : null}
                </div>
                {canManage && consent.purpose === "cartera_talento" && consent.granted && !consent.revoked_at ? (
                  <ActionButton
                    size="sm"
                    variant="outline"
                    action={() => revokeConsent(consent.id, candidateId)}
                    confirm={{
                      title: "¿Registrar la revocación de la cartera de talento?",
                      description:
                        "Se deja constancia de que la persona retiró su consentimiento. La constancia original se conserva.",
                      confirmLabel: "Registrar revocación",
                    }}
                  >
                    Registrar revocación
                  </ActionButton>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

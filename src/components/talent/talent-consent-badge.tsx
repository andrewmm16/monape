import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { TalentConsentState } from "@/modules/talent-pool/queries";

const CONSENT_BADGES: Record<TalentConsentState, { label: string; tone: string }> = {
  consiente: { label: "Consiente", tone: "bg-success text-success-foreground" },
  revocado: { label: "Revocado", tone: "bg-warning text-warning-foreground" },
  sin: { label: "Sin constancia", tone: "bg-muted text-muted-foreground" },
};

/** Estado del consentimiento de tratamiento de datos del candidato. */
export function TalentConsentBadge({ state }: { state: TalentConsentState }) {
  const { label, tone } = CONSENT_BADGES[state];
  return (
    <Badge variant="outline" className={cn("border-transparent", tone)}>
      {label}
    </Badge>
  );
}

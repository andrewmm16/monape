import { DUPLICATE_REASON_LABELS } from "@/lib/labels";

/**
 * Aviso de posible duplicado de una postulación recibida por integración:
 * mismo correo, mismo teléfono o mismo CV que otro candidato. Es solo un aviso:
 * nunca se fusionan fichas automáticamente.
 */
export function PossibleDuplicate({ reasons }: { reasons: string[] | null }) {
  if (!reasons?.length) return null;
  return (
    <div className="mt-1 text-xs text-amber-700 dark:text-amber-300" data-testid="possible-duplicate">
      Posible duplicado: {reasons.map((reason) => DUPLICATE_REASON_LABELS[reason] ?? reason).join(", ")}
    </div>
  );
}

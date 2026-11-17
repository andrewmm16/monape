import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { TalentTag } from "@/modules/talent-pool/queries";

/** Tonos por color de etiqueta; todos salen de los tokens del tema. */
const TAG_TONES: Record<string, string> = {
  slate: "bg-muted text-muted-foreground",
  green: "bg-success text-success-foreground",
  blue: "bg-info text-info-foreground",
  amber: "bg-warning text-warning-foreground",
  red: "bg-danger text-danger-foreground",
  orange: "bg-attention text-attention-foreground",
};

const NEUTRAL_TONE = "bg-muted text-muted-foreground";

type Props = { tag: TalentTag } | { name: string; color: string | null };

/** Chip pequeño de una etiqueta del pool de talento, coloreado según su color. */
export function TalentTagBadge(props: Props) {
  const { name, color } = "tag" in props ? props.tag : props;
  const tone = (color && TAG_TONES[color]) || NEUTRAL_TONE;
  return (
    <Badge variant="outline" className={cn("border-transparent", tone)}>
      {name}
    </Badge>
  );
}

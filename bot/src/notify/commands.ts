/** Lista cerrada de órdenes que el robot acepta por mensajería. Nunca se ejecuta texto libre. */
const COMMANDS = ["estado", "pausar", "reanudar", "ahora", "ayuda"] as const;
export type Command = (typeof COMMANDS)[number];

/** Minúsculas, sin tildes y sin signos ni espacios alrededor. */
function normalize(text: string | null | undefined): string {
  return (text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/^[\s/!.]+|[\s.!]+$/g, "");
}

/** El mensaje debe ser exactamente una orden (sin importar mayúsculas, tildes ni signos alrededor). */
export function parseCommand(text: string | null | undefined): Command | null {
  const word = normalize(text);
  return (COMMANDS as readonly string[]).includes(word) ? (word as Command) : null;
}

/** Todo lo que el robot entiende por mensajería: las órdenes, ver incidentes y decidir uno («sí 3», «no 3»). */
export type Incoming =
  | { kind: "command"; command: Command }
  | { kind: "incidents" }
  | { kind: "decision"; decision: "aprobado" | "rechazado"; id: number };

export function parseIncoming(text: string | null | undefined): Incoming | null {
  const clean = normalize(text);
  if (clean === "incidentes") return { kind: "incidents" };
  const decision = /^(si|no)\s+#?(\d{1,6})$/.exec(clean);
  if (decision) return { kind: "decision", decision: decision[1] === "si" ? "aprobado" : "rechazado", id: Number(decision[2]) };
  const command = parseCommand(text);
  return command ? { kind: "command", command } : null;
}

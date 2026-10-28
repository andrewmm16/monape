/**
 * Texto del aviso como párrafos de texto plano. Nunca interpreta HTML ni
 * Markdown: React escapa el contenido y los saltos de línea simples se respetan
 * con CSS. Se usa en la vista previa y en la página pública.
 */
export function NoticeText({ text, className }: { text: string; className?: string }) {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  return (
    <div className={className ?? "space-y-3 text-sm leading-relaxed"} data-testid="notice-text">
      {paragraphs.map((paragraph, index) => (
        <p key={index} className="break-words whitespace-pre-line">
          {paragraph}
        </p>
      ))}
    </div>
  );
}

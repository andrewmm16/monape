/**
 * El texto de la vacante nunca se inserta como HTML: se escapa por completo y
 * solo se generan las etiquetas de párrafo y lista que decide este módulo.
 */

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]!);
}

const BULLET = /^[-*•–]\s+(.*)$/;
const NUMBERED = /^\d{1,3}[.)]\s+(.*)$/;

/** Convierte texto plano en párrafos (`<p>`) y listas (`<ul>`/`<ol>`) seguros. */
export function textToHtml(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let paragraph: string[] = [];
  let list: { tag: "ul" | "ol"; items: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length) out.push(`<p>${paragraph.map(escapeHtml).join("<br>")}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (list) {
      out.push(`<${list.tag}>${list.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</${list.tag}>`);
    }
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }
    const bullet = BULLET.exec(line);
    const match = bullet ?? NUMBERED.exec(line);
    if (match) {
      flushParagraph();
      const tag = bullet ? "ul" : "ol";
      if (list && list.tag !== tag) flushList();
      list ??= { tag, items: [] };
      list.items.push(match[1]!.trim());
    } else {
      flushList();
      paragraph.push(line);
    }
  }
  flushParagraph();
  flushList();
  return out.join("");
}

/** Descripción completa para Google y el feed: descripción y responsabilidades. */
export function buildDescriptionHtml(vacancy: { description: string; responsibilities: string }): string {
  const parts = [textToHtml(vacancy.description)];
  if (vacancy.responsibilities.trim()) {
    parts.push("<p><strong>Responsabilidades</strong></p>", textToHtml(vacancy.responsibilities));
  }
  return parts.join("");
}

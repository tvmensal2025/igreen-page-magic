import type { ReactNode } from "react";

/**
 * Renderiza formatação estilo WhatsApp:
 *   *negrito*  _itálico_  ~riscado~  ```mono```  `mono`
 * + links http(s).
 * Não corta o texto: tudo que não casa vira texto puro.
 */

type Token =
  | { type: "text"; value: string }
  | { type: "bold"; value: string }
  | { type: "italic"; value: string }
  | { type: "strike"; value: string }
  | { type: "mono"; value: string }
  | { type: "link"; value: string };

const URL_RE = /https?:\/\/[^\s<>"']+/g;

/** Remove marcadores WhatsApp para preview curto (sidebar). */
export function stripWhatsAppMarkup(text: string): string {
  if (!text) return "";
  return text
    .replace(/```([\s\S]*?)```/g, "$1")
    .replace(/`([^`\n]+?)`/g, "$1")
    .replace(/\*([^*\n]+?)\*/g, "$1")
    .replace(/_([^_\n]+?)_/g, "$1")
    .replace(/~([^~\n]+?)~/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeInline(input: string): Token[] {
  if (!input) return [];

  // 1) links primeiro (não quebrar URLs com _ ou *)
  const withLinks: Token[] = [];
  let last = 0;
  const urlRe = new RegExp(URL_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = urlRe.exec(input)) !== null) {
    if (m.index > last) withLinks.push({ type: "text", value: input.slice(last, m.index) });
    withLinks.push({ type: "link", value: m[0] });
    last = m.index + m[0].length;
  }
  if (last < input.length) withLinks.push({ type: "text", value: input.slice(last) });

  // 2) formatação só em pedaços de texto
  const out: Token[] = [];
  for (const tok of withLinks) {
    if (tok.type !== "text") {
      out.push(tok);
      continue;
    }
    out.push(...tokenizeMarkup(tok.value));
  }
  return out;
}

function tokenizeMarkup(input: string): Token[] {
  const tokens: Token[] = [];
  // Ordem: ``` → ` → * → _ → ~
  const re =
    /```([\s\S]*?)```|`([^`\n]+?)`|\*([^*\n]+?)\*|_([^_\n]+?)_|~([^~\n]+?)~/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    if (m.index > last) tokens.push({ type: "text", value: input.slice(last, m.index) });
    if (m[1] !== undefined) tokens.push({ type: "mono", value: m[1] });
    else if (m[2] !== undefined) tokens.push({ type: "mono", value: m[2] });
    else if (m[3] !== undefined) tokens.push({ type: "bold", value: m[3] });
    else if (m[4] !== undefined) tokens.push({ type: "italic", value: m[4] });
    else if (m[5] !== undefined) tokens.push({ type: "strike", value: m[5] });
    last = m.index + m[0].length;
  }
  if (last < input.length) tokens.push({ type: "text", value: input.slice(last) });
  return tokens;
}

function renderToken(tok: Token, key: number): ReactNode {
  switch (tok.type) {
    case "bold":
      return <strong key={key} className="font-semibold">{tok.value}</strong>;
    case "italic":
      return <em key={key}>{tok.value}</em>;
    case "strike":
      return <s key={key}>{tok.value}</s>;
    case "mono":
      return (
        <code key={key} className="rounded bg-muted/80 px-1 py-0.5 text-[12px] font-mono">
          {tok.value}
        </code>
      );
    case "link":
      return (
        <a
          key={key}
          href={tok.value}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline hover:opacity-80 break-all"
        >
          {tok.value}
        </a>
      );
    default:
      return <span key={key}>{tok.value}</span>;
  }
}

/** Componente de texto formatado WhatsApp (negrito/itálico/links). */
export function WhatsAppFormattedText({
  text,
  className = "text-sm whitespace-pre-wrap break-words",
}: {
  text: string;
  className?: string;
}) {
  const tokens = tokenizeInline(text || "");
  return (
    <span
      className={`block ${className}`}
      style={{
        // Figtree/Outfit no Linux não cobrem emoji colorido — fallback explícito.
        fontFamily:
          'Figtree, system-ui, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Twemoji Mozilla", sans-serif',
      }}
    >
      {tokens.map((t, i) => renderToken(t, i))}
    </span>
  );
}

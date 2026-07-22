import { useEffect, useMemo, useRef } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MessageTemplate } from "@/types/whatsapp";

interface QuickReplyMenuProps {
  templates: MessageTemplate[];
  search: string;
  onSelect: (template: MessageTemplate) => void;
  onClose: () => void;
  onExactShortcut?: (template: MessageTemplate | null) => void;
}

export function QuickReplyMenu({ templates, search, onSelect, onClose, onExactShortcut }: QuickReplyMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const q = search.toLowerCase().trim();

  // Sem busca: mostra só os marcados como "resposta rápida".
  // Com busca: olha em todos (favoritos ou não), para o consultor achar o que precisa.
  const visible = useMemo(() => {
    return q.length === 0
      ? templates.filter((t) => t.is_quick_reply !== false)
      : templates;
  }, [templates, q]);

  // Match exato por atalho (digitou "oi" e existe template com shortcut="/oi")
  const exactShortcut = q.length >= 2
    ? visible.find((t) => (t.shortcut || "").toLowerCase() === `/${q}`)
    : null;

  const filtered = visible
    .filter((t) =>
      q.length === 0 ||
      t.name.toLowerCase().includes(q) ||
      t.content.toLowerCase().includes(q) ||
      (t.shortcut || "").toLowerCase().includes(`/${q}`)
    )
    .sort((a, b) => {
      const aS = (a.shortcut || "").toLowerCase().startsWith(`/${q}`) ? 0 : 1;
      const bS = (b.shortcut || "").toLowerCase().startsWith(`/${q}`) ? 0 : 1;
      return aS - bS;
    });

  useEffect(() => { onExactShortcut?.(exactShortcut || null); }, [exactShortcut, onExactShortcut]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  const totalFavorites = templates.filter((t) => t.is_quick_reply !== false).length;

  return (
    <div
      ref={ref}
      className="absolute bottom-full left-0 right-0 mb-1 bg-popover border border-border rounded-lg shadow-lg max-h-64 overflow-hidden z-[200] flex flex-col"
    >
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-border/60 bg-secondary/30 shrink-0">
        <p className="text-[10px] text-muted-foreground">
          Respostas rápidas
          <span className="ml-1 text-muted-foreground/60">
            · {filtered.length}{q.length === 0 ? ` de ${totalFavorites} favoritas` : ""}
          </span>
          {exactShortcut && <span className="ml-1 text-primary">· Enter envia "{exactShortcut.name}"</span>}
        </p>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 text-muted-foreground hover:text-foreground"
          onClick={onClose}
          title="Fechar (Esc)"
        >
          <X className="h-3 w-3" />
        </Button>
      </div>

      <div className="p-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="text-[11px] text-muted-foreground px-3 py-4 text-center">
            {q.length === 0
              ? "Nenhum template marcado como resposta rápida. Marque a estrela nos templates para vê-los aqui."
              : "Nenhum template encontrado."}
          </p>
        ) : filtered.map((t) => (
          <button
            key={t.id}
            onClick={() => onSelect(t)}
            className="w-full text-left px-3 py-2 hover:bg-secondary rounded transition-colors flex flex-col gap-0.5"
          >
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-foreground">{t.name}</span>
              {t.shortcut && (
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-primary/20 text-primary">{t.shortcut}</span>
              )}
              {t.media_type && t.media_type !== "text" && (
                <span className="text-[9px] uppercase text-muted-foreground">{t.media_type}</span>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground truncate">{t.content || <em>(somente mídia)</em>}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

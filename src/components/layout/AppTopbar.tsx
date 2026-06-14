import { PanelLeftClose, PanelLeftOpen, Eye, EyeOff, Sparkles } from "lucide-react";
import type { ReactNode } from "react";

interface AppTopbarProps {
  title: string;
  subtitle?: string;
  onToggleSidebar?: () => void;
  sidebarCollapsed?: boolean;
  onOpenSidebar?: () => void;
  privacyMode?: boolean;
  onTogglePrivacy?: () => void;
  onOpenAi?: () => void;
  notificationSlot?: ReactNode;
  extra?: ReactNode;
}

export function AppTopbar({
  title,
  subtitle,
  onToggleSidebar,
  sidebarCollapsed,
  onOpenSidebar,
  privacyMode,
  onTogglePrivacy,
  onOpenAi,
  notificationSlot,
  extra,
}: AppTopbarProps) {
  const handleToggle = () => {
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches) {
      onOpenSidebar?.();
    } else {
      onToggleSidebar?.();
    }
  };

  return (
    <header className="pe-topbar sticky top-0 z-20 shrink-0">
      <div className="px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={handleToggle}
            className="p-2 rounded-lg hover:bg-[var(--pe-surface-muted)] transition-colors"
            aria-label={sidebarCollapsed ? "Expandir menu" : "Recolher menu"}
            title={sidebarCollapsed ? "Expandir menu" : "Recolher menu"}
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen className="w-5 h-5" style={{ color: "var(--pe-emerald)" }} />
            ) : (
              <PanelLeftClose className="w-5 h-5" style={{ color: "var(--pe-emerald)" }} />
            )}
          </button>
          <div className="min-w-0">
            <h1 className="pe-heading text-base sm:text-xl font-bold tracking-tight truncate" style={{ color: "var(--pe-emerald-strong)" }}>
              {title}
            </h1>
            {subtitle && (
              <p className="text-[11px] sm:text-xs font-medium truncate" style={{ color: "var(--pe-text-muted)" }}>
                {subtitle}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {onTogglePrivacy && (
            <button
              type="button"
              onClick={onTogglePrivacy}
              className={`p-2 rounded-lg transition-all ${privacyMode ? "bg-[var(--pe-accent-glow)]" : "hover:bg-[var(--pe-surface-muted)]"}`}
              style={{ color: privacyMode ? "var(--pe-emerald)" : "var(--pe-text-muted)" }}
              aria-label={privacyMode ? "Mostrar dados" : "Ocultar dados"}
              title={privacyMode ? "Privacidade ATIVA" : "Ocultar dados sensíveis"}
            >
              {privacyMode ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          )}

          {onOpenAi && (
            <button
              type="button"
              onClick={onOpenAi}
              className="hidden sm:inline-flex p-2 rounded-lg transition-all hover:bg-[var(--pe-surface-muted)]"
              style={{ color: "var(--pe-text-muted)" }}
              aria-label="Assistente IA"
              title="Assistente iGreen IA"
            >
              <Sparkles className="w-4 h-4" />
            </button>
          )}

          {extra}

          {notificationSlot}
        </div>
      </div>
    </header>
  );
}

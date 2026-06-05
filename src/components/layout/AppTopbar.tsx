import { Menu, Eye, EyeOff, Sparkles, Settings } from "lucide-react";
import type { ReactNode } from "react";

interface AppTopbarProps {
  title: string;
  subtitle?: string;
  onOpenSidebar?: () => void;
  privacyMode?: boolean;
  onTogglePrivacy?: () => void;
  onOpenAi?: () => void;
  onOpenSettings?: () => void;
  notificationSlot?: ReactNode;
  extra?: ReactNode;
}

export function AppTopbar({
  title,
  subtitle,
  onOpenSidebar,
  privacyMode,
  onTogglePrivacy,
  onOpenAi,
  onOpenSettings,
  notificationSlot,
  extra,
}: AppTopbarProps) {
  return (
    <header className="pe-topbar sticky top-0 z-20 shrink-0">
      <div className="px-4 sm:px-6 lg:px-10 py-3 sm:py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          {onOpenSidebar && (
            <button
              type="button"
              onClick={onOpenSidebar}
              className="lg:hidden p-2 rounded-xl hover:bg-[var(--pe-surface-muted)] transition-colors"
              aria-label="Abrir menu"
            >
              <Menu className="w-5 h-5" style={{ color: "var(--pe-emerald)" }} />
            </button>
          )}
          <div className="min-w-0">
            <h1 className="pe-heading text-lg sm:text-2xl font-bold tracking-tight truncate" style={{ color: "var(--pe-emerald-strong)" }}>
              {title}
            </h1>
            {subtitle && (
              <p className="text-xs sm:text-sm font-medium truncate" style={{ color: "var(--pe-text-muted)" }}>
                {subtitle}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {/* Status pill — hidden on small */}
          <div className="hidden xl:flex items-center gap-2 px-3 py-1.5 rounded-full" style={{ background: "var(--pe-emerald-50)", border: "1px solid var(--pe-emerald-10)" }}>
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60" style={{ background: "#10b981" }} />
              <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: "#10b981" }} />
            </span>
            <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--pe-emerald)" }}>
              Operacional
            </span>
          </div>

          {onTogglePrivacy && (
            <button
              type="button"
              onClick={onTogglePrivacy}
              className={`p-2 rounded-xl transition-all ${privacyMode ? "bg-[var(--pe-emerald-10)]" : "hover:bg-[var(--pe-surface-muted)]"}`}
              style={{ color: privacyMode ? "var(--pe-emerald)" : "var(--pe-text-muted)" }}
              aria-label={privacyMode ? "Mostrar dados" : "Ocultar dados"}
              title={privacyMode ? "Privacidade ATIVA" : "Ocultar dados sensíveis"}
            >
              {privacyMode ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            </button>
          )}

          {onOpenAi && (
            <button
              type="button"
              onClick={onOpenAi}
              className="hidden sm:inline-flex p-2 rounded-xl transition-all hover:bg-[var(--pe-surface-muted)]"
              style={{ color: "var(--pe-text-muted)" }}
              aria-label="Assistente IA"
              title="Assistente iGreen IA"
            >
              <Sparkles className="w-5 h-5" />
            </button>
          )}

          {extra}

          {notificationSlot}

          {onOpenSettings && (
            <button
              type="button"
              onClick={onOpenSettings}
              className="p-2 rounded-xl transition-all hover:bg-[var(--pe-surface-muted)]"
              style={{ color: "var(--pe-text-muted)" }}
              aria-label="Configurações"
              title="Configurações"
            >
              <Settings className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

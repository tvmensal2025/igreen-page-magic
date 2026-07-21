import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";

/**
 * Alterna light ↔ dark. Padrão do topo do painel (AppTopbar / Auth / SuperAdmin).
 */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const { resolvedTheme, toggleTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={`relative min-h-11 min-w-11 flex items-center justify-center rounded-lg transition-all hover:bg-[var(--pe-surface-muted,hsl(var(--muted)))] ${className}`}
      style={{ color: "var(--pe-text-muted, hsl(var(--muted-foreground)))" }}
      aria-label={isDark ? "Ativar tema claro" : "Ativar tema escuro"}
      title={isDark ? "Tema escuro · clicar para claro" : "Tema claro · clicar para escuro"}
      aria-pressed={isDark}
    >
      {isDark ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
    </button>
  );
}

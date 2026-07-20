import { Sun } from "lucide-react";

// Plataforma light-only — botão vira indicador estático (mantido para não
// remover do layout). Sem ciclo de tema.
export function ThemeToggle() {
  return (
    <button
      type="button"
      disabled
      className="relative p-2 rounded-xl text-muted-foreground opacity-70 min-h-11 min-w-11 flex items-center justify-center cursor-default"
      aria-label="Tema: claro"
      title="Tema claro (fixo)"
    >
      <Sun className="h-5 w-5" />
    </button>
  );
}

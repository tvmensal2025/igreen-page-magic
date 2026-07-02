import { Sun, Moon, Monitor } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  const cycle = () => {
    const next = theme === "dark" ? "light" : theme === "light" ? "system" : "dark";
    setTheme(next);
  };

  return (
    <button
      onClick={cycle}
      className="relative p-2 rounded-xl text-muted-foreground hover:text-foreground
        hover:bg-accent/10 transition-all duration-200 group min-h-11 min-w-11 flex items-center justify-center"
      aria-label={`Tema: ${theme}`}
      title={`Tema: ${theme === "dark" ? "Escuro" : theme === "light" ? "Claro" : "Sistema"}`}
    >
      {theme === "dark" && <Moon className="h-5 w-5 transition-transform group-hover:rotate-12" />}
      {theme === "light" && <Sun className="h-5 w-5 transition-transform group-hover:rotate-45" />}
      {theme === "system" && <Monitor className="h-5 w-5 transition-transform group-hover:scale-110" />}
    </button>
  );
}

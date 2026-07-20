import React, { createContext, useContext, useEffect } from "react";

// Plataforma iGreen é light-only. Mantemos a API do contexto para não quebrar
// componentes que ainda importam `useTheme`, mas `setTheme` é no-op e o tema
// resolvido é sempre "light".

type Theme = "light";

interface ThemeContextType {
  theme: Theme;
  resolvedTheme: "light";
  setTheme: (theme: Theme | "dark" | "system") => void;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: "light",
  resolvedTheme: "light",
  setTheme: () => {},
});

export const useTheme = () => useContext(ThemeContext);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("dark", "system");
    root.classList.add("light");
    root.style.colorScheme = "light";
    try {
      localStorage.setItem("igreen-theme", "light");
    } catch {}
  }, []);

  return (
    <ThemeContext.Provider value={{ theme: "light", resolvedTheme: "light", setTheme: () => {} }}>
      {children}
    </ThemeContext.Provider>
  );
}

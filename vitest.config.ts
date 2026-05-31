import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Edge Functions rodam em Deno e importam supabase-js via URL esm.sh.
      // Sob Vitest (Node) redirecionamos para o pacote instalado, permitindo
      // testar helpers compartilhados (_shared/*) sem alterar o código de
      // produção (que continua usando a URL no runtime Deno).
      "https://esm.sh/@supabase/supabase-js@2.45.0": "@supabase/supabase-js",
    },
  },
});

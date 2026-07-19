import path from "node:path";
import { defineConfig } from "vite";

/** Config mínima para rodar scripts Node com aliases `@/`. */
export default defineConfig({
  resolve: {
    alias: {
      "@/integrations/supabase/client": path.resolve(__dirname, "./supabase-script-stub.ts"),
      "@": path.resolve(__dirname, "../src"),
    },
  },
});

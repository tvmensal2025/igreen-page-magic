import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { writeFileSync } from "fs";

// ID único deste build (timestamp). É embutido no bundle (__BUILD_ID__) e
// também gravado em /version.json. O app compara os dois em runtime para
// detectar quando há uma versão nova publicada e forçar a limpeza de cache.
const BUILD_ID = Date.now().toString();

// Plugin minúsculo: grava dist/version.json ao final do build.
function emitVersionJson() {
  return {
    name: "emit-version-json",
    apply: "build" as const,
    closeBundle() {
      try {
        writeFileSync(
          path.resolve(__dirname, "dist/version.json"),
          JSON.stringify({ buildId: BUILD_ID }),
        );
      } catch (e) {
        console.warn("[emit-version-json] falhou:", e);
      }
    },
  };
}

// ─── ESTRATÉGIA ANTI-CACHE (importante!) ──────────────────────────────────
// Este app NÃO registra mais Service Worker de cache. O problema relatado foi
// exatamente usuários presos em páginas antigas após várias atualizações.
// Mantemos apenas manifest/installability e kill-switches em /sw.js e
// /sw-app.js para remover instalações antigas. Atualização de página aberta é
// feita por /version.json + __BUILD_ID__ em src/main.tsx.

export default defineConfig({

  define: {
    // Disponível em todo o código do app como string literal.
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  server: {
    host: "0.0.0.0",
    port: 8080,
    hmr: {
      overlay: false,
    },
    // Proxy de DESENVOLVIMENTO apenas. As edge functions do Supabase têm CORS
    // restrito a igreen.cloud/localhost:8080; quando o dev sobe em outra porta
    // (8081/8082...), o preflight falha. Encaminhar /functions-proxy pelo
    // próprio Vite faz a chamada virar same-origin (sem CORS) e o servidor
    // repassa ao Supabase. NÃO afeta produção (só o dev server).
    proxy: {
      "/functions-proxy": {
        target: "https://zlzasfhcxcznaprrragl.supabase.co",
        changeOrigin: true,
        secure: true,
        rewrite: (p) => p.replace(/^\/functions-proxy/, "/functions/v1"),
      },
    },
  },
  plugins: [
    react(),
    emitVersionJson(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
  },
  build: {
    target: "es2020",
    minify: "esbuild",
    cssMinify: true,
    // Nunca publicar sourcemaps em produção: eles reconstroem o código-fonte
    // original (com nomes de variáveis, comentários e estrutura de pastas)
    // dentro do DevTools. Sem isso, o que aparece é só o bundle minificado.
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          "react-vendor": ["react", "react-dom", "react-router-dom"],
          "supabase": ["@supabase/supabase-js"],
          "radix": [
            "@radix-ui/react-dialog",
            "@radix-ui/react-dropdown-menu",
            "@radix-ui/react-tabs",
            "@radix-ui/react-popover",
            "@radix-ui/react-select",
            "@radix-ui/react-tooltip",
          ],
          "charts": ["recharts"],
          "icons": ["lucide-react"],
          "xlsx": ["xlsx"],
        },
      },
    },
  },
});

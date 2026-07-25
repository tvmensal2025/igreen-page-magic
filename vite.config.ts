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
    // Proxy de DESENVOLVIMENTO apenas. O client (`integrations/supabase/client.ts`)
    // reescreve /functions/v1 → /functions-proxy em DEV, evitando preflight CORS
    // quando o Vite sobe em 8081/8082. NÃO afeta produção (só o dev server).
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
    // Objeto em manualChunks força Rollup a tratar esses pacotes como deps do
    // entry e o Vite emite <link rel="modulepreload"> no index.html — /auth
    // baixava three/jspdf/charts/xyflow sem usar. Função só nomeia o chunk
    // quando o módulo entra no grafo (rota lazy). Filtro abaixo é cinto.
    modulePreload: {
      resolveDependencies: (_filename, deps) =>
        deps.filter((dep) => {
          const heavy =
            /(?:^|\/)(?:three|jspdf|charts|xyflow|xlsx|html2canvas|pdf|framer-motion)(?:-|\/|\.js)/i;
          return !heavy.test(dep);
        }),
    },
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          // Ordem importa: pacotes com "react" no path (radix, lucide-react,
          // @react-three) precisam casar ANTES do vendor React.
          if (id.includes("@radix-ui/")) return "radix";
          if (id.includes("@supabase/supabase-js")) return "supabase";
          if (id.includes("recharts")) return "charts";
          if (id.includes("lucide-react")) return "icons";
          if (id.includes("/xlsx/") || id.endsWith("/xlsx") || id.includes("node_modules/xlsx")) {
            return "xlsx";
          }
          if (id.includes("@xyflow/")) return "xyflow";
          if (id.includes("@react-three/") || /node_modules\/three\//.test(id)) {
            return "three";
          }
          if (id.includes("jspdf")) return "jspdf";
          if (id.includes("html2canvas")) return "html2canvas";
          if (id.includes("framer-motion")) return "framer-motion";
          if (
            /node_modules\/(?:react|react-dom)\//.test(id) ||
            /node_modules\/react-router(?:-dom)?\//.test(id)
          ) {
            return "react-vendor";
          }
        },
      },
    },
  },
});

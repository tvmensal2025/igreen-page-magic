import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { writeFileSync } from "fs";
import { VitePWA } from "vite-plugin-pwa";

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
// O domínio igreen.cloud está em Cloudflare com nuvem CINZA (DNS-only), então
// o tráfego vai direto para a Lovable Hosting, que NÃO processa public/_headers.
// Por isso a estratégia anti-cache é 100% client-side:
//   1. Meta tags no-cache em index.html (forçam revalidar HTML)
//   2. Service Worker em /sw-app.js com NetworkFirst para navegações
//   3. /version.json + __BUILD_ID__ (gate em main.tsx) detecta deploy novo
//      a cada 30s + em visibilitychange + em online + em cada navegação SPA
//   4. Kill-switch em /sw.js (public/) para limpar instalações antigas
//   5. Rota de emergência ?nuke=1 limpa SW + caches e recarrega
// Se um dia a nuvem do Cloudflare voltar para LARANJA (proxy ativo), recriar
// public/_headers volta a funcionar como reforço — mas o sistema atual já
// blinda 100% sem depender de cabeçalhos de servidor.

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
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: null, // registramos manualmente em main.tsx (com guards)
      strategies: "generateSW",
      filename: "sw-app.js", // /sw.js fica reservado para o kill-switch em public/
      devOptions: { enabled: false },
      includeAssets: [
        "favicon.png",
        "favicon-16.png",
        "favicon-32.png",
        "apple-touch-icon.png",
      ],
      manifest: false, // usamos o /public/manifest.json existente
      workbox: {
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        // Movido para /sw-app.js. O /sw.js no /public é um kill-switch para
        // limpar instalações antigas — não é mais o SW principal do app.
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [
          /^\/~oauth/,
          /^\/api/,
          /^\/functions/,
          /^\/reset/, // rota de recuperação manual nunca pode vir do cache
          /^\/r\//, // link curto de parceiro: deixa o redirect 302 do Cloudflare agir (nunca servir o app do cache)
        ],
        // Não tente precachear o manifest manual nem assets gigantes.
        globIgnores: ["**/manifest.json", "**/sw.js", "**/version.json"],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        runtimeCaching: [
          {
            // HTML — sempre tenta rede antes (3s) para pegar deploy novo.
            // Cache curto (5min) para evitar servir HTML antigo apontando
            // para chunks que já não existem no novo deploy.
            urlPattern: ({ request }) => request.mode === "navigate",
            handler: "NetworkFirst",
            options: {
              cacheName: "html-cache",
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 5 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // Supabase / edge functions / WhatsApp media — NUNCA cachear.
            urlPattern: /^https:\/\/[^/]*supabase\.(co|in)\//i,
            handler: "NetworkOnly",
          },
          {
            // version.json — sempre rede. É o gatilho do version gate; cachear
            // aqui anularia a detecção de nova versão.
            urlPattern: ({ url }) => url.pathname === "/version.json",
            handler: "NetworkOnly",
          },
          {
            // MinIO / mídia dinâmica — sempre rede.
            urlPattern: /minio|igreen\.cloud\/(media|whatsapp)/i,
            handler: "NetworkOnly",
          },
          {
            // Fontes Google.
            urlPattern: /^https:\/\/fonts\.(gstatic|googleapis)\.com\//,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts",
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Imagens estáticas do app.
            urlPattern: ({ request }) => request.destination === "image",
            handler: "CacheFirst",
            options: {
              cacheName: "img-cache",
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
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

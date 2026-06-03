import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  server: {
    host: "0.0.0.0",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: null, // registramos manualmente em main.tsx (com guards)
      strategies: "generateSW",
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
        ],
        // Não tente precachear o manifest manual nem assets gigantes.
        globIgnores: ["**/manifest.json", "**/sw.js"],
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

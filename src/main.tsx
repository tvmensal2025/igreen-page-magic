import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Sentry é carregado de forma assíncrona para não bloquear o React.
// Se falhar, o app continua funcionando normalmente.
const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;
if (SENTRY_DSN) {
  import("@sentry/react")
    .then((Sentry) => {
      Sentry.init({
        dsn: SENTRY_DSN,
        environment: import.meta.env.MODE,
        integrations: [
          Sentry.browserTracingIntegration(),
          Sentry.replayIntegration({
            maskAllText: true,
            blockAllMedia: true,
          }),
        ],
        tracesSampleRate: 0.1,
        replaysSessionSampleRate: 0.0,
        replaysOnErrorSampleRate: 1.0,
        sendDefaultPii: false,
      });
    })
    .catch((e) => console.warn("Sentry init failed:", e));
}

createRoot(document.getElementById("root")!).render(<App />);

// ─── Auto-recuperação: chunk hash obsoleto / SW servindo build antigo ──────
// Quando o navegador tenta importar um chunk hashed que já não existe
// (deploy novo, SW serviu HTML antigo), o app trava em tela branca e o
// usuário só consegue voltar abrindo aba anônima. Aqui detectamos esse
// caso, limpamos caches + SW e recarregamos UMA ÚNICA VEZ por sessão.
async function nukeAndReload(reason: string) {
  const flag = "__sw_recovered__";
  try {
    if (sessionStorage.getItem(flag)) return; // evita loop infinito
    sessionStorage.setItem(flag, "1");
  } catch { /* sessionStorage pode estar bloqueado */ }
  console.warn("[recovery] limpando caches + SW. Motivo:", reason);
  try {
    if ("caches" in window) {
      const names = await caches.keys();
      await Promise.all(names.map((n) => caches.delete(n)));
    }
  } catch (e) { console.warn("[recovery] cache cleanup falhou:", e); }
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch (e) { console.warn("[recovery] sw unregister falhou:", e); }
  const url = new URL(window.location.href);
  url.searchParams.set("sw-recover", String(Date.now()));
  window.location.replace(url.toString());
}

// Evento nativo do Vite quando um preload de chunk falha.
window.addEventListener("vite:preloadError", (e) => {
  e.preventDefault?.();
  void nukeAndReload("vite:preloadError");
});
// Fallback genérico para "Failed to fetch dynamically imported module".
window.addEventListener("error", (e) => {
  const msg = String(e?.message || "");
  if (/dynamically imported module|Importing a module script failed|ChunkLoadError/i.test(msg)) {
    void nukeAndReload("error:" + msg.slice(0, 80));
  }
});
window.addEventListener("unhandledrejection", (e) => {
  const msg = String((e as any)?.reason?.message || (e as any)?.reason || "");
  if (/dynamically imported module|Importing a module script failed|ChunkLoadError/i.test(msg)) {
    void nukeAndReload("rejection:" + msg.slice(0, 80));
  }
});

// ─── PWA: registro de Service Worker com guards de iframe/preview ──────────
// Service worker quebra o preview do Lovable (cacheia builds velhos).
// Só registramos em produção real (domínio publicado / igreen.cloud).
const inIframe = (() => {
  try { return window.self !== window.top; } catch { return true; }
})();
const host = typeof window !== "undefined" ? window.location.hostname : "";
const isPreviewHost =
  host.includes("id-preview--") ||
  host.includes("lovableproject.com") ||
  host === "localhost" ||
  host === "127.0.0.1";

if (!inIframe && !isPreviewHost && "serviceWorker" in navigator) {
  import("virtual:pwa-register")
    .then(({ registerSW }) => {
      const updateSW = registerSW({
        immediate: true,
        onRegisteredSW(_swUrl, r) {
          // Checa por atualização a cada 60s enquanto a aba estiver aberta,
          // em vez do ciclo padrão (até 24h). Pega deploys novos rapidamente.
          if (r) setInterval(() => { r.update().catch(() => {}); }, 60_000);
        },
        onRegisterError(err) {
          console.warn("[PWA] register error:", err);
          void nukeAndReload("sw-register-error");
        },
      });
      void updateSW;
    })
    .catch((e) => console.warn("[PWA] register failed:", e));
} else if ("serviceWorker" in navigator) {
  // Em preview / iframe / localhost: limpa qualquer SW antigo para não cachear.
  navigator.serviceWorker.getRegistrations().then((rs) => {
    rs.forEach((r) => r.unregister());
  }).catch(() => {});
}

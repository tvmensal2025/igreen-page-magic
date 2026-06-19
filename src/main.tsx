import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { ativarHardening } from "./lib/hardening";

// ─── Gatilho de emergência: ?nuke=1 limpa tudo e recarrega ─────────────────
// Para usuários presos numa versão muito antiga (PWA instalado offline há
// semanas), basta abrir https://igreen.cloud/?nuke=1 que o app limpa SW +
// caches + storages PWA e recarrega na raiz.
if (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("nuke")) {
  (async () => {
    try {
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
    } catch {}
    try {
      if ("caches" in window) {
        const names = await caches.keys();
        await Promise.all(names.map((n) => caches.delete(n)));
      }
    } catch {}
    window.location.replace("/");
  })();
}

// Camada dissuasória anti-inspeção (só em produção real; ver lib/hardening.ts).
void ativarHardening();


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
function isUserBusyTyping(): boolean {
  try {
    const generatingSince = Number(sessionStorage.getItem("tts_audio_studio_generating_v1") || 0);
    if (generatingSince && Date.now() - generatingSince < 10 * 60 * 1000) return true;
    const el = document.activeElement as HTMLElement | null;
    if (!el) return false;
    const tag = el.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
    if (el.isContentEditable) return true;
    // Qualquer diálogo/modal aberto também adia o reload
    if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')) return true;
    return false;
  } catch { return false; }
}

async function nukeAndReload(reason: string) {
  const flag = "__sw_recovered__";
  // Não interrompe o usuário no meio de um formulário/modal
  if (isUserBusyTyping()) {
    console.info("[recovery] usuário ocupado, adiando reload:", reason);
    setTimeout(() => { void nukeAndReload(reason); }, 15_000);
    return;
  }
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

// ─── Version gate: força atualização mesmo com cache teimoso ───────────────
// Mesmo com o Service Worker em auto-update, alguns navegadores/CDN seguram
// um index.html antigo ou um SW que não troca, deixando o usuário "preso" numa
// versão velha. Para cobrir isso, comparamos o ID embutido neste bundle
// (__BUILD_ID__) com o publicado em /version.json (servido sempre da rede).
// Se forem diferentes, há um deploy novo: limpamos caches + SW e recarregamos
// uma única vez (nukeAndReload já tem trava anti-loop por sessão).
async function checkVersionGate() {
  try {
    const res = await fetch(`/version.json?_=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return;
    const { buildId } = await res.json();
    if (buildId && typeof buildId === "string" && buildId !== __BUILD_ID__) {
      showUpdateBanner();
      await nukeAndReload(`version-gate:${__BUILD_ID__}->${buildId}`);
    }
  } catch { /* offline ou version.json ausente: ignora silenciosamente */ }
}

// Banner visível quando uma versão nova é detectada mas o usuário está
// digitando/em modal (não podemos recarregar agora). Dá ao usuário a opção
// manual de atualizar imediatamente.
function showUpdateBanner() {
  if (document.getElementById("__igreen_update_banner__")) return;
  const el = document.createElement("div");
  el.id = "__igreen_update_banner__";
  el.style.cssText =
    "position:fixed;bottom:16px;left:50%;transform:translateX(-50%);" +
    "background:#16a34a;color:#fff;padding:12px 18px;border-radius:9999px;" +
    "font:600 14px system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.25);" +
    "z-index:2147483647;cursor:pointer;display:flex;gap:10px;align-items:center;";
  el.innerHTML = "🔄 Nova versão disponível — toque para atualizar";
  el.addEventListener("click", () => window.location.reload());
  document.body.appendChild(el);
}

// Checa imediatamente ao carregar (antes mesmo do SW registrar), para pegar
// usuário cujo HTML veio cacheado e nunca chegaria ao registerSW novo.
void checkVersionGate();

// Patch no History API para checar a cada navegação SPA.
try {
  const orig = { push: history.pushState, replace: history.replaceState };
  history.pushState = function (...args) {
    const r = orig.push.apply(this, args as any);
    void checkVersionGate();
    return r;
  };
  history.replaceState = function (...args) {
    const r = orig.replace.apply(this, args as any);
    void checkVersionGate();
    return r;
  };
  window.addEventListener("popstate", () => void checkVersionGate());
} catch { /* ambiente sem history */ }

// ─── PWA: registro de Service Worker com guards de iframe/preview ──────────
// Service worker quebra o preview do Lovable (cacheia builds velhos).
// Só registramos em produção real (domínio publicado / igreen.cloud).
const inIframe = (() => {
  try { return window.self !== window.top; } catch { return true; }
})();
const host = typeof window !== "undefined" ? window.location.hostname : "";
// Considera "preview/dev" (NÃO registra Service Worker) quando:
// - host do Lovable/preview
// - localhost / 127.0.0.1
// - acesso direto por IP (ex.: VPS de desenvolvimento 72.60.159.48)
// Isso evita que o SW cacheie builds antigos durante o desenvolvimento na VPS.
const isRawIpHost = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":") /* IPv6 */;
const isPreviewHost =
  host.includes("id-preview--") ||
  host.includes("lovableproject.com") ||
  host === "localhost" ||
  host === "127.0.0.1" ||
  isRawIpHost;


if (!inIframe && !isPreviewHost && "serviceWorker" in navigator) {
  // ─── Auto-reload quando um novo SW assume o controle ───────────────────
  // Com registerType:"autoUpdate" + skipWaiting+clientsClaim, o novo SW
  // ativa sozinho. Mas o navegador só "vê" a UI nova se a página recarregar.
  // Forçamos reload UMA vez quando o controlador troca (= deploy novo
  // assumiu). O flag evita loop caso algo dê errado.
  let reloadingForSW = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloadingForSW) return;
    const doReload = () => {
      if (isUserBusyTyping()) {
        setTimeout(doReload, 15_000);
        return;
      }
      reloadingForSW = true;
      console.info("[PWA] novo Service Worker assumiu — recarregando");
      window.location.reload();
    };
    doReload();
  });


  import("virtual:pwa-register")
    .then(({ registerSW }) => {
      const updateSW = registerSW({
        immediate: true,
        onNeedRefresh() {
          // Como queremos auto-update, força aplicar imediatamente.
          // O reload em si acontece no controllerchange acima.
          updateSW(true).catch(() => {});
        },
        onRegisteredSW(_swUrl, r) {
          if (!r) return;
          // Checa por atualização a cada 60s enquanto a aba estiver aberta.
          const poll = () => {
            r.update().catch(() => {});
            void checkVersionGate();
          };
          setInterval(poll, 30_000);
          // Checagem imediata ao registrar — pega usuário que abriu já com
          // bundle antigo em cache.
          void checkVersionGate();
          // E sempre que a aba volta a ficar visível (usuário trocou de
          // aba/celular e voltou), checa imediatamente — pega deploys
          // feitos enquanto a aba estava em background.
          document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible") poll();
          });
          // E quando volta a ter rede.
          window.addEventListener("online", poll);
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

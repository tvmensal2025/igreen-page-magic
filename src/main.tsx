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
  const flag = "__sw_recovered_at__";
  // Não interrompe o usuário no meio de um formulário/modal
  if (isUserBusyTyping()) {
    console.info("[recovery] usuário ocupado, adiando reload:", reason);
    setTimeout(() => { void nukeAndReload(reason); }, 15_000);
    return;
  }
  // Trava anti-loop persistente (localStorage com TTL de 10 min). Antes era
  // sessionStorage, mas isso permitia reloops ao abrir uma nova aba.
  try {
    const last = Number(localStorage.getItem(flag) || 0);
    if (last && Date.now() - last < 10 * 60 * 1000) {
      console.info("[recovery] recovery recente, ignorando:", reason);
      return;
    }
    localStorage.setItem(flag, String(Date.now()));
  } catch { /* storage pode estar bloqueado */ }

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

// ─── Version gate: detecta deploy novo e atualiza em momento SEGURO ───────
// O cliente não precisa saber limpar cache. Quando uma versão nova é
// publicada, o app aplica sozinho — mas só quando o usuário NÃO está
// digitando, com um formulário/modal aberto ou gerando áudio. Assim a
// atualização acontece de forma transparente, sem interromper o trabalho.
//
// IMPORTANTE — anti-loop: o app só recarrega quando o buildId do servidor é
// DIFERENTE do build em execução, e no máximo 2 vezes para a MESMA versão
// nova. Se recarregou e mesmo assim continuou no build velho (deploy ainda
// não propagou ou cache do navegador preso), ele PARA de tentar e deixa o app
// funcionando — em vez de ficar recarregando sozinho toda hora ("bugado").
const UPDATE_ATTEMPT_KEY = "__igreen_update_attempt_v1__";
const UPDATE_MAX_ATTEMPTS = 2;
const UPDATE_ATTEMPT_TTL_MS = 30 * 60 * 1000; // 30 min

type UpdateAttempt = { target: string; count: number; ts: number };

function readUpdateAttempt(): UpdateAttempt | null {
  try {
    const raw = localStorage.getItem(UPDATE_ATTEMPT_KEY);
    if (!raw) return null;
    const rec = JSON.parse(raw) as UpdateAttempt;
    if (!rec || typeof rec.target !== "string") return null;
    // Registro velho (>30 min) não vale mais — considera limpo.
    if (!rec.ts || Date.now() - rec.ts > UPDATE_ATTEMPT_TTL_MS) return null;
    return rec;
  } catch { return null; }
}

// Limpeza no boot: se já estamos rodando a versão que era o alvo, a
// atualização deu certo — zera o contador para liberar futuras versões.
try {
  const rec = readUpdateAttempt();
  if (rec && rec.target === __BUILD_ID__) localStorage.removeItem(UPDATE_ATTEMPT_KEY);
} catch { /* storage bloqueado: ignora */ }

async function checkVersionGate() {
  try {
    const res = await fetch(`/version.json?_=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return;
    const { buildId } = await res.json();
    if (buildId && typeof buildId === "string" && buildId !== __BUILD_ID__) {
      // Notifica a UI para mostrar o toast "Nova versão disponível" com botão
      // manual de "Atualizar agora". O auto-reload silencioso continua em
      // paralelo — o que acontecer primeiro aplica a atualização.
      try {
        window.dispatchEvent(
          new CustomEvent("igreen:update-available", { detail: { buildId } }),
        );
      } catch { /* CustomEvent indisponível em navegadores muito antigos */ }
      applyUpdateWhenSafe(buildId, "version-gate");
    }
  } catch { /* offline ou version.json ausente: ignora silenciosamente */ }
}

// Garante que só agendamos uma única atualização (evita timers empilhados
// quando várias fontes detectam a versão nova ao mesmo tempo).
let updateScheduled = false;

// Aplica a versão nova recarregando a página, porém apenas quando for seguro.
// Se o usuário estiver ocupado (digitando, modal aberto, gerando áudio),
// reavalia a cada 15s até encontrar uma janela tranquila. Reaproveita a mesma
// heurística do nukeAndReload (isUserBusyTyping).
//
// targetBuildId: a versão nova que queremos aplicar. Serve de chave do
// anti-loop. Quando a origem não conhece o buildId (SW), passamos "sw".
function applyUpdateWhenSafe(targetBuildId: string, reason: string) {
  if (updateScheduled) return;

  // Anti-loop: se já recarregamos o limite de vezes para ESTA mesma versão
  // alvo e ainda assim não saímos do build antigo, paramos. Evita o ciclo
  // "recarrega → volta velho → recarrega" quando o deploy não propagou.
  const prev = readUpdateAttempt();
  if (prev && prev.target === targetBuildId && prev.count >= UPDATE_MAX_ATTEMPTS) {
    console.warn(
      "[update] já tentei atualizar para", targetBuildId,
      `${prev.count}x sem sucesso — parando para não ficar em loop`,
    );
    return;
  }

  updateScheduled = true;

  const tryReload = () => {
    if (isUserBusyTyping()) {
      console.info("[update] usuário ocupado, adiando atualização:", reason);
      setTimeout(tryReload, 15_000);
      return;
    }
    // Registra a tentativa ANTES de recarregar, para o anti-loop contar mesmo
    // que o reload aconteça em seguida.
    try {
      const cur = readUpdateAttempt();
      const count = cur && cur.target === targetBuildId ? cur.count + 1 : 1;
      const rec: UpdateAttempt = { target: targetBuildId, count, ts: Date.now() };
      localStorage.setItem(UPDATE_ATTEMPT_KEY, JSON.stringify(rec));
    } catch { /* storage bloqueado: segue mesmo assim */ }
    console.info("[update] aplicando versão nova. Motivo:", reason);
    window.location.reload();
  };

  tryReload();
}

// Checa imediatamente ao carregar (antes mesmo do SW registrar), para pegar
// usuário cujo HTML veio cacheado e nunca chegaria ao registerSW novo.
void checkVersionGate();

// Mantém páginas abertas atualizadas mesmo sem Service Worker.
// Se o usuário ficar parado na página oficial e houver publish novo, o app
// detecta pelo /version.json e recarrega sozinho quando for seguro.
setInterval(() => { void checkVersionGate(); }, 60 * 1000);
window.addEventListener("online", () => { void checkVersionGate(); });
window.addEventListener("focus", () => { void checkVersionGate(); });
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) void checkVersionGate();
});

// ─── PWA/Service Worker: agora é só limpeza, nunca registro ────────────────
// O app parou de registrar Service Worker de cache porque isso prendia usuários
// em versões antigas. Mantemos o manifest para abrir como app na tela inicial,
// mas removemos qualquer SW antigo (/sw.js ou /sw-app.js) e caches do Workbox.
const inIframe = (() => {
  try { return window.self !== window.top; } catch { return true; }
})();

function isAppCacheName(name: string): boolean {
  return (
    /(^|-)precache-v\d+-|(^|-)runtime-|(^|-)googleAnalytics-/.test(name) ||
    /^workbox-/.test(name) ||
    name === "img-cache" ||
    name === "google-fonts"
  );
}

async function cleanupLegacyServiceWorkers() {
  if (inIframe) return;
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch (e) { console.warn("[PWA] limpeza de SW antigo falhou:", e); }

  try {
    if ("caches" in window) {
      const names = await caches.keys();
      await Promise.all(names.filter(isAppCacheName).map((n) => caches.delete(n)));
    }
  } catch (e) { console.warn("[PWA] limpeza de cache antigo falhou:", e); }
}

void cleanupLegacyServiceWorkers();

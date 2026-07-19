// ─── Hardening do front-end (camada dissuasória) ──────────────────────────
//
// Nada que roda no navegador é secreto de verdade. A segurança real está no
// backend (Supabase RLS, caller-auth, verify_jwt). Aqui só dificultamos para
// curioso leigo: trava F12, clique direito e atalhos de DevTools.
//
// NÃO bloqueia: gravação de tela, PrintScreen, getDisplayMedia, Ctrl/Cmd+S,
// Ctrl/Cmd+Shift+S (screenshot) — isso precisa continuar livre.
//
// O super admin controla via flag `devtools_blocked` (app_settings).
// Só aplica bloqueio quando a flag está explicitamente true.
//
// Em ambientes de desenvolvimento (localhost, lovable.app, IP direto, iframe)
// NUNCA trava — independente da flag no banco.

import { supabase } from "@/integrations/supabase/client";

function isAmbienteDev(): boolean {
  const host = typeof window !== "undefined" ? window.location.hostname : "";
  const inIframe = (() => { try { return window.self !== window.top; } catch { return true; } })();
  const isRawIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":");
  const isPreview =
    host.includes("id-preview--") ||
    host.includes("lovableproject.com") ||
    host.includes("lovable.app") ||
    host.includes("lovable.dev") ||
    host === "localhost" ||
    host === "127.0.0.1" ||
    isRawIp;
  return inIframe || isPreview;
}

function aplicarBloqueios() {
  // Só atalhos de inspecionar / ver código-fonte — não captura, save nem print.
  window.addEventListener("keydown", (e) => {
    const key = (e.key || "").toLowerCase();
    if (key === "f12") {
      e.preventDefault();
      return;
    }
    // Ctrl/Cmd+U = ver código-fonte
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && key === "u") {
      e.preventDefault();
      return;
    }
    // Ctrl/Cmd+Shift+I/J/C = DevTools / console / inspecionar elemento
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (key === "i" || key === "j" || key === "c")) {
      e.preventDefault();
    }
  }, { capture: true });

  // Bloqueia clique direito (menu com "Inspecionar")
  window.addEventListener("contextmenu", (e) => { e.preventDefault(); }, { capture: true });

  // Silencia console (mantém console.error para Sentry)
  try {
    const noop = () => {};
    (["log", "debug", "info", "warn", "table", "dir", "trace", "group", "groupCollapsed", "groupEnd"] as const)
      .forEach((m) => { (console as any)[m] = noop; });
  } catch { /* ignore */ }
}

let jaVerificou = false;

/**
 * Chame uma vez no boot do app (main.tsx).
 * Busca a flag do banco e aplica bloqueios só se `devtools_blocked = true`.
 */
export async function ativarHardening() {
  if (jaVerificou) return;
  jaVerificou = true;

  // Ambientes de dev: nunca bloqueia.
  if (isAmbienteDev()) return;

  // Só bloqueia se a flag estiver explicitamente ligada (botão ATIVO).
  // Fail-open: rede/RPC falhou → não trava (gravação de tela e uso normal seguem).
  let deveBloqueiar = false;
  try {
    // RPC dedicada: retorna SOMENTE o boolean, sem expor outros campos de
    // app_settings (super_admin_phone, etc.) para usuários anônimos.
    const { data, error } = await supabase.rpc("get_devtools_blocked");
    if (!error && data === true) {
      deveBloqueiar = true;
    }
  } catch {
    // fail-open
  }

  if (deveBloqueiar) {
    aplicarBloqueios();
  }
}

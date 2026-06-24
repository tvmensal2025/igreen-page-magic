// Hard-reset: limpa TUDO no navegador (caches, service workers, localStorage,
// sessionStorage) e recarrega o app na rota /auth. Usado por:
// - Toast "Nova versão disponível" → botão "Atualizar agora"
// - Página /reset (recuperação manual)
// - URL ?nuke=1 (gatilho de emergência em main.tsx)
//
// O usuário precisará logar de novo após este reset. É proposital — garante
// que nenhum estado obsoleto do build antigo sobreviva.
export async function hardReset(reason: string): Promise<void> {
  console.warn("[hardReset] iniciando. Motivo:", reason);

  try {
    if ("caches" in window) {
      const names = await caches.keys();
      await Promise.all(names.map((n) => caches.delete(n)));
    }
  } catch (e) {
    console.warn("[hardReset] cache cleanup falhou:", e);
  }

  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch (e) {
    console.warn("[hardReset] sw unregister falhou:", e);
  }

  try { localStorage.clear(); } catch {}
  try { sessionStorage.clear(); } catch {}

  const url = new URL(window.location.origin + "/auth");
  url.searchParams.set("fresh", String(Date.now()));
  window.location.replace(url.toString());
}

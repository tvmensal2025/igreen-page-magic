import { useState } from "react";

// Página oculta de recuperação. Caminho: /reset
// Quando um usuário ficar preso em uma versão antiga (tela branca, "só abre
// em aba anônima"), oriente-o a abrir https://igreen.cloud/reset e clicar
// no botão. Isso limpa todo cache + service worker e recarrega o app.
export default function ResetApp() {
  const [status, setStatus] = useState<"idle" | "cleaning" | "done" | "error">("idle");
  const [message, setMessage] = useState<string>("");

  async function handleReset() {
    setStatus("cleaning");
    setMessage("Limpando cache...");
    try {
      if ("caches" in window) {
        const names = await caches.keys();
        await Promise.all(names.map((n) => caches.delete(n)));
      }
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
      try { localStorage.removeItem("__sw_recovered__"); } catch {}
      try { sessionStorage.clear(); } catch {}
      setStatus("done");
      setMessage("Pronto! Recarregando...");
      setTimeout(() => {
        const url = new URL(window.location.origin + "/auth");
        url.searchParams.set("sw-recover", String(Date.now()));
        window.location.replace(url.toString());
      }, 600);
    } catch (e) {
      setStatus("error");
      setMessage((e as Error)?.message || "Erro inesperado");
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-background px-6">
      <div className="w-full max-w-md rounded-2xl border bg-card p-8 shadow-lg space-y-5 text-center">
        <h1 className="text-2xl font-semibold">Recuperar acesso</h1>
        <p className="text-sm text-muted-foreground">
          Se o sistema não está abrindo ou aparece em branco, clique em
          <strong> Resetar app</strong> abaixo. Isso limpa o cache local e
          recarrega a versão mais recente. Seus dados no servidor não são
          afetados.
        </p>
        <button
          onClick={handleReset}
          disabled={status === "cleaning" || status === "done"}
          className="w-full rounded-xl bg-primary text-primary-foreground py-3 font-medium hover:opacity-90 disabled:opacity-60"
        >
          {status === "cleaning" ? "Limpando..." : status === "done" ? "Pronto!" : "Resetar app"}
        </button>
        {message && (
          <p className={`text-xs ${status === "error" ? "text-destructive" : "text-muted-foreground"}`}>
            {message}
          </p>
        )}
      </div>
    </main>
  );
}

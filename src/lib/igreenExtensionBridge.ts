// Bridge between the web app (Lovable iGreen Cloud) and the iGreen Sync
// Chrome extension. The extension injects a content script on the app's
// origin that listens to window.postMessage and forwards to its background
// service worker. This lets us trigger a sync from the dashboard "Sincronizar"
// button without the user having to open the extension popup.

const APP_SOURCE = "igreen-cloud-app";
const EXT_SOURCE = "igreen-sync-ext";

type SyncReason = "no_token" | "not_logged_in" | "no_extension" | "failed";

export type SyncResult =
  | { ok: true; status?: unknown }
  | { ok: false; reason: SyncReason; error?: string };

function newId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function once<T>(
  match: (data: any) => boolean,
  mapper: (data: any) => T,
  timeoutMs: number,
): Promise<T | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      window.removeEventListener("message", handler);
      resolve(null);
    }, timeoutMs);
    const handler = (e: MessageEvent) => {
      if (e.source !== window) return;
      const d = e.data;
      if (!d || d.source !== EXT_SOURCE) return;
      if (!match(d)) return;
      clearTimeout(t);
      window.removeEventListener("message", handler);
      resolve(mapper(d));
    };
    window.addEventListener("message", handler);
  });
}

export async function pingExtension(timeoutMs = 1500): Promise<boolean> {
  const id = newId();
  const p = once<boolean>(
    (d) => d.type === "PONG" && d.id === id,
    () => true,
    timeoutMs,
  );
  window.postMessage({ source: APP_SOURCE, type: "PING", id }, "*");
  const got = await p;
  return !!got;
}

export async function requestSync(timeoutMs = 5 * 60 * 1000): Promise<SyncResult> {
  // Ping first so we can distinguish "extension missing" from "sync failed"
  const alive = await pingExtension();
  if (!alive) return { ok: false, reason: "no_extension" };

  const id = newId();
  const p = once<SyncResult>(
    (d) => d.type === "SYNC_RESULT" && d.id === id,
    (d) => d.payload as SyncResult,
    timeoutMs,
  );
  window.postMessage({ source: APP_SOURCE, type: "SYNC_NOW", id }, "*");
  const got = await p;
  if (!got) return { ok: false, reason: "failed", error: "Sem resposta da extensão." };
  return got;
}

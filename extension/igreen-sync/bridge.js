// iGreen Sync — content-script bridge entre o app web (igreen.cloud)
// e o service worker da extensão. Recebe window.postMessage do app e
// forward via chrome.runtime.sendMessage; devolve a resposta por
// window.postMessage para o app.

(() => {
  const APP_SOURCE = "igreen-cloud-app";
  const EXT_SOURCE = "igreen-sync-ext";

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== APP_SOURCE) return;
    const { type, id } = data;

    if (type === "PING") {
      window.postMessage({ source: EXT_SOURCE, type: "PONG", id, version: "1.4.0" }, "*");
      return;
    }

    if (type === "SYNC_NOW") {
      chrome.runtime.sendMessage({ type: "APP_SYNC_NOW" }, (resp) => {
        // resp = { ok:true, status } | { ok:false, reason, error }
        window.postMessage(
          { source: EXT_SOURCE, type: "SYNC_RESULT", id, payload: resp || { ok: false, reason: "failed", error: "Sem resposta" } },
          "*",
        );
      });
      return;
    }
  });
})();

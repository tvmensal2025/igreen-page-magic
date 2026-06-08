const $ = (id) => document.getElementById(id);

async function refresh() {
  const s = await chrome.storage.local.get(["pairingToken", "autoSync", "lastSyncAt", "lastResult", "lastError", "lastErrorAt"]);
  $("token").value = s.pairingToken || "";
  $("auto").checked = !!s.autoSync;
  const dot = $("dot");
  dot.className = "dot";
  let txt = "Aguardando primeira sincronizacao.";
  if (s.lastError) {
    dot.classList.add("err");
    txt = `Erro em ${new Date(s.lastErrorAt || Date.now()).toLocaleString()}\n${s.lastError}`;
  } else if (s.lastSyncAt) {
    dot.classList.add("ok");
    const r = s.lastResult || {};
    txt = `Ultimo sync: ${new Date(s.lastSyncAt).toLocaleString()}\nRecebidos: ${r.received ?? "-"}  Atualizados: ${r.upserted ?? "-"}  Erros: ${r.errors ?? 0}`;
  }
  $("status").textContent = txt;
}

$("save").addEventListener("click", async () => {
  const token = $("token").value.trim();
  await chrome.storage.local.set({ pairingToken: token, lastError: null });
  $("status").textContent = "Token salvo.";
});

$("sync").addEventListener("click", async () => {
  $("sync").disabled = true;
  $("status").textContent = "Sincronizando...";
  chrome.runtime.sendMessage({ type: "SYNC_NOW" }, async (resp) => {
    $("sync").disabled = false;
    if (!resp?.ok) $("status").textContent = `Erro: ${resp?.error || "desconhecido"}`;
    await refresh();
  });
});

$("auto").addEventListener("change", (e) => {
  chrome.runtime.sendMessage({ type: "SET_AUTO", enabled: e.target.checked });
});

refresh();

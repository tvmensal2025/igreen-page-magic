const $ = (id) => document.getElementById(id);

function fmt(n) { return typeof n === "number" ? n.toLocaleString("pt-BR") : (n ?? "-"); }

async function refresh() {
  const s = await chrome.storage.local.get([
    "pairingToken", "autoSync", "lastSyncAt", "lastResult", "lastError", "lastErrorAt",
    "lastClientesSize", "lastRedeSize",
  ]);
  $("token").value = s.pairingToken || "";
  $("auto").checked = !!s.autoSync;
  const dot = $("dot");
  dot.className = "dot";
  let txt = "Aguardando primeira sincronizacao.";
  if (s.lastError && !s.lastSyncAt) {
    dot.classList.add("err");
    txt = `Erro em ${new Date(s.lastErrorAt || Date.now()).toLocaleString()}\n${s.lastError}`;
  } else if (s.lastSyncAt) {
    dot.classList.add(s.lastError ? "err" : "ok");
    const r = s.lastResult || {};
    const c = r.clientes, n = r.rede;
    const parts = [`Ultimo sync: ${new Date(s.lastSyncAt).toLocaleString()}`];
    if (c) parts.push(`Clientes: ${fmt(c.upserted)} atualizados (de ${fmt(c.received)}, erros ${fmt(c.errors)})`);
    if (n) parts.push(`Rede: ${fmt(n.upserted)} atualizados (de ${fmt(n.received)}, erros ${fmt(n.errors)})`);
    if (s.lastError) parts.push(`Avisos: ${s.lastError}`);
    txt = parts.join("\n");
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
  $("status").textContent = "Sincronizando... (abrindo abas do portal, pode demorar ate 1min)";
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

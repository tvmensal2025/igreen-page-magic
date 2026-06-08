const $ = (id) => document.getElementById(id);

const MOTIVATIONS = [
  "Cada sync acende um novo cliente solar.",
  "Energia limpa comeca com dados limpos.",
  "Voce esta a um clique de iluminar mais lares.",
  "Sol no painel, dados na nuvem.",
  "Pequenos syncs, grandes economias.",
  "Sua rede cresce junto com o planeta.",
  "Cada cliente sincronizado e um passo verde.",
];

function pickMotivation() {
  return MOTIVATIONS[Math.floor(Math.random() * MOTIVATIONS.length)];
}

function fmt(n) { return typeof n === "number" ? n.toLocaleString("pt-BR") : (n ?? "-"); }

async function saveToken() {
  const token = $("token").value.trim();
  await chrome.storage.local.set({ pairingToken: token });
}

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

// Auto-save token on blur and on input changes (debounced)
let saveTimer;
$("token").addEventListener("input", () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveToken, 400);
});
$("token").addEventListener("blur", saveToken);

$("sync").addEventListener("click", async () => {
  await saveToken();
  const token = $("token").value.trim();
  if (!token) {
    $("status").textContent = "Cole o token de pareamento antes de sincronizar.";
    return;
  }
  $("sync").disabled = true;
  $("motivation").textContent = pickMotivation();
  $("status").textContent = "Sincronizando... abrindo Clientes primeiro, depois Rede. Pode levar 1 a 2 min.";
  chrome.runtime.sendMessage({ type: "SYNC_NOW" }, async (resp) => {
    $("sync").disabled = false;
    if (!resp?.ok) $("status").textContent = `Erro: ${resp?.error || "desconhecido"}`;
    await refresh();
  });
});

$("auto").addEventListener("change", (e) => {
  chrome.runtime.sendMessage({ type: "SET_AUTO", enabled: e.target.checked });
});

$("motivation").textContent = pickMotivation();
refresh();

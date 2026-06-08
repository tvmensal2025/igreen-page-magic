const $ = (id) => document.getElementById(id);

const MOTIVATIONS = [
  "Cada sync acende um novo cliente solar.",
  "Energia limpa começa com dados limpos.",
  "Você está a um clique de iluminar mais lares.",
  "Sol no painel, dados na nuvem.",
  "Pequenos syncs, grandes economias.",
  "Sua rede cresce junto com o planeta.",
  "Cada cliente sincronizado é um passo verde.",
];

function pickMotivation() {
  return MOTIVATIONS[Math.floor(Math.random() * MOTIVATIONS.length)];
}

function fmt(n) { return typeof n === "number" ? n.toLocaleString("pt-BR") : (n ?? "-"); }

function maskToken(token) {
  if (!token) return "••••••••";
  const head = token.slice(0, 6);
  return `${head}${"•".repeat(Math.max(8, Math.min(20, token.length - 6)))}`;
}

function setBadge(kind, text) {
  const b = $("badge");
  b.className = `status-badge ${kind}`;
  $("badgeText").textContent = text;
}

function showTokenSaved(token) {
  $("tokenSaved").classList.remove("hidden");
  $("tokenEmpty").classList.add("hidden");
  $("tokenPreview").textContent = maskToken(token);
}

function showTokenEmpty(prefill = "") {
  $("tokenSaved").classList.add("hidden");
  $("tokenEmpty").classList.remove("hidden");
  $("tokenInput").value = prefill;
  $("tokenInput").focus();
}

async function refresh() {
  const s = await chrome.storage.local.get([
    "pairingToken", "autoSync", "lastSyncAt", "lastResult", "lastError", "lastErrorAt",
  ]);
  const token = s.pairingToken || "";
  if (token) {
    showTokenSaved(token);
    if (s.lastError && !s.lastSyncAt) setBadge("err", "Erro no último sync");
    else if (s.lastSyncAt) setBadge(s.lastError ? "warn" : "ok", s.lastError ? "Sincronizado com avisos" : "Pareado e atualizado");
    else setBadge("ok", "Pareado");
  } else {
    showTokenEmpty();
    setBadge("warn", "Não pareado");
  }
  $("auto").checked = !!s.autoSync;

  let txt = "Aguardando primeira sincronização.";
  if (s.lastError && !s.lastSyncAt) {
    txt = `Erro em ${new Date(s.lastErrorAt || Date.now()).toLocaleString()}\n${s.lastError}`;
  } else if (s.lastSyncAt) {
    const r = s.lastResult || {};
    const c = r.clientes, n = r.rede;
    const parts = [`Último sync: ${new Date(s.lastSyncAt).toLocaleString()}`];
    if (c) parts.push(`Clientes: ${fmt(c.upserted)} atualizados (de ${fmt(c.received)}, erros ${fmt(c.errors)})`);
    if (n) parts.push(`Rede: ${fmt(n.upserted)} atualizados (de ${fmt(n.received)}, erros ${fmt(n.errors)})`);
    if (s.lastError) parts.push(`Avisos: ${s.lastError}`);
    txt = parts.join("\n");
  }
  $("status").textContent = txt;
}

// Token actions
$("saveToken").addEventListener("click", async () => {
  const t = $("tokenInput").value.trim();
  if (!t) return;
  await chrome.storage.local.set({ pairingToken: t });
  refresh();
});
$("cancelToken").addEventListener("click", async () => {
  const { pairingToken } = await chrome.storage.local.get(["pairingToken"]);
  if (pairingToken) showTokenSaved(pairingToken);
});
$("changeToken").addEventListener("click", () => showTokenEmpty());
$("removeToken").addEventListener("click", async () => {
  if (!confirm("Remover o token? A extensão deixará de sincronizar até você pareá-la novamente.")) return;
  await chrome.storage.local.remove(["pairingToken"]);
  refresh();
});

let progressTimer = null;
async function pollProgress() {
  const { syncProgress } = await chrome.storage.local.get(["syncProgress"]);
  if (syncProgress?.step) $("status").textContent = `${syncProgress.step}`;
}

$("sync").addEventListener("click", async () => {
  const { pairingToken } = await chrome.storage.local.get(["pairingToken"]);
  if (!pairingToken) {
    $("status").textContent = "Cole o token de pareamento antes de sincronizar.";
    showTokenEmpty();
    return;
  }
  $("sync").disabled = true;
  $("syncText").textContent = "Sincronizando...";
  setBadge("busy", "Sincronizando");
  $("motivation").textContent = pickMotivation();
  $("status").textContent = "Iniciando sincronização... (Clientes → Rede, um por vez)";
  await chrome.storage.local.set({ syncProgress: { step: "Iniciando...", at: Date.now() } });
  progressTimer = setInterval(pollProgress, 800);
  chrome.runtime.sendMessage({ type: "SYNC_NOW" }, async (resp) => {
    clearInterval(progressTimer); progressTimer = null;
    $("sync").disabled = false;
    $("syncText").textContent = "Sincronizar agora";
    if (!resp?.ok) $("status").textContent = `Erro: ${resp?.error || "desconhecido"}`;
    await refresh();
  });
});

$("auto").addEventListener("change", (e) => {
  chrome.runtime.sendMessage({ type: "SET_AUTO", enabled: e.target.checked });
});

$("motivation").textContent = pickMotivation();
refresh();

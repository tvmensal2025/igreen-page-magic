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

function setBadge(kind, text) {
  const b = $("badge");
  b.className = `status-badge ${kind}`;
  $("badgeText").textContent = text;
}

// Mostra estado "pareado" — nunca exibe o token, só confirma que está salvo.
function showTokenSaved() {
  $("tokenSaved").classList.remove("hidden");
  $("tokenEmpty").classList.add("hidden");
}

// Mostra estado "colar chave" — campo vazio, escondido por padrão.
function showTokenEmpty() {
  $("tokenSaved").classList.add("hidden");
  $("tokenEmpty").classList.remove("hidden");
  $("tokenInput").value = "";
  $("tokenInput").focus();
}

async function refresh() {
  const s = await chrome.storage.local.get([
    "pairingToken", "autoSync", "lastSyncAt", "lastResult", "lastError", "lastErrorAt",
    "syncRunning", "syncProgress",
  ]);
  const token = s.pairingToken || "";
  if (token) {
    showTokenSaved();
    if (s.syncRunning) setBadge("busy", "Sincronizando em background");
    else if (s.lastError && !s.lastSyncAt) setBadge("err", "Erro no último sync");
    else if (s.lastSyncAt) setBadge(s.lastError ? "warn" : "ok", s.lastError ? "Sincronizado com avisos" : "Pareado e atualizado");
    else setBadge("ok", "Pareado");
  } else {
    showTokenEmpty();
    setBadge("warn", "Não pareado");
  }
  $("auto").checked = !!s.autoSync;

  let txt = "Aguardando primeira sincronização.";
  if (s.syncRunning) {
    txt = `${s.syncProgress?.step || "Sincronizando..."}\n\nPode fechar esta janela — o sync continua em background. Você receberá uma notificação quando terminar.`;
  } else if (s.lastError && !s.lastSyncAt) {
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

  // Botão fica desabilitado enquanto há sync rodando no background
  $("sync").disabled = !!s.syncRunning;
  $("syncText").textContent = s.syncRunning ? "Sincronizando..." : "Sincronizar agora";
  if (s.syncRunning) $("syncIcon").classList.add("spin");
  else $("syncIcon").classList.remove("spin");
}

// Salva o token automaticamente assim que for colado/digitado.
// Limpa o campo na hora para que a chave nunca fique visível na tela.
async function autoSaveToken(value) {
  const t = (value || "").trim();
  if (!t) return;
  await chrome.storage.local.set({ pairingToken: t });
  $("tokenInput").value = "";
  $("status").textContent = "Chave salva. Pronto para sincronizar.";
  await refresh();
}

// Ao colar: salva imediatamente (caminho principal de pareamento).
$("tokenInput").addEventListener("paste", (e) => {
  const pasted = (e.clipboardData || window.clipboardData)?.getData("text") || "";
  if (pasted.trim()) {
    e.preventDefault();
    autoSaveToken(pasted);
  }
});

// Ao digitar manualmente e sair do campo (ou apertar Enter): salva também.
$("tokenInput").addEventListener("blur", (e) => autoSaveToken(e.target.value));
$("tokenInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); autoSaveToken(e.target.value); }
});

// Desconectar: remove a chave salva.
$("removeToken").addEventListener("click", async () => {
  if (!confirm("Desconectar a extensão? Ela deixará de sincronizar até você colar a chave novamente.")) return;
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
    $("status").textContent = "Cole a chave do painel antes de sincronizar.";
    showTokenEmpty();
    return;
  }
  $("sync").disabled = true;
  $("syncText").textContent = "Sincronizando...";
  $("syncIcon").classList.add("spin");
  setBadge("busy", "Sincronizando");
  $("motivation").textContent = pickMotivation();
  $("status").textContent = "Iniciando sincronização... (Clientes → Rede, um por vez)";
  await chrome.storage.local.set({ syncProgress: { step: "Iniciando...", at: Date.now() } });
  progressTimer = setInterval(pollProgress, 800);
  chrome.runtime.sendMessage({ type: "SYNC_NOW" }, async (resp) => {
    clearInterval(progressTimer); progressTimer = null;
    $("sync").disabled = false;
    $("syncText").textContent = "Sincronizar agora";
    $("syncIcon").classList.remove("spin");
    if (!resp?.ok) $("status").textContent = `Erro: ${resp?.error || "desconhecido"}`;
    await refresh();
  });
});

$("auto").addEventListener("change", (e) => {
  chrome.runtime.sendMessage({ type: "SET_AUTO", enabled: e.target.checked });
});

$("motivation").textContent = pickMotivation();
refresh();

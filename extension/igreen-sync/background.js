// iGreen Sync — service worker
const INGEST_URL = "https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/igreen-ingest-customers";
const IGREEN_ORIGIN = "https://app.igreenenergia.com.br";
const CUSTOMER_MAP_PATH = "/customer-map";
const ALARM_NAME = "igreen-sync-auto";

async function fetchCustomersFromPortal() {
  // Tenta endpoints conhecidos do portal. O navegador anexa cookies de sessao.
  const candidates = [
    `${IGREEN_ORIGIN}${CUSTOMER_MAP_PATH}`,
    `${IGREEN_ORIGIN}/api${CUSTOMER_MAP_PATH}`,
    `${IGREEN_ORIGIN}/customer/list`,
  ];
  let lastErr = "no_endpoint";
  for (const url of candidates) {
    try {
      const res = await fetch(url, { method: "GET", credentials: "include", headers: { Accept: "application/json" } });
      if (!res.ok) { lastErr = `HTTP ${res.status} em ${url}`; continue; }
      const ct = res.headers.get("content-type") || "";
      if (!ct.includes("json")) { lastErr = `Resposta nao-JSON em ${url}`; continue; }
      const data = await res.json();
      const list = Array.isArray(data) ? data
        : Array.isArray(data?.customers) ? data.customers
        : Array.isArray(data?.data) ? data.data
        : Array.isArray(data?.result) ? data.result
        : null;
      if (list) return { ok: true, customers: list, source: url };
      lastErr = `Formato inesperado em ${url}`;
    } catch (e) {
      lastErr = e?.message || String(e);
    }
  }
  return { ok: false, error: lastErr };
}

async function sendToCloud(token, customers) {
  const res = await fetch(INGEST_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-pairing-token": token },
    body: JSON.stringify({ customers }),
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

async function runSync() {
  const { pairingToken } = await chrome.storage.local.get(["pairingToken"]);
  if (!pairingToken) throw new Error("Token de pareamento nao configurado");
  const fetched = await fetchCustomersFromPortal();
  if (!fetched.ok) throw new Error(`Falha ao ler portal: ${fetched.error}. Voce esta logado em ${IGREEN_ORIGIN}?`);
  const result = await sendToCloud(pairingToken, fetched.customers);
  const status = {
    lastSyncAt: new Date().toISOString(),
    lastResult: result,
    lastSource: fetched.source,
    lastError: null,
  };
  await chrome.storage.local.set(status);
  return status;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "SYNC_NOW") {
    runSync()
      .then((s) => sendResponse({ ok: true, status: s }))
      .catch(async (err) => {
        await chrome.storage.local.set({ lastError: err.message, lastErrorAt: new Date().toISOString() });
        sendResponse({ ok: false, error: err.message });
      });
    return true;
  }
  if (msg?.type === "SET_AUTO") {
    (async () => {
      await chrome.storage.local.set({ autoSync: !!msg.enabled });
      if (msg.enabled) {
        chrome.alarms.create(ALARM_NAME, { periodInMinutes: 60 * 6 });
      } else {
        chrome.alarms.clear(ALARM_NAME);
      }
      sendResponse({ ok: true });
    })();
    return true;
  }
});

chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== ALARM_NAME) return;
  try { await runSync(); } catch (e) { console.error("[auto-sync]", e); }
});

chrome.runtime.onInstalled.addListener(async () => {
  const { autoSync } = await chrome.storage.local.get(["autoSync"]);
  if (autoSync) chrome.alarms.create(ALARM_NAME, { periodInMinutes: 60 * 6 });
});

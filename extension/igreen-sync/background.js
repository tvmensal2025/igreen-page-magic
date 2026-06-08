// iGreen Sync — service worker (v1.1)
// Estrategia: abre /mapa-clientes e /mapa-rede, injeta interceptor de fetch/XHR
// no MAIN world e clica no botao "Exportar Excel". Captura o blob XLSX e envia
// pra edge function igreen-ingest-xlsx em base64.

const INGEST_URL = "https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/igreen-ingest-xlsx";
const IGREEN_ORIGIN = "https://escritorio.igreenenergy.com.br";
const PAGES = [
  { kind: "clientes", path: "/mapa-clientes" },
  { kind: "rede",     path: "/mapa-rede" },
];
const ALARM_NAME = "igreen-sync-auto";
const CAPTURE_TIMEOUT_MS = 60000;

// ===== Helpers gerais =====
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isIgreenExportUrl(u) {
  try {
    const url = new URL(u, IGREEN_ORIGIN);
    if (!/igreenenergy\.com\.br$/i.test(url.hostname)) return false;
    return /export|xlsx|excel|download|relatorio/i.test(url.pathname + url.search);
  } catch { return false; }
}

async function blobToBase64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, buf.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

// ===== Funcao injetada no MAIN world =====
// Patcheia fetch / XHR / createObjectURL. Quando captura um xlsx, marca
// window.__igreenCaptured = base64 e o background faz polling pra ler.
function injectInterceptor() {
  if (window.__igreenInterceptorInstalled) return true;
  window.__igreenInterceptorInstalled = true;
  window.__igreenCaptured = null;
  window.__igreenLog = [];
  const log = (m) => { try { window.__igreenLog.push(`${Date.now()} ${m}`); } catch {} };

  const isXlsxCt = (ct) => /sheet|excel|xlsx|spreadsheet|octet-stream|ms-excel/i.test(ct || "");
  const isXlsxUrl = (u) => /export|xlsx|excel|download|relatorio/i.test(u || "");
  const isXlsxBlob = (b) => b && b.size > 200 &&
    (/sheet|excel|xlsx|octet|ms-excel/i.test(b.type || "") || b.size > 1000);

  const blobToB64 = (blob) => new Promise((resolve) => {
    const r = new FileReader();
    r.onloadend = () => {
      const s = String(r.result || "");
      resolve(s.includes(",") ? s.split(",")[1] : "");
    };
    r.readAsDataURL(blob);
  });

  const setCaptured = async (blob, source) => {
    if (window.__igreenCaptured) return;
    try {
      const b64 = await blobToB64(blob);
      if (b64 && b64.length > 100) {
        window.__igreenCaptured = { b64, size: blob.size, source: source || "", type: blob.type || "" };
        log(`captured ${blob.size}B from ${source}`);
      }
    } catch (e) { log("blobToB64 err " + e); }
  };

  // fetch
  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await origFetch.apply(this, args);
    try {
      const url = typeof args[0] === "string" ? args[0] : (args[0] && args[0].url) || "";
      const ct = res.headers.get("content-type") || "";
      if (isXlsxCt(ct) || isXlsxUrl(url)) {
        const clone = res.clone();
        clone.blob().then((b) => { if (isXlsxBlob(b)) setCaptured(b, url); }).catch(() => {});
      }
    } catch {}
    return res;
  };

  // XHR
  const OrigXHR = window.XMLHttpRequest;
  function PatchedXHR() {
    const xhr = new OrigXHR();
    let _url = "";
    const origOpen = xhr.open;
    xhr.open = function (m, u) { _url = u; return origOpen.apply(xhr, arguments); };
    xhr.addEventListener("load", () => {
      try {
        const ct = xhr.getResponseHeader && xhr.getResponseHeader("content-type") || "";
        if (!isXlsxCt(ct) && !isXlsxUrl(_url)) return;
        let blob = null;
        const resp = xhr.response;
        if (resp instanceof Blob) blob = resp;
        else if (resp instanceof ArrayBuffer) blob = new Blob([resp]);
        else if (typeof resp === "string" && resp.length > 1000) {
          // ultima tentativa: bytes em string
          const buf = new Uint8Array(resp.length);
          for (let i = 0; i < resp.length; i++) buf[i] = resp.charCodeAt(i) & 0xff;
          blob = new Blob([buf]);
        }
        if (isXlsxBlob(blob)) setCaptured(blob, _url);
      } catch (e) { log("xhr load err " + e); }
    });
    return xhr;
  }
  PatchedXHR.prototype = OrigXHR.prototype;
  window.XMLHttpRequest = PatchedXHR;

  // createObjectURL — captura blobs gerados client-side
  const origCreate = URL.createObjectURL;
  URL.createObjectURL = function (obj) {
    try { if (obj instanceof Blob && isXlsxBlob(obj)) setCaptured(obj, "blob:createObjectURL"); } catch {}
    return origCreate.call(this, obj);
  };

  return true;
}

function clickExportButton() {
  const matches = ["exportar excel", "exportar excell", "exportar planilha", "exportar xlsx", "baixar excel", "download excel"];
  const all = Array.from(document.querySelectorAll('button, a, [role="button"], span, div'));
  for (const el of all) {
    const t = (el.textContent || "").trim().toLowerCase();
    if (!t) continue;
    if (matches.some((m) => t === m || (t.length < 60 && t.includes(m)))) {
      try {
        el.scrollIntoView({ behavior: "instant", block: "center" });
        el.click();
        // alguns botoes precisam de event MouseEvent
        el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
        return { ok: true, text: t.slice(0, 80) };
      } catch (e) { return { ok: false, err: String(e) }; }
    }
  }
  return { ok: false, err: "botao nao encontrado" };
}

function readCaptured() {
  return window.__igreenCaptured || null;
}

// ===== Captura via chrome.downloads (fallback p/ links <a href> diretos) =====
// Mantemos um listener global ativo durante runSync que enfileira downloads
// vindos do dominio iGreen e os mapeia por tabId.
const downloadsByTab = new Map(); // tabId -> [{id, url, finalUrl}]
let downloadsListenerInstalled = false;
function installDownloadsListener() {
  if (downloadsListenerInstalled) return;
  downloadsListenerInstalled = true;
  chrome.downloads.onCreated.addListener((item) => {
    try {
      const url = item.finalUrl || item.url || "";
      if (!isIgreenExportUrl(url) && !/xlsx|excel|sheet/i.test(item.mime || "") && !/xlsx|excel/i.test(item.filename || "")) return;
      // tenta atribuir ao tab atualmente ativo (chrome nao da tabId direto)
      const tabId = item.tabId ?? -1;
      if (!downloadsByTab.has(tabId)) downloadsByTab.set(tabId, []);
      downloadsByTab.get(tabId).push({ id: item.id, url });
      // cancela pra evitar arquivo no disco do usuario
      chrome.downloads.cancel(item.id).catch(() => {});
      chrome.downloads.erase({ id: item.id }).catch(() => {});
    } catch (e) { console.warn("[downloads]", e); }
  });
}

async function fetchAsBase64(url) {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
  const blob = await res.blob();
  if (!blob || blob.size < 200) throw new Error(`Resposta vazia (${blob?.size || 0}B)`);
  // converte sem FileReader (service worker tem)
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, buf.subarray(i, i + CHUNK));
  }
  return { b64: btoa(bin), size: blob.size };
}

// ===== Gerencia tabs =====
async function openOrFocusTab(url) {
  const all = await chrome.tabs.query({ url: `${IGREEN_ORIGIN}/*` });
  const match = all.find((t) => (t.url || "").startsWith(url));
  if (match) {
    await chrome.tabs.update(match.id, { active: false });
    if (!(match.url || "").startsWith(url)) {
      await chrome.tabs.update(match.id, { url });
      await waitForTabComplete(match.id);
    }
    return match.id;
  }
  const created = await chrome.tabs.create({ url, active: false });
  await waitForTabComplete(created.id);
  return created.id;
}

function waitForTabComplete(tabId, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = async () => {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.status === "complete") return resolve();
      } catch (e) { return reject(e); }
      if (Date.now() - t0 > timeoutMs) return reject(new Error("timeout carregando aba"));
      setTimeout(tick, 400);
    };
    tick();
  });
}

async function captureFromPage(tabId, kind) {
  // instala interceptor MAIN world
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: injectInterceptor,
  });

  // espera SPA renderizar
  await sleep(2500);

  // clica botao
  const clickRes = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: clickExportButton,
  });
  const cinfo = clickRes?.[0]?.result;

  // polling pelo blob capturado
  const t0 = Date.now();
  let captured = null;
  while (Date.now() - t0 < CAPTURE_TIMEOUT_MS) {
    // 1) tenta MAIN-world capture
    const r = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: readCaptured,
    });
    captured = r?.[0]?.result;
    if (captured?.b64) return { ok: true, ...captured, via: "main-world", click: cinfo };

    // 2) tenta downloads pendentes
    const queued = downloadsByTab.get(tabId) || downloadsByTab.get(-1) || [];
    if (queued.length) {
      const item = queued.shift();
      try {
        const { b64, size } = await fetchAsBase64(item.url);
        return { ok: true, b64, size, source: item.url, via: "downloads", click: cinfo };
      } catch (e) {
        console.warn("[fetch fallback]", e);
      }
    }

    await sleep(700);
  }

  // logs do MAIN world pra debug
  let mainLog = [];
  try {
    const lg = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: () => window.__igreenLog || [],
    });
    mainLog = lg?.[0]?.result || [];
  } catch {}

  return {
    ok: false,
    error: `Timeout capturando XLSX de ${kind}. Clique: ${cinfo?.ok ? `OK (${cinfo.text})` : `FALHOU (${cinfo?.err})`}. Log: ${mainLog.slice(-5).join(" | ")}`,
    via: null,
    click: cinfo,
  };
}

// ===== Envio pro Supabase =====
async function sendToCloud(token, payload) {
  const res = await fetch(INGEST_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-pairing-token": token },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

// ===== Sync principal =====
async function runSync() {
  const { pairingToken } = await chrome.storage.local.get(["pairingToken"]);
  if (!pairingToken) throw new Error("Token de pareamento nao configurado");

  installDownloadsListener();
  downloadsByTab.clear();

  // confere login: tenta abrir home; se redirecionar para login, avisa
  // (a captura ja vai falhar com mensagem clara se nao tiver logado)

  const results = {};
  const errors = [];

  for (const page of PAGES) {
    const url = `${IGREEN_ORIGIN}${page.path}`;
    try {
      const tabId = await openOrFocusTab(url);
      const cap = await captureFromPage(tabId, page.kind);
      if (!cap.ok) {
        errors.push(`${page.kind}: ${cap.error}`);
        continue;
      }
      results[page.kind] = cap;
    } catch (e) {
      errors.push(`${page.kind}: ${e?.message || String(e)}`);
    }
  }

  if (!results.clientes && !results.rede) {
    throw new Error(
      `Nao consegui baixar nenhum Excel.\n${errors.join("\n")}\n\nVerifique se voce esta logado em ${IGREEN_ORIGIN}.`
    );
  }

  const payload = {
    mes_ref: new Date().toISOString().slice(0, 7),
  };
  if (results.clientes) payload.clientes_b64 = results.clientes.b64;
  if (results.rede) payload.rede_b64 = results.rede.b64;

  const ingest = await sendToCloud(pairingToken, payload);

  const status = {
    lastSyncAt: new Date().toISOString(),
    lastResult: ingest,
    lastError: errors.length ? errors.join(" | ") : null,
    lastClientesSize: results.clientes?.size || 0,
    lastRedeSize: results.rede?.size || 0,
  };
  await chrome.storage.local.set(status);
  return status;
}

// ===== Mensagens =====
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
      if (msg.enabled) chrome.alarms.create(ALARM_NAME, { periodInMinutes: 60 * 6 });
      else chrome.alarms.clear(ALARM_NAME);
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
  installDownloadsListener();
  const { autoSync } = await chrome.storage.local.get(["autoSync"]);
  if (autoSync) chrome.alarms.create(ALARM_NAME, { periodInMinutes: 60 * 6 });
});

chrome.runtime.onStartup.addListener(() => {
  installDownloadsListener();
});

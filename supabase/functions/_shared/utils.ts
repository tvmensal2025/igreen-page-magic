// ─── Normalização canônica de telefone (chave WA: 55+DDD+número, SEM forçar o 9) ─
// Completar o 9º dígito é só no envio Velip (`toVelipBRDest`).
export function normalizePhone(raw: string): string {
  let digits = raw.replace(/\D/g, "").replace(/^0+/, "");
  if (!digits) return "";
  // DDD + número (10–11) → prepende 55
  if (digits.length >= 10 && digits.length <= 11) return `55${digits}`;
  // Já canônico 12 (fixo/legado) ou 13 (celular)
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) return digits;
  // Lixo 14+ com 55: corta no celular/fixo plausível (não grava concatenação)
  if (digits.startsWith("55") && digits.length > 13) {
    const asMobile = digits.slice(0, 13);
    if (asMobile[4] === "9") return asMobile;
    return digits.slice(0, 12);
  }
  return digits;
}

/**
 * Telefone BR plausível p/ WhatsApp (12 fixo legado ou 13 celular).
 * Rejeita concatenação / país errado com 55 na frente (ex.: +91 gravado como 5591…).
 */
export function isPlausibleBrWhatsAppPhone(raw: string | null | undefined): boolean {
  const d = normalizePhone(String(raw || ""));
  if (!d.startsWith("55")) return false;
  if (d.length !== 12 && d.length !== 13) return false;
  const ddd = Number(d.slice(2, 4));
  if (!Number.isFinite(ddd) || ddd < 11 || ddd > 99) return false;
  // Celular canônico: 13 dígitos com 9 após o DDD.
  if (d.length === 13) return d[4] === "9";
  // 12 dígitos: fixo ou móvel antigo (8 após DDD) — 1º dígito local 2–9.
  const localFirst = Number(d[4]);
  return localFirst >= 2 && localFirst <= 9;
}

// ─── Timeouts (ms) para evitar travamentos ──────────────────────────────
export const TIMEOUT_VIA_CEP = 6_000;    // 6s (era 10s)
export const TIMEOUT_FETCH_IMAGE = 15_000; // 15s (era 30s)
export const TIMEOUT_GEMINI = 30_000;      // 30s (era 50s) — Gemini 2.5 Flash responde em <10s normalmente
export const TIMEOUT_WHAPI = 12_000;       // 12s (era 20s)
export const TIMEOUT_EVOLUTION = 12_000;   // 12s (era 20s)

// ─── Log estruturado (para troubleshooting) ──────────────────────────────
export function logStructured(
  level: "info" | "warn" | "error",
  action: string,
  data: { customer_id?: string; step?: string; error?: string; [k: string]: unknown }
) {
  const payload = { level, action, ts: new Date().toISOString(), ...data };
  console.log(JSON.stringify(payload));
}

// ─── fetch com timeout ───────────────────────────────────────────────────
export async function fetchWithTimeout(
  url: string,
  init: RequestInit & { timeout?: number } = {}
): Promise<Response> {
  const timeout = init.timeout ?? 30_000;
  const { timeout: _t, ...rest } = init;
  return fetch(url, { ...rest, signal: AbortSignal.timeout(timeout) });
}

// ─── fetch inseguro (aceita certificados auto-assinados) ─────────────────
// Usado para conectar ao worker VPS via IP com certificado auto-assinado
export async function fetchInsecure(
  url: string,
  init: RequestInit & { timeout?: number } = {}
): Promise<Response> {
  const timeout = init.timeout ?? 30_000;
  const { timeout: _t, ...rest } = init;
  try {
    // Deno suporta client customizado para ignorar SSL
    const client = (Deno as any).createHttpClient({ caCerts: [], certErrors: "ignore" });
    return await fetch(url, { ...rest, signal: AbortSignal.timeout(timeout), client });
  } catch {
    // Fallback: tenta fetch normal (pode falhar com SSL)
    return fetch(url, { ...rest, signal: AbortSignal.timeout(timeout) });
  }
}

// ─── Retry simples (para OCR e Whapi) ────────────────────────────────────
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: { maxAttempts?: number; delayMs?: number; retryOn?: (e: unknown) => boolean } = {}
): Promise<T> {
  const { maxAttempts = 2, delayMs = 500, retryOn = () => true } = options;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (attempt < maxAttempts && retryOn(e)) {
        await new Promise((r) => setTimeout(r, delayMs));
      } else {
        throw e;
      }
    }
  }
  throw lastError;
}

// ─── Buscar CEP por endereço via ViaCEP (reverse lookup) ─────────────────
// Evita CEPs genéricos (terminam em 000) — são sectores da cidade, não da rua.
export async function buscarCepPorEndereco(estado: string, cidade: string, rua: string): Promise<string> {
  if (!estado || !cidade || !rua) return "";
  let ruaLimpa = rua.trim()
    .replace(/^(R\.|R |RUA |AV\.|AV |AVENIDA |AL\.|AL |ALAMEDA |TV\.|TV |TRAVESSA |PÇ\.|PÇ |PRAÇA |ROD\.|ROD |RODOVIA )/i, "")
    .trim();
  if (ruaLimpa.length < 3) ruaLimpa = rua.trim();
  const uf = estado.trim().substring(0, 2).toUpperCase();
  const cidadeLimpa = cidade.trim();
  try {
    const url = `https://viacep.com.br/ws/${encodeURIComponent(uf)}/${encodeURIComponent(cidadeLimpa)}/${encodeURIComponent(ruaLimpa)}/json/`;
    console.log(`🔍 Buscando CEP: ${url}`);
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_VIA_CEP) });
    if (!res.ok) return "";
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return "";

    // Preferir CEP que NÃO termina em 000 (CEP genérico de setor, não específico da rua)
    const ruaLower = ruaLimpa.toLowerCase();
    const comSufixo = data.filter((item: any) => item.cep && !/000$/.test(item.cep.replace("-", "")));
    const candidatos = comSufixo.length > 0 ? comSufixo : data;

    // Entre os candidatos, preferir logradouro que contenha o nome da rua
    const melhor = candidatos.find((item: any) =>
      item.logradouro && item.logradouro.toLowerCase().includes(ruaLower.substring(0, Math.min(ruaLower.length, 8)))
    ) || candidatos[0];

    if (melhor?.cep) {
      const cepEncontrado = melhor.cep.replace("-", "");
      // Se só restaram CEPs 000, não usar — pedir ao usuário
      if (/000$/.test(cepEncontrado)) {
        console.warn(`⚠️ ViaCEP retornou só CEPs genéricos (000). Não auto-preenchendo.`);
        return "";
      }
      console.log(`✅ CEP via ViaCEP: ${cepEncontrado} (${melhor.logradouro})`);
      return cepEncontrado;
    }
  } catch (e: any) {
    console.warn(`⚠️ Erro buscando CEP por endereço: ${e.message}`);
  }
  return "";
}

// ─── Buscar endereço por CEP via ViaCEP (forward lookup) ─────────────────
// Retorna { logradouro, bairro, localidade, uf } ou null se inválido/erro.
// CEP genérico (termina em 000) ainda retorna cidade/UF — preenche o que dá.
export interface EnderecoViaCep {
  cep: string;
  logradouro: string;
  bairro: string;
  localidade: string;
  uf: string;
}

export async function buscarEnderecoPorCep(cep: string): Promise<EnderecoViaCep | null> {
  const cepClean = String(cep || "").replace(/\D/g, "");
  if (cepClean.length !== 8) return null;
  try {
    const url = `https://viacep.com.br/ws/${cepClean}/json/`;
    console.log(`🔍 ViaCEP forward lookup: ${url}`);
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_VIA_CEP) });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || data.erro) return null;
    return {
      cep: cepClean,
      logradouro: String(data.logradouro || "").trim(),
      bairro: String(data.bairro || "").trim(),
      localidade: String(data.localidade || "").trim(),
      uf: String(data.uf || "").trim().toUpperCase(),
    };
  } catch (e: any) {
    console.warn(`⚠️ Erro ViaCEP forward: ${e?.message}`);
    return null;
  }
}

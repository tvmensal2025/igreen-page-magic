/**
 * Download seguro de imagem para pipelines de criativo (QA visual, validador).
 *
 * Substitui o `fetch(image_url)` arbitrário, que era um SSRF: a edge function
 * roda dentro da infra e alcançaria `localhost`, rede interna e o endpoint de
 * metadados da cloud (169.254.169.254) se a URL viesse envenenada.
 *
 * Defesas, em ordem:
 *  1. Só `https:` — sem `http:`, `file:`, `data:`, `gopher:`.
 *  2. Sem credenciais embutidas (`https://user:pass@host`).
 *  3. Porta restrita a 443 (padrão) — evita varredura de portas internas.
 *  4. Host precisa estar na allowlist explícita (match exato de hostname).
 *  5. IP literal privado/loopback/link-local/metadata é sempre negado, mesmo
 *     que alguém coloque na allowlist por engano.
 *  6. `redirect: "error"` — allowlist não pode ser burlada via 302.
 *  7. Content-Type precisa ser `image/*`.
 *  8. Corte por STREAMING no limite de bytes: `content-length` é dica, não
 *     garantia, então o corpo é lido em chunks e abortado ao exceder.
 *  9. Timeout por AbortSignal.
 *
 * As funções de validação são puras e testáveis; a rede é injetável.
 */

export const DEFAULT_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const DEFAULT_IMAGE_TIMEOUT_MS = 15_000;

/** Envs que podem contribuir hosts. `AD_ASSET_ALLOWED_HOSTS` aceita lista CSV. */
const HOST_ENV_NAMES = [
  "SUPABASE_URL",
  "MINIO_PUBLIC_URL",
  "PUBLIC_MEDIA_BASE_URL",
] as const;

export type EnvReader = (name: string) => string | undefined;

const defaultEnvReader: EnvReader = (name) => Deno.env.get(name);

/**
 * Monta a allowlist de hosts a partir do ambiente.
 * Config inválida nunca amplia a lista — no pior caso ela fica vazia e o
 * download é negado (fail-closed).
 */
export function resolveAllowedAssetHosts(
  readEnv: EnvReader = defaultEnvReader,
): Set<string> {
  const hosts = new Set<string>();

  for (
    const candidate of (readEnv("AD_ASSET_ALLOWED_HOSTS") || "").split(",")
  ) {
    const value = candidate.trim().toLowerCase();
    if (value) hosts.add(value);
  }

  for (const envName of HOST_ENV_NAMES) {
    const value = (readEnv(envName) || "").trim();
    if (!value) continue;
    try {
      hosts.add(new URL(value).hostname.toLowerCase());
    } catch {
      // Valor não é URL — ignora sem derrubar a allowlist inteira.
    }
  }

  return hosts;
}

export class UnsafeAssetUrlError extends Error {
  readonly reason: string;
  constructor(reason: string, message: string) {
    super(message);
    this.name = "UnsafeAssetUrlError";
    this.reason = reason;
  }
}

function isPrivateIpv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  const octets = parts.map((part) => Number(part));
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false;
  }

  const [a, b] = octets;
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 0) return true; // "this network"
  if (a === 169 && b === 254) return true; // link-local + metadados cloud
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  if (a >= 224) return true; // multicast + reservado
  return false;
}

function isIpv4Literal(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

function isUnsafeIpv6(host: string): boolean {
  // `new URL()` entrega IPv6 entre colchetes.
  if (!host.startsWith("[") || !host.endsWith("]")) return false;
  const inner = host.slice(1, -1).toLowerCase();
  if (inner === "::1" || inner === "::") return true; // loopback / unspecified
  if (inner.startsWith("fe80")) return true; // link-local
  if (/^f[cd]/.test(inner)) return true; // unique local fc00::/7
  // IPv4 mapeado (::ffff:10.0.0.1) herda a checagem v4.
  const mapped = inner.match(/::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return isPrivateIpv4(mapped[1]);
  return false;
}

/**
 * Valida a URL contra a allowlist e as regras anti-SSRF.
 * Puro: não faz rede. Lança `UnsafeAssetUrlError` com motivo legível.
 */
export function assertSafeAssetUrl(
  raw: string,
  allowedHosts: Set<string>,
): URL {
  let url: URL;
  try {
    url = new URL(String(raw));
  } catch {
    throw new UnsafeAssetUrlError("invalid_url", "URL de imagem inválida");
  }

  if (url.protocol !== "https:") {
    throw new UnsafeAssetUrlError(
      "https_required",
      "URL de imagem precisa usar HTTPS",
    );
  }
  if (url.username || url.password) {
    throw new UnsafeAssetUrlError(
      "credentials_in_url",
      "URL de imagem não pode conter credenciais",
    );
  }
  if (url.port && url.port !== "443") {
    throw new UnsafeAssetUrlError(
      "port_not_allowed",
      "URL de imagem só pode usar a porta 443",
    );
  }

  const host = url.hostname.toLowerCase();
  if (isIpv4Literal(host) && isPrivateIpv4(host)) {
    throw new UnsafeAssetUrlError(
      "private_address",
      "endereço de rede interna não permitido",
    );
  }
  if (isUnsafeIpv6(host)) {
    throw new UnsafeAssetUrlError(
      "private_address",
      "endereço de rede interna não permitido",
    );
  }
  if (!allowedHosts.has(host)) {
    throw new UnsafeAssetUrlError(
      "host_not_allowed",
      "host de imagem não permitido",
    );
  }

  return url;
}

export interface SafeImage {
  url: string;
  mimeType: string;
  bytes: Uint8Array;
}

export interface FetchImageOptions {
  allowedHosts?: Set<string>;
  maxBytes?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  readEnv?: EnvReader;
}

/**
 * Lê o corpo cortando no limite. `content-length` pode mentir ou faltar
 * (chunked), então o teto real é aplicado sobre os bytes recebidos.
 */
async function readCapped(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  const body = response.body;
  if (!body) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.byteLength > maxBytes) {
      throw new UnsafeAssetUrlError("too_large", "imagem excede o limite");
    }
    return buffer;
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new UnsafeAssetUrlError("too_large", "imagem excede o limite");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
    // Não deixa conexão pendurada quando abortamos por tamanho.
    await body.cancel().catch(() => {});
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** Busca a imagem aplicando todas as defesas. Fail-closed por construção. */
export async function fetchImageSafely(
  rawUrl: string,
  options: FetchImageOptions = {},
): Promise<SafeImage> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_IMAGE_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_IMAGE_TIMEOUT_MS;
  const allowedHosts = options.allowedHosts ??
    resolveAllowedAssetHosts(options.readEnv);
  const doFetch = options.fetchImpl ?? fetch;

  const safeUrl = assertSafeAssetUrl(rawUrl, allowedHosts);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await doFetch(safeUrl, {
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new UnsafeAssetUrlError(
        "fetch_failed",
        `falha ao baixar imagem (HTTP ${response.status})`,
      );
    }

    const mimeType = (response.headers.get("content-type") || "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    if (!mimeType.startsWith("image/")) {
      throw new UnsafeAssetUrlError(
        "not_an_image",
        "conteúdo retornado não é uma imagem",
      );
    }

    const declared = Number(response.headers.get("content-length") || 0);
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new UnsafeAssetUrlError("too_large", "imagem excede o limite");
    }

    const bytes = await readCapped(response, maxBytes);
    if (bytes.byteLength === 0) {
      throw new UnsafeAssetUrlError("empty_body", "imagem vazia");
    }

    return { url: safeUrl.toString(), mimeType, bytes };
  } finally {
    clearTimeout(timer);
  }
}

/** base64 em chunks — evita estourar o stack com spread de array grande. */
export function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

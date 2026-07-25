import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  assertSafeAssetUrl,
  bytesToBase64,
  fetchImageSafely,
  resolveAllowedAssetHosts,
  UnsafeAssetUrlError,
} from "./safe-image-fetch.ts";

const HOSTS = new Set(["cdn.igreen.test", "1.2.3.4"]);

function assertRejectedUrl(raw: string, expectedReason: string) {
  const error = assertThrows(
    () => assertSafeAssetUrl(raw, HOSTS),
    UnsafeAssetUrlError,
  ) as UnsafeAssetUrlError;
  assertEquals(error.reason, expectedReason, `URL deveria ser negada: ${raw}`);
}

Deno.test("aceita apenas HTTPS em host da allowlist", () => {
  const url = assertSafeAssetUrl("https://cdn.igreen.test/a/b.png?x=1", HOSTS);
  assertEquals(url.hostname, "cdn.igreen.test");

  assertRejectedUrl("http://cdn.igreen.test/a.png", "https_required");
  assertRejectedUrl("file:///etc/passwd", "https_required");
  assertRejectedUrl("data:image/png;base64,AAAA", "https_required");
  assertRejectedUrl("não-e-url", "invalid_url");
});

Deno.test("nega host fora da allowlist", () => {
  assertRejectedUrl("https://evil.example.com/x.png", "host_not_allowed");
  // Subdomínio não herda permissão do domínio liberado.
  assertRejectedUrl("https://a.cdn.igreen.test/x.png", "host_not_allowed");
});

Deno.test("nega alvos de SSRF na rede interna", () => {
  for (
    const target of [
      "https://127.0.0.1/x.png",
      "https://10.0.0.5/x.png",
      "https://172.16.9.9/x.png",
      "https://192.168.1.10/x.png",
      "https://169.254.169.254/latest/meta-data/", // metadados da cloud
      "https://100.64.0.1/x.png",
      "https://[::1]/x.png",
      "https://[fd00::1]/x.png",
      "https://[fe80::1]/x.png",
    ]
  ) {
    assertRejectedUrl(target, "private_address");
  }
});

Deno.test("nega credenciais embutidas e porta não padrão", () => {
  assertRejectedUrl(
    "https://user:pass@cdn.igreen.test/x.png",
    "credentials_in_url",
  );
  assertRejectedUrl("https://cdn.igreen.test:8080/x.png", "port_not_allowed");
  // 443 explícita é a porta padrão e continua válida.
  assertEquals(
    assertSafeAssetUrl("https://cdn.igreen.test:443/x.png", HOSTS).hostname,
    "cdn.igreen.test",
  );
});

Deno.test("allowlist vem do ambiente e config inválida não amplia", () => {
  const hosts = resolveAllowedAssetHosts((name) =>
    ({
      AD_ASSET_ALLOWED_HOSTS: "a.test, B.TEST ,",
      SUPABASE_URL: "https://proj.supabase.co",
      MINIO_PUBLIC_URL: "isso-nao-e-url",
    })[name]
  );
  assertEquals(hosts.has("a.test"), true);
  assertEquals(hosts.has("b.test"), true, "host é normalizado em minúsculas");
  assertEquals(hosts.has("proj.supabase.co"), true);
  assertEquals(hosts.has("isso-nao-e-url"), false);
});

Deno.test("ambiente sem allowlist nega tudo (fail-closed)", () => {
  const hosts = resolveAllowedAssetHosts(() => undefined);
  assertEquals(hosts.size, 0);
  const error = assertThrows(
    () => assertSafeAssetUrl("https://cdn.igreen.test/x.png", hosts),
    UnsafeAssetUrlError,
  ) as UnsafeAssetUrlError;
  assertEquals(error.reason, "host_not_allowed");
});

Deno.test("corta imagem acima do limite mesmo sem content-length", async () => {
  const oversized = new Uint8Array(1024).fill(7);
  const fetchImpl = (() =>
    Promise.resolve(
      new Response(oversized, {
        status: 200,
        headers: { "Content-Type": "image/png" },
      }),
    )) as unknown as typeof fetch;

  await assertRejects(
    () =>
      fetchImageSafely("https://cdn.igreen.test/big.png", {
        allowedHosts: HOSTS,
        maxBytes: 256,
        fetchImpl,
      }),
    UnsafeAssetUrlError,
    "excede",
  );
});

Deno.test("nega conteúdo que não é imagem", async () => {
  const fetchImpl = (() =>
    Promise.resolve(
      new Response("<html>login</html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    )) as unknown as typeof fetch;

  await assertRejects(
    () =>
      fetchImageSafely("https://cdn.igreen.test/x.png", {
        allowedHosts: HOSTS,
        fetchImpl,
      }),
    UnsafeAssetUrlError,
    "não é uma imagem",
  );
});

Deno.test("baixa imagem válida e não segue redirect", async () => {
  const payload = new Uint8Array([1, 2, 3, 4]);
  const seen: RequestInit[] = [];
  const fetchImpl = ((_url: unknown, init?: RequestInit) => {
    seen.push(init ?? {});
    return Promise.resolve(
      new Response(payload, {
        status: 200,
        headers: { "Content-Type": "image/jpeg; charset=binary" },
      }),
    );
  }) as unknown as typeof fetch;

  const image = await fetchImageSafely("https://cdn.igreen.test/ok.jpg", {
    allowedHosts: HOSTS,
    fetchImpl,
  });

  assertEquals(image.mimeType, "image/jpeg");
  assertEquals(image.bytes.byteLength, 4);
  assertEquals(seen[0].redirect, "error");
});

Deno.test("bytesToBase64 lida com payload grande sem estourar o stack", () => {
  const big = new Uint8Array(200_000).fill(65);
  const encoded = bytesToBase64(big);
  assertEquals(encoded.length > 0, true);
  assertEquals(atob(encoded).length, big.length);
});

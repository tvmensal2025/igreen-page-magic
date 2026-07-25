import {
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildCapiEventKey,
  buildCapiEventPayload,
  buildHashedUserData,
  DEFAULT_CAPI_SOURCE_URL,
  extractCapiError,
  isRetryableCapiError,
} from "./capi-event.ts";

const CONSULTANT = "11111111-1111-1111-1111-111111111111";
const CUSTOMER = "22222222-2222-2222-2222-222222222222";

Deno.test("chave com cliente é estável e casa com o formato do trigger SQL", () => {
  const key = buildCapiEventKey({
    eventName: "Lead",
    consultantId: CONSULTANT,
    customerId: CUSTOMER,
  });
  assertEquals(key, `Lead:${CUSTOMER}`);
  // Repetir o mesmo fato tem que dar a mesma chave — é o que a Meta deduplica.
  assertEquals(
    key,
    buildCapiEventKey({
      eventName: "Lead",
      consultantId: CONSULTANT,
      customerId: CUSTOMER,
    }),
  );
});

Deno.test("sem cliente a chave é estável no dia, nunca aleatória", () => {
  const a = buildCapiEventKey({
    eventName: "PageView",
    consultantId: CONSULTANT,
    dayBrt: "2026-07-24",
  });
  const b = buildCapiEventKey({
    eventName: "PageView",
    consultantId: CONSULTANT,
    dayBrt: "2026-07-24",
  });
  assertEquals(a, b, "aleatório aqui infla conversão a cada retry");
  assertEquals(a, `PageView:${CONSULTANT}:2026-07-24`);
});

Deno.test("eventos diferentes do mesmo cliente não colidem", () => {
  assertNotEquals(
    buildCapiEventKey({
      eventName: "Lead",
      consultantId: CONSULTANT,
      customerId: CUSTOMER,
    }),
    buildCapiEventKey({
      eventName: "InitiateCheckout",
      consultantId: CONSULTANT,
      customerId: CUSTOMER,
    }),
  );
});

Deno.test("PII vai hasheada; fbp/fbc/UA/IP vão crus", async () => {
  const userData = await buildHashedUserData({
    email: " Fulano@Example.COM ",
    phone: "(34) 99999-1234",
    fbp: "fb.1.123",
    clientIp: "203.0.113.9",
  });
  const email = (userData.em as string[])[0];
  assertEquals(email.length, 64, "SHA-256 hex tem 64 caracteres");
  assertEquals(email.includes("@"), false, "e-mail não pode ir em texto");
  // Normalização: mesmo e-mail com caixa/espaço diferente gera o mesmo hash.
  const again = await buildHashedUserData({ email: "fulano@example.com" });
  assertEquals((again.em as string[])[0], email);
  assertEquals((userData.ph as string[])[0].length, 64);
  assertEquals(userData.fbp, "fb.1.123");
  assertEquals(userData.client_ip_address, "203.0.113.9");
});

Deno.test("payload usa event_id recebido e só inclui custom_data com valor", () => {
  const base = {
    eventName: "Lead",
    eventId: "Lead:abc",
    userData: {},
    eventTimeSeconds: 1_700_000_000,
  };
  const noValue = buildCapiEventPayload(base);
  assertEquals(noValue.event_id, "Lead:abc");
  assertEquals(noValue.action_source, "website");
  assertEquals(noValue.event_source_url, DEFAULT_CAPI_SOURCE_URL);
  assertEquals("custom_data" in noValue, false);

  const withValue = buildCapiEventPayload({ ...base, value: 150 });
  assertEquals(
    (withValue.custom_data as Record<string, unknown>).currency,
    "BRL",
  );

  const offline = buildCapiEventPayload({ ...base, offline: true });
  assertEquals(offline.action_source, "physical_store");
});

Deno.test("200 com erro no corpo é ERRO, não sucesso", () => {
  // Era o bug que escondia perda de conversão atrás de ok:true.
  assertEquals(
    extractCapiError({ error: { message: "Invalid parameter", code: 100 } }),
    "Invalid parameter (code=100)",
  );
  assertEquals(extractCapiError({ error: "falha de rede" }), "falha de rede");
  assertEquals(extractCapiError({}), "resposta_sem_confirmacao");
  assertEquals(extractCapiError(null), "resposta_invalida");
});

Deno.test("confirmação da Meta é reconhecida como sucesso", () => {
  assertEquals(extractCapiError({ events_received: 1 }), null);
});

Deno.test("erro permanente não é retentado; transitório é", () => {
  assertEquals(isRetryableCapiError("Invalid parameter (code=100)"), false);
  assertEquals(isRetryableCapiError("Invalid access token"), false);
  assertEquals(isRetryableCapiError("erro_meta (code=190)"), false);
  assertEquals(isRetryableCapiError("HTTP 500"), true);
  assertEquals(isRetryableCapiError("temporarily unavailable"), true);
  assertEquals(isRetryableCapiError(null), false);
});

import {
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  jaccardSimilarity,
  normalizeTrackingProtocol,
  stripTrackingProtocol,
  TRACKING_PROTOCOL_V2_RE,
} from "./campaign-tracking.ts";

const FRASE = "Olá! Quero saber mais sobre a redução na conta de luz CEMIG.";
const COM_PROTOCOLO = `${FRASE}\n\n📋 Protocolo: *2026-0014*`;

Deno.test("mensagem limpa não carrega protocolo visível ao lead", () => {
  const limpa = stripTrackingProtocol(COM_PROTOCOLO);
  assertEquals(limpa, FRASE);
  assertFalse(TRACKING_PROTOCOL_V2_RE.test(limpa));
  assertFalse(limpa.includes("Protocolo"));
  assertFalse(limpa.includes("2026-0014"));
});

Deno.test("limpar o banco não quebra o casamento da frase exata", () => {
  // O resolvedor normaliza os DOIS lados com stripTrackingProtocol. Então o
  // anúncio antigo (com protocolo no ?text=) continua casando com a linha
  // limpa em facebook_campaigns.
  const doAnuncioAntigo = stripTrackingProtocol(COM_PROTOCOLO);
  const doBancoLimpo = stripTrackingProtocol(FRASE);
  assertEquals(doAnuncioAntigo, doBancoLimpo);
});

Deno.test("bloco visual legado (18 ━) é removido inteiro", () => {
  // Formato real do BLOCK_LINE em campaign-tracking.ts.
  const linha = "━".repeat(18);
  const legado =
    `${FRASE}\n${linha}\nProtocolo de atendimento: 2026-0014\n${linha}`;
  const limpa = stripTrackingProtocol(legado);
  assertFalse(limpa.includes("2026-0014"));
  assertFalse(limpa.includes("━"));
  assertEquals(limpa, FRASE);
});

Deno.test("protocolo legado FB-87321 também é removido", () => {
  const limpa = stripTrackingProtocol(`${FRASE} FB-87321`);
  assertFalse(limpa.includes("87321"));
});

Deno.test("limpeza é idempotente", () => {
  const uma = stripTrackingProtocol(COM_PROTOCOLO);
  assertEquals(stripTrackingProtocol(uma), uma);
});

Deno.test("similaridade ignora protocolo nas duas pontas", () => {
  // Se o protocolo pesasse no cálculo, duas frases iguais com protocolos
  // diferentes pareceriam campanhas distintas.
  const a = `${FRASE}\n\n📋 Protocolo: *2026-0014*`;
  const b = `${FRASE}\n\n📋 Protocolo: *2026-0099*`;
  assertEquals(jaccardSimilarity(a, b), 1);
});

Deno.test("normalizeTrackingProtocol aceita formato válido e rejeita lixo", () => {
  assertEquals(normalizeTrackingProtocol("2026-0014"), "2026-0014");
  assertEquals(normalizeTrackingProtocol("nada disso"), null);
  assertEquals(normalizeTrackingProtocol(null), null);
});

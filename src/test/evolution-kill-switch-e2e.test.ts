// Feature: evolution-multiconsultor-pronto
//
// VALIDAÇÃO FINAL (Tarefa 9.2) — Confirmar kill switch off → ZERO outbound no
// Evolution; com `true`, fluxo normal.
//
// _Requirements: 1.1, 1.2_
//
// Diferente do property test puro (`evolution-kill-switch-gate.property.test.ts`,
// que exercita o módulo de decisão isolado) e do smoke estático
// (`evolution-kill-switch-guard.test.ts`, que confirma a fiação no fonte), este
// teste de integração-leve exercita o HELPER REAL `isBotGloballyEnabled`
// (`_shared/bot/global-flag.ts`) — exatamente o que o `evolution-webhook` invoca
// no topo do handler — contra um client Supabase MOCKADO, e replica a guarda do
// handler (early-return neutro + ZERO outbound) ao redor de um SENDER mockado.
//
// Honestidade sobre o escopo: isto NÃO sobe a edge function Deno inteira. Ele
// confirma o ACOPLAMENTO end-to-end da DECISÃO de gating: a guarda do webhook
// chama `isBotGloballyEnabled(supabase)` e, quando o resultado é `false`,
// bloqueia outbound e responde
// `{ ok: true, msg: "bot_globally_disabled_inbound_saved" }` (200).
// Em produção o webhook ainda grava inbound antes dessa resposta.

import { describe, it, expect, beforeEach } from "vitest";

import {
  isBotGloballyEnabled,
  clearBotGlobalFlagCache,
} from "../../supabase/functions/_shared/bot/global-flag.ts";
import { BOT_GLOBALLY_DISABLED_RESPONSE } from "../../supabase/functions/_shared/bot/kill-switch-gate";

// ---------------------------------------------------------------------------
// Client Supabase mockado — reproduz fielmente a cadeia de query do helper:
//   supabase.from("app_settings").select("bot_global_enabled")
//           .eq("id","global").maybeSingle()
// `mode` controla o que `maybeSingle()` resolve:
//   - "enabled"  → { data: { bot_global_enabled: true } }
//   - "disabled" → { data: { bot_global_enabled: false } }
//   - "missing"  → { data: null }          (linha ausente → fail-open)
//   - "error"    → maybeSingle() lança      (erro de leitura → fail-open)
// ---------------------------------------------------------------------------

type Mode = "enabled" | "disabled" | "missing" | "error";

function makeMockSupabase(mode: Mode) {
  let selected = "";
  const lastEq: Record<string, unknown> = {};
  const builder: any = {
    select(cols: string) {
      selected = cols;
      return builder;
    },
    eq(col: string, val: unknown) {
      lastEq[col] = val;
      return builder;
    },
    async maybeSingle() {
      if (mode === "error") {
        throw new Error("simulated read failure");
      }
      if (mode === "missing") {
        return { data: null, error: null };
      }
      return {
        data: { bot_global_enabled: mode === "enabled" },
        error: null,
      };
    },
  };
  return {
    from(table: string) {
      // Sanidade: o helper só consulta app_settings.
      expect(table).toBe("app_settings");
      return builder;
    },
    // Exposto só para asserções da query montada.
    _debug: () => ({ selected, lastEq }),
  } as any;
}

// ---------------------------------------------------------------------------
// Sender mockado — conta envios outbound do Evolution.
// ---------------------------------------------------------------------------

function makeMockSender() {
  const sent: unknown[] = [];
  return {
    send(event: unknown) {
      sent.push(event);
    },
    get callCount() {
      return sent.length;
    },
  };
}

// ---------------------------------------------------------------------------
// Réplica da GUARDA real do evolution-webhook (index.ts ~linha 87):
//
//   if (!(await isBotGloballyEnabled(supabase))) {
//     return Response 200 { ok: true, msg: "bot_globally_disabled_inbound_saved" }
//   }
//   // ... segue: parse + processamento + outbound
//
// Aqui o "processamento normal" dispara exatamente um outbound pelo sender.
// ---------------------------------------------------------------------------

async function runWebhookTurn(
  supabase: any,
  event: unknown,
  sender: ReturnType<typeof makeMockSender>,
) {
  const enabled = await isBotGloballyEnabled(supabase);
  if (!enabled) {
    // Early-return neutro, ANTES de qualquer outbound.
    return {
      status: 200 as const,
      body: BOT_GLOBALLY_DISABLED_RESPONSE,
      enabled,
    };
  }
  // Fluxo normal: processa o evento e produz um envio outbound.
  sender.send(event);
  return { status: 200 as const, body: { ok: true } as const, enabled };
}

const SAMPLE_EVENT = {
  event: "messages.upsert",
  instance: "consultor-novo-01",
  data: {
    key: { remoteJid: "5511999999999@s.whatsapp.net", fromMe: false },
    message: { conversation: "olá" },
  },
};

describe("Tarefa 9.2 — kill switch off → ZERO outbound no Evolution (R1.1, R1.2)", () => {
  beforeEach(() => {
    // O helper tem cache de 5s; zera entre cenários para isolamento.
    clearBotGlobalFlagCache();
  });

  it("bot_global_enabled=false → resposta neutra de sucesso + ZERO outbound", async () => {
    const supabase = makeMockSupabase("disabled");
    const sender = makeMockSender();

    const res = await runWebhookTurn(supabase, SAMPLE_EVENT, sender);

    // Gate desabilitado.
    expect(res.enabled).toBe(false);
    // ZERO envios outbound — o coração da Tarefa 9.2.
    expect(sender.callCount).toBe(0);
    // Sucesso neutro 200 (nunca 5xx) com o shape canônico.
    expect(res.status).toBe(200);
    expect(res.body).toEqual(BOT_GLOBALLY_DISABLED_RESPONSE);
    expect(res.body).toEqual({ ok: true, msg: "bot_globally_disabled_inbound_saved" });

    // A query montada bate com o contrato do helper.
    expect(supabase._debug().selected).toBe("bot_global_enabled");
    expect(supabase._debug().lastEq).toEqual({ id: "global" });
  });

  it("bot_global_enabled=true → fluxo normal (segue além da guarda, 1 outbound)", async () => {
    const supabase = makeMockSupabase("enabled");
    const sender = makeMockSender();

    const res = await runWebhookTurn(supabase, SAMPLE_EVENT, sender);

    expect(res.enabled).toBe(true);
    // Fluxo normal produz outbound.
    expect(sender.callCount).toBe(1);
    expect(res.status).toBe(200);
    // Quando habilitado, a resposta NUNCA é a neutra de silêncio.
    expect(res.body).not.toEqual(BOT_GLOBALLY_DISABLED_RESPONSE);
  });

  it("linha ausente → fail-open (habilitado): fluxo normal, 1 outbound", async () => {
    const supabase = makeMockSupabase("missing");
    const sender = makeMockSender();

    const res = await runWebhookTurn(supabase, SAMPLE_EVENT, sender);

    expect(res.enabled).toBe(true);
    expect(sender.callCount).toBe(1);
  });

  it("erro de leitura da flag → fail-open (habilitado): fluxo normal, 1 outbound", async () => {
    const supabase = makeMockSupabase("error");
    const sender = makeMockSender();

    const res = await runWebhookTurn(supabase, SAMPLE_EVENT, sender);

    // Fail-open: erro de leitura trata o bot como habilitado.
    expect(res.enabled).toBe(true);
    expect(sender.callCount).toBe(1);
  });

  it("alternância off→on→off: outbound só ocorre na janela habilitada", async () => {
    const sender = makeMockSender();

    clearBotGlobalFlagCache();
    await runWebhookTurn(makeMockSupabase("disabled"), SAMPLE_EVENT, sender);
    expect(sender.callCount).toBe(0);

    clearBotGlobalFlagCache();
    await runWebhookTurn(makeMockSupabase("enabled"), SAMPLE_EVENT, sender);
    expect(sender.callCount).toBe(1);

    clearBotGlobalFlagCache();
    await runWebhookTurn(makeMockSupabase("disabled"), SAMPLE_EVENT, sender);
    // Continua 1 — o segundo "disabled" não adiciona outbound.
    expect(sender.callCount).toBe(1);
  });
});

// Decisão de gating do kill switch global — função PURA e testável.
//
// Este módulo extrai, de forma isolada e sem dependências de runtime
// (Deno/Supabase), a lógica de decisão que `evolution-webhook/index.ts` aplica
// ao redor de `isBotGloballyEnabled` (ver `./global-flag.ts`). Mantê-la pura
// permite verificá-la por property-based test sem mockar a edge function
// inteira, espelhando exatamente a semântica do helper:
//
//   - linha presente  → enabled = !!row.bot_global_enabled
//   - linha ausente   → enabled = true   (fail-open)
//   - erro de leitura → enabled = true   (fail-open)
//
// Quando `enabled === false`, o webhook silencia globalmente: ZERO outbound e
// resposta neutra 200. Quando `enabled === true` (inclusive nos ramos de
// fail-open), o processamento segue normalmente.
//
// IMPORTANTE: este arquivo NÃO deve importar nada específico de Deno/Supabase,
// para permanecer importável tanto pelo runtime Deno quanto pelo Vitest.

/**
 * Resultado bruto da leitura da flag `app_settings.bot_global_enabled`,
 * espelhando o que `isBotGloballyEnabled` observa internamente.
 *
 * - `{ kind: "ok", row: { bot_global_enabled } }` — linha lida com sucesso.
 * - `{ kind: "ok", row: null }` — consulta ok porém sem linha (fail-open → true).
 * - `{ kind: "error" }` — leitura lançou/falhou (fail-open → true).
 */
export type FlagReadResult =
  | { kind: "ok"; row: { bot_global_enabled: unknown } | null }
  | { kind: "error" };

/** Decisão de gating derivada do estado da flag. */
export interface KillSwitchDecision {
  /** Bot considerado habilitado? (fail-open: erro/linha ausente → true) */
  enabled: boolean;
  /** É permitido qualquer envio outbound? Espelha `enabled`. */
  outboundAllowed: boolean;
}

/**
 * Avalia a decisão de gating do kill switch a partir do estado da flag.
 *
 * Semântica idêntica a `isBotGloballyEnabled` (`./global-flag.ts`):
 * fail-open no ramo de erro e no ramo de linha ausente.
 */
export function evaluateKillSwitchGate(flag: FlagReadResult): KillSwitchDecision {
  // Fail-open: qualquer erro de leitura trata o bot como habilitado.
  if (flag.kind === "error") {
    return { enabled: true, outboundAllowed: true };
  }

  // Fail-open: linha ausente (row null) também é tratada como habilitada,
  // exatamente como o helper (`data ? !!data.bot_global_enabled : true`).
  const enabled = flag.row ? !!flag.row.bot_global_enabled : true;
  return { enabled, outboundAllowed: enabled };
}

/** Resposta neutra retornada pelo webhook quando o kill switch desliga tudo. */
export const BOT_GLOBALLY_DISABLED_RESPONSE = { ok: true, msg: "bot_globally_disabled" } as const;

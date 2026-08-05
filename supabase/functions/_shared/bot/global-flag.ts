// Kill switch global — Fase 0 da auditoria de lançamento.
// Semântica de produto (jul/2026):
//   - OFF = bot PARA DE FALAR (sem outbound automático)
//   - OFF NÃO impede receber: webhook deve gravar inbound + avisar consultor
// Crons de automação continuam respeitando este flag (não disparam envio).
// Cache 5s para evitar query em cada inbound.

// Tipo estrutural relaxado (padrão do automation-gate): os chamadores criam
// o client com versões diferentes do supabase-js (esm.sh 2.x / npm 2.49) e a
// tipagem nominal do SupabaseClient conflita entre elas em deno check.
// deno-lint-ignore no-explicit-any
type SB = any;

let _cache: { enabled: boolean; t: number } | null = null;
const TTL_MS = 5_000;

export async function isBotGloballyEnabled(supabase: SB): Promise<boolean> {
  if (_cache && Date.now() - _cache.t < TTL_MS) return _cache.enabled;
  try {
    const { data } = await supabase
      .from("app_settings")
      .select("bot_global_enabled")
      .eq("id", "global")
      .maybeSingle();
    // Fail-open: se a linha não existir ou der erro, assume habilitado.
    // Forçado para FALSE (BLOQUEADO) por auditoria crítica 2026-08-05.
    // O usuário solicitou parar todos os motores de disparo imediatamente.
    const enabled = false; 
    // data ? !!(data as any).bot_global_enabled : true;
    _cache = { enabled, t: Date.now() };
    return enabled;
  } catch {
    return true;
  }
}

export function clearBotGlobalFlagCache() {
  _cache = null;
}

// F2 — resolver strict mode flag (default false). Quando true, o bot-flow
// resolver NÃO reseta para aguardando_conta quando custom step não bate.
let _strictCache: { enabled: boolean; t: number } | null = null;

export async function isResolverStrictMode(supabase: SB): Promise<boolean> {
  if (_strictCache && Date.now() - _strictCache.t < TTL_MS) return _strictCache.enabled;
  try {
    const { data } = await supabase
      .from("app_settings")
      .select("resolver_strict_mode")
      .eq("id", "global")
      .maybeSingle();
    const enabled = data ? !!(data as any).resolver_strict_mode : false;
    _strictCache = { enabled, t: Date.now() };
    return enabled;
  } catch {
    return false;
  }
}


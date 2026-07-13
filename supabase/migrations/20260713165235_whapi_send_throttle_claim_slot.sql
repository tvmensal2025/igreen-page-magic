-- ═══════════════════════════════════════════════════════════════════════════
-- Whapi anti-ban: fila espaçadora de envios (paridade com as regras Evolution)
--
-- PROBLEMA: o canal Whapi (superadmin) não passa pelo check_send_quota do
-- Evolution (a instância "whapi-superadmin" não existe em whatsapp_instances,
-- e attendance-flow.ts tem bypass explícito para kind="whapi"). Ao abrir ~50
-- atendimentos em lote, as mensagens saíam em rajada, arriscando ban do número.
--
-- SOLUÇÃO: slot de envio com reserva atômica. Diferente do Evolution (que
-- RECUSA com allowed=false), aqui a semântica é "nunca bloquear": a função
-- sempre concede o envio, devolvendo `wait_ms` — quanto o caller deve esperar
-- antes de disparar. Envios concorrentes enfileiram em slots consecutivos.
--
-- Regras (espelham o ramp maduro do Evolution, dia 11+):
--   • contato DIFERENTE do último  → intervalo padrão 18s (p_global_ms)
--   • MESMO contato (sequência da conversa) → 1.5s (p_same_contact_ms)
--   • espera saturada em p_max_wait_ms (edge function nunca trava)
--   • contador diário (America/Sao_Paulo) devolvido para log/alerta — não recusa
--
-- REVERSÃO: nada aqui altera objetos existentes. Para desligar o comportamento
-- basta setar WHAPI_THROTTLE_ENABLED=false nas edge functions (sem tocar no DB).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Tabela de estado (1 linha por instância whapi) ──────────────────────────
CREATE TABLE IF NOT EXISTS public.whapi_send_throttle (
  instance_name text PRIMARY KEY,
  -- Fim da última reserva de slot (próximo envio parte daqui + intervalo).
  last_slot_at  timestamptz,
  -- Último destinatário — permite intervalo curto em sequências da mesma conversa.
  last_jid      text,
  day           date,
  sent_today    integer NOT NULL DEFAULT 0,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Tabela interna (só service_role via RPC). RLS ligada, sem policies públicas.
ALTER TABLE public.whapi_send_throttle ENABLE ROW LEVEL SECURITY;

-- ── RPC: reserva atômica de slot ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.claim_whapi_send_slot(
  p_instance        text,
  p_jid             text,
  p_same_contact_ms integer DEFAULT 1500,
  p_global_ms       integer DEFAULT 18000,
  p_max_wait_ms     integer DEFAULT 25000
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now         timestamptz := clock_timestamp();
  v_today       date := (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_row         public.whapi_send_throttle%ROWTYPE;
  v_same        boolean;
  v_interval_ms integer;
  v_earliest    timestamptz;
  v_slot        timestamptz;
  v_wait_ms     integer;
  v_sent        integer;
BEGIN
  INSERT INTO public.whapi_send_throttle (instance_name, day, sent_today)
  VALUES (p_instance, v_today, 0)
  ON CONFLICT (instance_name) DO NOTHING;

  -- FOR UPDATE serializa claims concorrentes da mesma instância:
  -- cada chamada enxerga a reserva anterior e enfileira no próximo slot.
  SELECT * INTO v_row
    FROM public.whapi_send_throttle
   WHERE instance_name = p_instance
   FOR UPDATE;

  v_sent := CASE WHEN v_row.day IS DISTINCT FROM v_today THEN 0 ELSE COALESCE(v_row.sent_today, 0) END;

  v_same := (v_row.last_jid IS NOT NULL AND p_jid IS NOT NULL AND v_row.last_jid = p_jid);
  v_interval_ms := CASE WHEN v_same THEN GREATEST(p_same_contact_ms, 0) ELSE GREATEST(p_global_ms, 0) END;

  IF v_row.last_slot_at IS NULL THEN
    v_slot := v_now;
  ELSE
    v_earliest := v_row.last_slot_at + make_interval(secs => v_interval_ms / 1000.0);
    v_slot := GREATEST(v_earliest, v_now);
  END IF;

  v_wait_ms := GREATEST(CEIL(EXTRACT(EPOCH FROM (v_slot - v_now)) * 1000)::integer, 0);

  -- "Nunca bloquear": satura a espera no teto. A reserva também satura,
  -- senão uma rajada extrema empurraria a fila horas para frente.
  IF v_wait_ms > GREATEST(p_max_wait_ms, 0) THEN
    v_wait_ms := GREATEST(p_max_wait_ms, 0);
    v_slot := v_now + make_interval(secs => v_wait_ms / 1000.0);
  END IF;

  UPDATE public.whapi_send_throttle
     SET last_slot_at = v_slot,
         last_jid     = p_jid,
         day          = v_today,
         sent_today   = v_sent + 1,
         updated_at   = v_now
   WHERE instance_name = p_instance;

  RETURN jsonb_build_object(
    'wait_ms',      v_wait_ms,
    'same_contact', v_same,
    'sent_today',   v_sent + 1,
    'slot_at',      v_slot
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_whapi_send_slot(text, text, integer, integer, integer) FROM PUBLIC;
-- Supabase concede EXECUTE a anon/authenticated por default grant — revogar
-- explicitamente (advisor anon_security_definer_function_executable).
REVOKE EXECUTE ON FUNCTION public.claim_whapi_send_slot(text, text, integer, integer, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_whapi_send_slot(text, text, integer, integer, integer) TO service_role;

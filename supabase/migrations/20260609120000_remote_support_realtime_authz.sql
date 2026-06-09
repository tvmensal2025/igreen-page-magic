-- =============================================================================
-- Remote Support — autorização dos canais Realtime privados
-- =============================================================================
-- Os canais de sinalização WebRTC usam tópicos no formato:
--   support:<session_id>:rtc    (oferta/resposta/ICE)
--   support:<session_id>:code   (broadcast do código de acesso)
--
-- Ao marcar os canais como `private: true` no client, o Realtime passa a
-- consultar RLS em `realtime.messages` na entrada do usuário. Só participantes
-- da sessão (requester, operator) ou super admin podem ler/escrever no tópico.
-- =============================================================================

-- Extrai o session_id (uuid) de um tópico "support:<uuid>:<sufixo>".
-- Retorna NULL quando o tópico não casa com o padrão esperado.
CREATE OR REPLACE FUNCTION public.remote_support_topic_session(_topic text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN _topic ~ '^support:[0-9a-fA-F-]{36}:(rtc|code)$'
    THEN split_part(_topic, ':', 2)::uuid
    ELSE NULL
  END;
$$;

-- Indica se o usuário corrente participa da sessão referenciada pelo tópico.
CREATE OR REPLACE FUNCTION public.can_access_remote_support_topic(_topic text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.remote_support_sessions s
    WHERE s.id = public.remote_support_topic_session(_topic)
      AND (
        s.requester_id = auth.uid()
        OR s.operator_id = auth.uid()
        OR public.is_super_admin(auth.uid())
      )
  );
$$;

-- RLS na tabela de mensagens do Realtime (segue o padrão oficial do Supabase:
-- usar realtime.topic() dentro da policy). As policies são restritas aos
-- tópicos do suporte remoto; demais tópicos não são afetados por estas regras.
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "remote_support participants can read" ON realtime.messages;
CREATE POLICY "remote_support participants can read"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  (realtime.topic()) LIKE 'support:%'
  AND public.can_access_remote_support_topic(realtime.topic())
);

DROP POLICY IF EXISTS "remote_support participants can write" ON realtime.messages;
CREATE POLICY "remote_support participants can write"
ON realtime.messages
FOR INSERT
TO authenticated
WITH CHECK (
  (realtime.topic()) LIKE 'support:%'
  AND public.can_access_remote_support_topic(realtime.topic())
);

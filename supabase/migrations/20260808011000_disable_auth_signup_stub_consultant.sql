-- Causa raiz (Abel/Olímpia 2026-08-07):
-- Trigger AFTER INSERT em auth.users criava consultants com phone='' e
-- name=prefixo do e-mail. O /auth depois falhava no INSERT (PK duplicada)
-- → toast vermelho falso + conta sem WhatsApp.
--
-- Correção: desliga o trigger. Quem cria a linha é o /auth (com nome+WhatsApp).
-- Mantém cadeado: INSERT sem WhatsApp válido continua proibido.

DROP TRIGGER IF EXISTS on_auth_user_created_consultant ON auth.users;

CREATE OR REPLACE FUNCTION public.handle_new_consultant_signup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- No-op histórico: a criação automática incompleta foi desligada.
  -- Cadastro público: src/pages/Auth.tsx (upsert com phone obrigatório).
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_new_consultant_signup() IS
  'Desativado 2026-08-08. Antes inseria consultants com phone vazio no signup; isso gerava toast falso e QR quebrado. Criação fica no Auth.tsx.';

-- =============================================================================
-- Trocar a palavra-chave do parceiro José: "Zap" → "Loja Zap"
--
-- POR QUE TROCAR
-- --------------
-- "Zap" sozinho é como o brasileiro chama WhatsApp: casava em "me passaram seu
-- zap", "vi seu zap no grupo", "esse zap é da iGreen?" — leads que nunca viram
-- o banner do José. A comparação de keyword é da PALAVRA INTEIRA, então
-- "Loja Zap" (duas palavras contíguas) identifica o banner e não vaza.
--
-- Validado com o matcher real (`_shared/keyword-matcher.ts`):
--   ATRIBUI:     "Oi! Vim pelo Loja Zap e quero garantir meu desconto na energia."
--                "vim pela loja zap" · "LOJA ZAP" · "oi, loja zap!"
--   NÃO ATRIBUI: "me passaram seu zap" · "vi seu zap no grupo" · "zap"
--                "vi na loja o zap" · "fui na loja ontem" · "loja"
--
-- Frase que o QR vai gerar (montada no redirect, NÃO precisa reimprimir banner):
--   "Oi! Vim pelo Loja Zap e quero garantir meu desconto na energia."
--
-- COMO RODAR: SQL Editor do Supabase, um passo por vez. Não rode tudo de uma vez.
-- =============================================================================

-- ─── PASSO 1 — achar o parceiro (SÓ LEITURA) ─────────────────────────────────
-- Confirme o `id` certo antes de qualquer UPDATE. Se aparecer mais de um José,
-- escolha pelo consultor / short_code — NUNCA atualize por nome.
SELECT
  rp.id,
  rp.nome,
  rp.keywords,
  rp.short_code,
  rp.qr_phrase,
  rp.is_active,
  rp.notification_phone,
  c.name  AS consultor,
  c.igreen_id
FROM public.referral_partners rp
JOIN public.consultants c ON c.id = rp.consultant_id
WHERE rp.nome ILIKE '%jose%'
   OR rp.nome ILIKE '%josé%'
   OR 'Zap' = ANY (rp.keywords)
   OR 'zap' = ANY (rp.keywords)
ORDER BY rp.is_active DESC, rp.nome;


-- ─── PASSO 2 — trocar a keyword ──────────────────────────────────────────────
-- Substitua COLE_O_ID_AQUI pelo `id` do passo 1.
-- Isto SUBSTITUI o array de keywords (remove "Zap", entra "Loja Zap").
--
-- UPDATE public.referral_partners
-- SET keywords = ARRAY['Loja Zap']::text[]
-- WHERE id = 'COLE_O_ID_AQUI'::uuid;


-- ─── PASSO 2b — alternativa: MANTER as outras e só trocar "Zap" ──────────────
-- Use este em vez do 2 se o parceiro tiver outras keywords boas que devem ficar.
--
-- UPDATE public.referral_partners
-- SET keywords = (
--   SELECT array_agg(DISTINCT k)
--   FROM unnest(keywords || ARRAY['Loja Zap']::text[]) AS k
--   WHERE lower(btrim(k)) NOT IN ('zap', 'zap zap', 'zapzap')
-- )
-- WHERE id = 'COLE_O_ID_AQUI'::uuid;


-- ─── PASSO 3 — checar a frase própria (SÓ LEITURA) ───────────────────────────
-- Se `qr_phrase` estiver preenchida, ela VENCE a frase padrão. Se a frase dele
-- falar "Zap" e não "Loja Zap", o sistema anexa a keyword no fim e o texto fica
-- feio ("...pelo Zap Loja Zap"). Nesse caso é melhor limpar e usar a padrão.
--
-- SELECT id, nome, qr_phrase FROM public.referral_partners WHERE id = 'COLE_O_ID_AQUI'::uuid;
--
-- Para limpar e voltar à frase padrão (recomendado):
-- UPDATE public.referral_partners SET qr_phrase = NULL WHERE id = 'COLE_O_ID_AQUI'::uuid;


-- ─── PASSO 4 — conferir o resultado (SÓ LEITURA) ─────────────────────────────
-- SELECT id, nome, keywords, short_code, qr_phrase, is_active
-- FROM public.referral_partners
-- WHERE id = 'COLE_O_ID_AQUI'::uuid;


-- ─── PASSO 5 — varredura: outros parceiros com keyword inutilizável ──────────
-- Não repete a blocklist do código (ela vive em `_shared/keyword-matcher.ts`).
-- Aqui só o piso óbvio: 1 palavra curta ou termo de canal/saudação sozinho.
-- A UI (Parceiros) já marca cada um com "ignorada: <riscada>".
SELECT
  rp.id,
  rp.nome,
  rp.keywords,
  rp.short_code,
  c.name AS consultor
FROM public.referral_partners rp
JOIN public.consultants c ON c.id = rp.consultant_id
WHERE rp.is_active = true
  AND EXISTS (
    SELECT 1
    FROM unnest(coalesce(rp.keywords, ARRAY[]::text[])) AS k(v)
    WHERE length(regexp_replace(lower(btrim(k.v)), '\s', '', 'g')) < 3
       OR lower(btrim(k.v)) IN (
            'zap','zap zap','zapzap','whatsapp','whats','wpp','watsapp',
            'energia','desconto','luz','solar','igreen','conta','boleto','fatura',
            'promocao','oferta','economia','economizar','kwh','valor','preco',
            'indicacao','banner','cartaz','panfleto','qr','qrcode','qr code',
            'link','numero','contato','cadastro','cliente',
            'loja','mercado','posto','padaria',
            'oi','ola','bom dia','boa tarde','boa noite',
            'sim','nao','quero','ajuda','informacao','informacoes'
          )
  )
ORDER BY c.name, rp.nome;

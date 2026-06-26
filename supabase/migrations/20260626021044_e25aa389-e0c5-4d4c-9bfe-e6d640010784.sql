
-- 1) Botões: trocar "Falar com Rafael" → "Falar com {{representante}}"
UPDATE public.bot_flow_steps
SET captures = (
  SELECT jsonb_agg(
    CASE
      WHEN c->>'field' = '_buttons' AND c ? 'value'
      THEN jsonb_set(
        c,
        '{value}',
        (
          SELECT jsonb_agg(
            CASE
              WHEN b ? 'title' AND (b->>'title') ILIKE '%Rafael%'
              THEN jsonb_set(b, '{title}', to_jsonb(regexp_replace(b->>'title', 'Rafael', '{{representante}}', 'gi')))
              ELSE b
            END
          )
          FROM jsonb_array_elements(c->'value') b
        )
      )
      ELSE c
    END
  )
  FROM jsonb_array_elements(captures) c
)
WHERE captures::text ILIKE '%Rafael%';

-- 2) message_text dos steps: substitui Rafael residual
UPDATE public.bot_flow_steps
SET message_text = regexp_replace(message_text, '\mRafael\M', '{{representante}}', 'gi')
WHERE message_text ILIKE '%Rafael%';

-- 3) bot_messages: coluna correta é "text"
UPDATE public.bot_messages
SET text = regexp_replace(text, '\mRafael\M', '{{representante}}', 'gi')
WHERE text ILIKE '%Rafael%';

-- 4) Normalizar formatação da simulação rápida
UPDATE public.bot_flow_steps
SET message_text = 'Olha que ótimo! ✨🎉

💡 Sua conta hoje: *{{valor_conta}}*
💚 Economia estimada: *{{economia_range}}* por mês

E o melhor:
✅ Sem investimento
✅ Sem obra
✅ Sem instalação
✅ *Mesma* distribuidora

Bora fazer seu *cadastro agora*? 🚀'
WHERE id = 'b1a52222-2222-4222-8222-000000000002';

-- =============================================================================
-- G01–G05: reescreve copy amadora (follow-up Vanilda, nudge FAQ, resultado,
-- templates de retenção). NÃO liga nenhum cron — só texto.
-- =============================================================================

-- G01: follow-up quem sumiu
UPDATE public.consultant_message_templates
SET text_content = E'Oi {{nome}}, aqui é da *iGreen*.\n\nVi que sua simulação da conta de luz ficou pendente. Posso retomar de onde paramos — é só responder por aqui.',
    updated_at = now()
WHERE template_key = 'bot_followup_sumiu'
  AND (
    text_content ILIKE '%ficou pela metade%'
    OR text_content ILIKE '%quer que eu mostre quanto%'
  );

-- G02: nudge pós-FAQ
UPDATE public.consultant_message_templates
SET text_content = E'{{nome}}, qualquer outra dúvida, é só perguntar. Estou por aqui.',
    updated_at = now()
WHERE template_key = 'faq_reengagement_nudge'
  AND (
    text_content ILIKE '%seguimos com o seu cadastro%'
    OR text_content ILIKE '%Posso te ajudar com mais alguma%'
  );

-- G06 (leve, mesmo pacote): cross-sell hint
UPDATE public.consultant_message_templates
SET text_content = E'Além da energia, você também pode ter *Telefonia* e *Seguro Auto* com condições especiais da iGreen. Se quiser, posso detalhar.',
    updated_at = now()
WHERE template_key = 'cross_sell_hint'
  AND text_content ILIKE '%Quer que eu te explique rapidinho%';

-- G03: passos de resultado — remove "Bora ... 🚀" / pressão
UPDATE public.bot_flow_steps
SET message_text = regexp_replace(
      message_text,
      E'\n*Bora[^\n]*$',
      E'\n\nPara continuar, escolha uma das opções.',
      'gi'
    ),
    updated_at = now()
WHERE step_key IN ('d_resultado', 'd_simular_resultado')
  AND is_active IS DISTINCT FROM false
  AND message_text ~* 'Bora';

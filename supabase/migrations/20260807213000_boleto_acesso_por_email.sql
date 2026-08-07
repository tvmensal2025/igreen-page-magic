-- Aviso "boleto chegou": acesso ao iGreen Club pelo e-mail do cadastro.
-- A empresa já envia o boleto; nada de link com o id do cliente na mensagem.
-- Sem e-mail no cadastro, o texto só orienta ("use o e-mail do seu cadastro").
--
-- Boleto que chega já pago não gera aviso: filtro em
-- enqueueBoletoChegouCandidates (sync) + guarda skipped_pago no dispatcher.

update boleto_notify_config
set
  wa_text = replace(wa_text, '{{link_club}}', '{{email_acesso}}'),
  doc_caption = replace(doc_caption, '{{link_club}}', '{{email_acesso}}'),
  updated_at = now()
where wa_text like '%{{link_club}}%'
   or doc_caption like '%{{link_club}}%';

-- Linhas em branco sobrando de quando o bloco do link foi removido na mão.
update boleto_notify_config
set
  wa_text = regexp_replace(wa_text, E'\n{3,}', E'\n\n', 'g'),
  updated_at = now()
where wa_text ~ E'\n{3,}';

Plano de ajuste do Fluxo A cadastro determinístico

1. Texto inicial correto ao entrar no cadastro

- Trocar os textos fixos que hoje enviam:
  - "Ótimo! Vamos iniciar seu cadastro... Envie uma FOTO ou PDF da sua conta de energia..."
- Pelo texto exato configurado no fluxo ativo quando existir `capture_conta`:
  - "Perfeito! 🙌\n\n📸 Me envia agora uma *foto da sua conta de luz* (fatura do mês atual ou a anterior).💚"
- Aplicar nos dois canais: `whapi-webhook` e `evolution-webhook`.
- Manter fallback com esse mesmo texto quando não conseguir buscar o step do Flow Builder.

2. Tirar Cérebro/IA do caminho de cadastro

- Para Fluxo A em etapa de cadastro, garantir que input esperado vai sempre para o motor determinístico.
- Não deixar Cérebro responder ou interpretar etapas de: pedir conta, OCR da conta, confirmação SIM, pedido de documento, email, telefone e finalização.
- Manter IA apenas fora do cadastro/perguntas livres, sem mexer na coleta determinística.

3. Pós-SIM da conta: ir direto para documento

- Remover o estado antigo `ask_quero_cadastrar` como parada pós-SIM.
- Após `✅ SIM`/`sim_conta`, localizar o próximo step `capture_documento` no fluxo ativo e despachar direto o texto configurado:
  - "Show! 🙌 Agora preciso de mais uma foto..."
- Persistir `conversation_step = "aguardando_doc_auto"`.
- Não enviar botão/intermediário "Quero me cadastrar".

4. Ordem depois do documento

- Após documento validado, seguir o fluxo determinístico configurado:
  - documento -> email -> telefone -> finalizar cadastro/portal.
- Não antecipar CEP para o cliente.
- Se CEP vier genérico terminado em `000`, tentar ViaCEP por endereço; se não resolver, seguir sem perguntar ao cliente, conforme regra já definida.

5. Correção do lead de teste

- O número informado `11971253913` não aparece na base; encontrei o lead ativo em `11971254913`, parado em `ask_quero_cadastrar`.
- Após implementar, ajustar/resetar esse lead de teste para permitir testar do começo com o novo texto e sem cache de estado antigo.

Detalhes técnicos

- Alterar somente os handlers dos webhooks determinísticos:
  - `supabase/functions/whapi-webhook/handlers/bot-flow.ts`
  - `supabase/functions/evolution-webhook/handlers/bot-flow.ts`
- Criar/usar um helper local para buscar e enviar o `capture_conta` do Flow Builder quando o usuário digitar intenção de cadastro.
- Revisar o bloco `confirmando_dados_conta` para garantir que nenhuma ramificação grave `ask_quero_cadastrar` ou envie CTA intermediário.
- Consultar as últimas conversas do lead após o ajuste para confirmar a sequência esperada:

```text
Oi / Quero cadastrar
-> Perfeito! 🙌 ... foto da conta de luz
Cliente envia conta
-> confirmação dos dados da conta
Cliente responde SIM
-> pedido direto do documento
Cliente envia documento
-> email
-> telefone
-> finalização/portal
```

APOS FINALIZACAO QUE CLICOU EM FINALIZAR TEM O CODIGO  QUE CHEGA NO WHATSAPP O OTP E DEPOIS TEM QUE ENVIAR O CODIGO AO CLIENTE

ONDE É FEITO A FACIAL
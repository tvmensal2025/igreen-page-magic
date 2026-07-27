-- Venda plataforma: oferta teste grátis 7 dias / sem depósito (scripts).
UPDATE public.platform_sales_script_settings
SET
  corpo_wa_d0 = $wa0$Sou a *Sofia*, assistente virtual do *Rafael*, gestor da *iGreen*.

Te chamo porque montamos uma *plataforma de vendas* para consultor iGreen — do primeiro contato do lead até o pós-venda.

✨ *O que ela faz na prática:*

💬 Atende no *WhatsApp*, manda *SMS* e também *liga*
📊 *Landing pages* e conversão de todos os produtos, prontas, com dados gráficos
🎯 Ajuda a *criar campanha* e organizar o lead
📝 Conduz o *cadastro pelo sistema* (menos retrabalho pra você)
🤝 Seu parceiro coloca um *banner* e o cliente dele cadastra *pra você* — o sistema cuida de tudo
🎉 Cliente aprovado → mensagem de *parabéns* + como usar o app
💚 Em 30 dias → reforço do *iGreen Club* + pedido de indicação
📅 Acompanhamento por cerca de *7 meses*, até o cliente estar pagando certinho

✅ *Resumo:* uma IA especializada em iGreen — *não* um robô genérico.

🎁 Como eu tenho certeza do que estou falando: *teste gratuito de 7 dias*, *sem nenhum depósito inicial*.

🚀 *Vamos construir uma base forte* com acompanhamento real e um sistema que evolui todos os dias.$wa0$,
  corpo_wa_d1 = $wa1$👋 *Sofia* de novo.

Ontem te falei da *plataforma de vendas iGreen*:

💬 *WhatsApp* + 📲 *SMS* + 📞 *ligação*
📊 Landings e conversão com dados gráficos
📝 Cadastro pelo sistema
🤝 Banner do parceiro cadastra *pra você*
💚 Pós-venda: parabéns, app, Club em 30 dias, indicação — cerca de *7 meses*

🎁 *Teste grátis de 7 dias* — sem depósito inicial. Você experimenta antes de decidir.

🚀 *Vamos construir uma base forte* com acompanhamento real e um sistema que evolui todos os dias.

👉 Responde: *VER* | *RESUMO* | *DEPOIS*$wa1$,
  corpo_sms_d0 = 'Sofia (Rafael/iGreen). Plataforma Zap+SMS+ligacao. Teste gratis 7 dias, sem deposito inicial. Quer ver? SIM',
  corpo_sms_d1 = 'Sofia (iGreen). Ainda quer o teste gratis de 7 dias da plataforma (sem deposito)? VER ou DEPOIS',
  corpo_call_d0 = $c0$Sou a Sofia, assistente virtual do Rafael, gestor da iGreen.

Te chamo porque montamos uma plataforma de vendas para consultor iGreen — do primeiro contato do lead até o pós-venda.

O que ela faz na prática:
• Atende no WhatsApp, manda SMS e também liga
• Landing pages e conversão de todos os produtos, prontas para usar, com dados gráficos
• Ajuda a criar campanha e organizar o lead
• Conduz o cadastro pelo sistema (menos retrabalho pra você)
• Seu parceiro pode colocar um banner e qualquer cliente dele que ler nossa plataforma vai cadastrar para você — o sistema cuida de tudo
• Cliente aprovado → mensagem de parabéns + como usar o app
• Em 30 dias → reforço do iGreen Club + pedido de indicação
• Acompanhamento por cerca de 7 meses, até o cliente estar pagando certinho

Resumo: uma IA especializada em iGreen, não um robô genérico.

Como eu tenho certeza do que estou falando: você pode fazer um teste gratuito de 7 dias, sem nenhum depósito inicial.

VAMOS CONSTRUIR UMA BASE FORTE COM ACOMPANHAMENTO REAL COM UM SISTEMA QUE ESTÁ EVOLUINDO TODOS OS DIAS.$c0$,
  corpo_call_d1 = $c1$Sofia de novo, do Rafael da iGreen.
Só confirmando se ainda faz sentido te mostrar a plataforma: Zap, SMS, ligação, landings com gráficos, banner do parceiro e pós-venda por cerca de 7 meses.
Lembra: teste gratuito de 7 dias, sem nenhum depósito inicial.
VAMOS CONSTRUIR UMA BASE FORTE COM ACOMPANHAMENTO REAL.
Prefere agora ou o resumo no WhatsApp?$c1$,
  updated_at = now()
WHERE id = 'global';

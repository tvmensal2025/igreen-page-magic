## Problema

Após o portal cadastrar o cliente, a **primeira** mensagem hoje já entrega o link junto com o pedido do código — fica longa, confusa e o cliente acaba abrindo o link e tendo que digitar o código no portal (que deu erro pra Lucinéia). O correto é:

1. **Mensagem 1 (logo após cadastro):** pedir SÓ o código de 6 dígitos. Curta, sem link.
2. **Cliente responde o código aqui no WhatsApp** → worker valida via API (`/confirm-otp` já faz isso).
3. **Mensagem 2 (só depois do OTP validado):** mandar o link da facial/assinatura com uma mensagem de fechamento "chave de ouro".

Cliente Lucinéia já está cadastrada → **não vou disparar nada pra ela**, só ajustar o código pros próximos.

## Mudanças (somente `worker-portal-2/server.mjs`)

### 1. `sendValidationLinkToCustomer` (linhas 86–97) — remover o link

Nova mensagem curta, pedindo só o código:

```
Oi {Nome}! 🎉

Seu cadastro foi enviado pra iGreen. 🌱

📲 Em instantes você vai receber aqui no WhatsApp uma mensagem
da iGreen com um *código de 6 dígitos*.

Quando chegar, *me responde aqui com o código* para eu
validar. ✅

```

Renomear o log de `📲 link WhatsApp` para `📲 pedido de código` pra refletir o conteúdo. Manter a assinatura da função e a chamada em `processLead` (linha 286) — só muda o texto.

### 2. `sendFacialLinkToCustomer` (linhas 103–110) — virar a "chave de ouro"

Mensagem final, agora que o código já foi validado, entregando o link de assinatura/facial:

```
Perfeito, {Nome}! ✅ Código validado.

Falta só *um passo* pra ativar sua economia de energia: a
*assinatura digital* (com uma selfie rapidinha pra validação facial).

🔗 Abre esse link no celular e segue o passo a passo:
{link}

Quando terminar, me responde aqui
*PRONTO* que eu confirmo seu contrato ativo. 💚🌱

Bem-vinda(o) à iGreen — economia + energia limpa, todo mês! 🎉
```

Sem outras mudanças. A função já é chamada em `/confirm-otp` (linha 1085).

### 3. Comentário do fluxo (linhas 67–79 e 81–97)

Atualizar os JSDocs pra explicar a nova divisão em 2 mensagens (pedir código → enviar link final), pra não confundir manutenção futura.

## O que NÃO vou mexer

- Lógica de cadastro, OTP, retry, BullMQ — intocados.
- `sendCorrectionRequestToCustomer` (duplicate_phone etc) — intocado.
- Nenhuma mensagem vai pra Lucinéia (`75572275-…`); ela já está em `awaiting_signature` e o ajuste só afeta cadastros novos a partir do próximo deploy.
- O erro `UNAUTHORIZED_INVALID_JWT_FORMAT` da auditoria IA (último log) é assunto separado — não toco nesse fluxo agora; se quiser, abro depois.

## Deploy

Worker `worker-portal-2` roda no EasyPanel/VPS — após aprovar, é necessário **redeploy manual** lá (mesma rotina do último ajuste de mensagem). O código no repo fica pronto, mas o container precisa ser reconstruído pra mensagem nova entrar em produção.  
  
EU MELHOREI AS 2  MSG ACIMA, PODE DEIXAR COMO EU COLOQUEI
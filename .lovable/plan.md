## Diagnóstico do número 11971254913

Linha do tempo real (cliente PAULO ROBERTO, id `66d1b2b5…`):

```text
Cliente: "Oi"
Bot:  [step capture_conta] "Perfeito! 🙌 📸 Me envia agora uma foto da sua conta de luz…"
Cliente: [foto da conta]
Bot:  "✅ SIM"  (confirmação dos dados extraídos)
Bot:  [ask_quero_cadastrar] "Pra continuar seu cadastro… toque no botão"  ← INTERMEDIÁRIO INDESEJADO
       botão "✅ Quero me cadastrar"
Cliente: clica em "Quero me cadastrar"
Bot:  [capture_documento] "Show! 🙌 Agora preciso… RG/CNH"
Cliente: [foto do doc]
Bot:  confirmação dos dados do doc
Bot:  [ask_phone_confirm] → ask_phone → ask_email
Cliente: "livro@gmail.com"
Bot:  "❌ CEP inválido. Informe os *8 números*:"  ← BOT FORÇOU ask_cep
```

Causas no código:

- **Etapa "Quero me cadastrar"** é injetada manualmente entre `capture_conta` e `capture_documento` em quatro blocos (dois em `evolution-webhook/handlers/bot-flow.ts` por volta das linhas 3793, 3845, 3877 e o `case "ask_quero_cadastrar"` na 5107; espelhado em `whapi-webhook/handlers/bot-flow.ts`). Ela não vem do flow builder.
- **Passo `ask_cep**` é forçado por `conversation-helpers.ts` (`if (!c.cep) return "ask_cep"`) quando o cadastro tenta finalizar sem CEP no banco — o OCR não extraiu CEP da conta, e o helper desvia para CEP em vez de seguir o fluxo do builder.

## O que vou mudar

### 1. Pular a etapa "Quero me cadastrar"

Nos quatro blocos de `evolution-webhook/handlers/bot-flow.ts` e `whapi-webhook/handlers/bot-flow.ts` que após `confirmando_dados_doc`/confirmação da conta enviam o CTA "✅ Quero me cadastrar", trocar o efeito para:

- não enviar o CTA;
- não setar `conversation_step = "ask_quero_cadastrar"`;
- despachar direto o próximo passo do flow (`capture_documento`), reutilizando a mesma rotina já usada dentro do `case "ask_quero_cadastrar"` quando o usuário responde "sim".

O `case "ask_quero_cadastrar"` continua existindo (defensivo) para leads antigos que já estão travados nesse estado — ele responde "sim" automaticamente.

### 2. Não pedir CEP em momento nenhum

- Em `_shared/conversation-helpers.ts`: remover a linha que retorna `ask_cep` quando `!c.cep`. Se faltar CEP, a função deixa o fluxo seguir normalmente (continua no próximo passo do builder).
- Em `evolution-webhook/handlers/bot-flow.ts` e `whapi-webhook/handlers/bot-flow.ts`: nos três blocos de "redirect para ask_cep" depois de erro de validação (`err.includes("CEP"/"Cidade"/"Estado")`), trocar o redirect por um log + seguir adiante (ou tentar ViaCEP silencioso a partir do que existir). Não enviar mensagem pedindo CEP ao cliente.
- O `case "ask_cep"` permanece no switch (defensivo, para leads já travados) mas não é mais alcançável pelo fluxo novo.

### 3. Primeira mensagem

A primeira mensagem do bot já é exatamente "Perfeito! 🙌 📸 Me envia agora uma *foto da sua conta de luz*…" vinda do step `capture_conta` do flow. Pelo que entendi você quer manter essa como porta de entrada (sem outro welcome antes) — então **não vou alterar o texto**, só garantir que ela continue sendo a primeira (já é).

### 4. Limpar lead atual para teste

Resetar o estado do PAULO ROBERTO (`66d1b2b5…`) para o início do fluxo, para você poder testar de novo do "Oi".

## O que NÃO vou mexer

- Texto dos steps no flow builder (capture_conta, capture_documento, capture_email, confirm_phone, finalizar_cadastro).
- Lógica de OCR e extração da conta.
- Outros caminhos do bot (reativação, pós-venda, etc.).

## Antes de implementar — preciso confirmar 2 coisas:

1. **Sem CEP de jeito nenhum?** Hoje o portal iGreen exige CEP no cadastro. Se a gente nunca pergunta e o OCR não extrair, o `finalizar_cadastro` vai falhar no portal. Você quer: **(a)** nunca pedir, deixar falhar/usar default, ou **(b)** só pedir CEP se o OCR não tiver pego, e usar ViaCEP silencioso se tiver cidade/estado/rua? OCR PEGA A DA CONTA, MAS AS VESES A ACONTA NAO ESTA COM O CEP DA RUA E SIM DA CIDADE, AI AOTUMANTICAMENTE ENTRA O BUSCA CEP CORRETO
2. **Confirmação dos dados da conta** (o "✅ SIM" após OCR) — mantém ou também remove? mantem o sim completo com o editar, analise para ficar igual, 
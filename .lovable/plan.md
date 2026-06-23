# Avisar quando o canal Whapi estiver bloqueado por pagamento

## Problema

Quando o canal Whapi é suspenso por falta de pagamento, a API responde com `404 Channel not found` (ou erros tipo `unpaid` / `suspended` / `blocked`). Hoje o proxy converte tudo em um genérico **"Canal Whapi offline ou token inválido"**, então o Super Admin perde tempo tentando trocar token, escanear QR, etc., sem saber que o problema é financeiro no painel da Whapi.

## O que vai mudar

### 1. `whapi-proxy/index.ts` — classificar o motivo da falha
- Ao receber resposta da Whapi, inspecionar `status` + corpo (`error.code`, `error.message`, `reason`).
- Mapear para um `reasonCode` explícito:
  - `unpaid` → HTTP 402, mensagem: *"Canal Whapi bloqueado por falta de pagamento. Acesse panel.whapi.cloud → Billing para regularizar."*
  - `channel_not_found` → HTTP 404, mensagem: *"Canal Whapi não existe mais (foi removido). Crie um novo canal e atualize o token."*
  - `invalid_token` → HTTP 401, mensagem: *"Token Whapi inválido. Cole o token novo do painel."*
  - `offline` (QR/desconectado) → HTTP 503 atual.
- Retornar JSON `{ error, reasonCode, helpUrl: "https://panel.whapi.cloud/billing" }`.
- `health_check` também devolve `reasonCode` para o card.

### 2. `useWhapiHealth.ts` — expor `reasonCode` + `helpUrl`
- Guardar último `reasonCode` no estado.
- Polling continua igual, só passa a informação adiante.

### 3. `WhapiConnectionPanel.tsx` — UI explícita
- Quando `reasonCode === "unpaid"`: banner **vermelho destacado** "Canal bloqueado por falta de pagamento na Whapi" + botão *"Abrir billing da Whapi"* (link para `panel.whapi.cloud/billing`) **antes** dos campos de token/QR (que ficam desabilitados, porque trocar token não resolve).
- Quando `channel_not_found`: banner laranja "Canal removido — crie um novo" com link para `panel.whapi.cloud`.
- Quando `invalid_token`: foca no campo de token.
- Mantém o fluxo atual para `offline`/`QR`.

### 4. Banner global no chat (Super Admin)
- Em `WhatsAppTab` (ou onde o chat renderiza), quando `reasonCode === "unpaid"`, mostrar um **alerta fixo no topo** com a mesma mensagem e CTA, para o problema ser visível mesmo fora do painel de conexão.

### 5. Toast no envio falho
- No hook de envio (onde hoje aparece o 503 genérico), ler `reasonCode` da resposta e mostrar toast específico ("Pagamento Whapi pendente" etc.) em vez do texto atual.

## Arquivos

- `supabase/functions/whapi-proxy/index.ts` — classificar erros, devolver `reasonCode`/`helpUrl`.
- `src/hooks/useWhapiHealth.ts` — expor novos campos.
- `src/components/whatsapp/WhapiConnectionPanel.tsx` — banners por motivo + CTA billing.
- `src/components/whatsapp/WhatsAppTab.tsx` — banner global "pagamento pendente" para Super Admin.
- `src/hooks/useWhatsApp.ts` — propagar `reasonCode` nos toasts de erro de envio.
- `mem/whatsapp/superadmin-whapi.md` — anexar a regra: "Se Whapi responder 404/`unpaid`/`suspended`, o sistema deve avisar imediatamente que é problema de pagamento, não tentar reconectar."

## Resultado

Da próxima vez que o canal cair por pagamento, o Super Admin vê na hora um aviso vermelho com link direto para o billing da Whapi, em vez de perder tempo trocando token.

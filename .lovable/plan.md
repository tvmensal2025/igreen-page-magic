# Cadastrar sempre aceso + escolha de envio ao cliente

## Problema
No card do lead `11971254913`, o botão **Finalizar Cadastro** está desabilitado (bloqueado por campos faltantes / passos não enviados). Você quer:

1. O botão **sempre aceso** — mesmo com campos faltando — para você poder cadastrar manualmente quando quiser.
2. Quando o **bot estiver desligado** naquele lead, ao clicar em Cadastrar deve aparecer um **pop-up perguntando se quer avisar o cliente no WhatsApp** (sim/não). Só envia a mensagem "Estamos enviando seu cadastro…" se você confirmar.
3. Comportamento válido **apenas no modo manual** (captação).

Hoje o `finalize-capture` sempre dispara o aviso ao cliente, sem perguntar.

## Mudanças

### 1. `src/components/captacao/FinalizeButton.tsx`
- Remover `disabled={!canFinalize}`. Botão sempre clicável.
- Manter o aviso de "Falta: …" apenas como alerta visual (não bloqueia).
- Novas props: `botPaused: boolean`, `captureMode: "manual" | "auto" | string`.
- Ao clicar:
  - Se `captureMode === "manual"` **e** `botPaused === true` → abrir um `AlertDialog` (shadcn) com:
    - Título: "Avisar o cliente no WhatsApp?"
    - Texto: "O bot está desligado para este lead. Deseja enviar a mensagem 'Estamos enviando seu cadastro ao portal' agora?"
    - Botões: **Enviar mensagem e cadastrar** / **Cadastrar sem avisar** / Cancelar.
  - Caso contrário → segue direto (envia aviso, comportamento atual).
- Chama `supabase.functions.invoke("finalize-capture", { body: { customerId, consultantId, sendNotice } })` passando o booleano escolhido.

### 2. `src/components/captacao/CaptacaoPanel.tsx`
- Ler `bot_paused` e `capture_mode` do customer já carregado (ou via `session`) e passar como props para os dois `<FinalizeButton>`.

### 3. `supabase/functions/finalize-capture/index.ts`
- Aceitar `sendNotice` no body (default `true` para manter compatibilidade).
- Só chamar `sendWhatsAppNotice(...)` se `sendNotice !== false`.
- Resto da lógica (validação, regenerar igreen_link, dispatch worker) **não muda** — o cadastro continua acontecendo independente da escolha.

## Fora de escopo
- Não muda a validação de 10 campos no servidor: se faltar dado obrigatório, o `finalize-capture` ainda retorna `incomplete` e mostra toast. O botão fica aceso, mas o servidor protege a integridade. Se você quiser permitir cadastro **incompleto**, é outra mudança (mais arriscada) — me avise.
- Não mexe no `bot-flow`, no orquestrador de IA, nem no worker-portal-2.
- Não muda o comportamento quando o bot está ativo (continua avisando o cliente automaticamente).
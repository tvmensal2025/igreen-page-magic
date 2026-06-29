## Problemas reportados

1. **Conversa do WhatsApp** — algumas mensagens (enviadas pelo bot e recebidas do lead) não aparecem no painel.
2. **Captação** — alguns leads do tráfego (CTWA / anúncio) ainda não aparecem na aba Captação.

Mantendo o escopo só em frontend/serviço de leitura (não mexo no motor do bot, anti-ban, RLS de envio).

---

## 1. Mensagens sumidas no chat

`src/hooks/useMessages.ts` busca o histórico via Evolution/Whapi com `limit = 50` por chat. Numa conversa ativa (bot manda 3–8 mídias + lead responde várias vezes), 50 estoura rápido e as primeiras mensagens **somem do topo** — exatamente o sintoma "não aparece tudo".

Além disso:
- `fetchMessages` substitui o array inteiro a cada poll; quando o provedor (Whapi/Evolution) demora a indexar a mensagem recém-enviada, ela some entre dois polls (flicker de "mensagem que aparece e desaparece").
- O fallback "📎 Mensagem não suportada" só dispara se a chave não for `messageContextInfo`; tipos como `buttonsResponseMessage`, `listResponseMessage`, `templateButtonReplyMessage` (botões numerados do Fluxo D que o consultor responde) caem no else mas, dependendo do payload, o texto vem em `selectedDisplayText`/`selectedButtonId` — hoje renderiza como vazio.

**Correções:**

a) Subir o limite padrão de 50 → **200** e expor "Carregar mais antigas" (chama `findMessages`/`whapiListMessages` com limite maior por demanda). Reduz drasticamente o caso de "sumiu do topo".

b) **Merge incremental** no `fetchMessages`: em vez de `setMessages(mapped)`, fundir com o estado anterior por `id`, preservando mensagens otimistas/recém-enviadas até o provedor confirmar. Elimina o flicker de "apareceu e sumiu".

c) Ampliar `mapMessage` para extrair texto dos tipos interativos comuns:
   - `buttonsResponseMessage.selectedDisplayText` / `selectedButtonId`
   - `listResponseMessage.title` / `singleSelectReply.selectedRowId`
   - `templateButtonReplyMessage.selectedDisplayText`
   - `pollCreationMessage.name` (enquete)
   - `reactionMessage.text` (rótulo "Reagiu: 👍")
   - `locationMessage` → "📍 Localização compartilhada"

d) Sub-rotina **fallback Supabase**: quando o provedor retorna < N mensagens mas a tabela `conversations` (que o webhook do bot popula) tem registros mais antigos para o mesmo telefone, fazer merge dos dois feeds (Evolution/Whapi + `conversations`) por timestamp. Garante que **toda mensagem que o bot enviou ou recebeu** apareça mesmo se a Evolution/Whapi limpar histórico/perder mídia.

---

## 2. Leads do tráfego sumindo da Captação

`listCapturedLeads` lê só `captured_leads`. Leads que entram via CTWA do anúncio Meta caem primeiro em `customers` (criados pelo webhook do WhatsApp) e só vão pra `captured_leads` quando a Edge Function `captacao-backfill-ctwa` roda — se ela falha ou ainda não rodou pra aquele lead, ele **não aparece**.

**Correções:**

a) `CapturedLeadsPanel`: adicionar **botão "Atualizar do tráfego"** que dispara `captacao-backfill-ctwa` sob demanda e dá refetch — consultor não fica esperando cron.

b) `listCapturedLeads`: opcionalmente fazer **union view** lendo também `customers` com `origin in ('ctwa','meta_ad','facebook_ad')` que ainda não tenham linha equivalente em `captured_leads` (match por telefone), apresentando-os com tag visual "📡 do tráfego — ainda não migrado". Evita lead invisível até a próxima execução do backfill.

c) Verificar a função `captacao-backfill-ctwa` (logs e critérios de match) para confirmar se o filtro de canal/origin não está excluindo leads válidos. Se estiver, ampliar os valores aceitos.

---

## Arquivos afetados

```text
src/hooks/useMessages.ts                    (limite + merge + tipos interativos)
src/components/whatsapp/ChatView*.tsx       (botão "carregar mais antigas")
src/services/capturedLeads.ts               (union opcional customers+captured_leads)
src/components/captacao/CapturedLeadsPanel.tsx  (botão "Atualizar do tráfego")
supabase/functions/captacao-backfill-ctwa/index.ts  (revisar critérios)
```

Sem mexer em: motor do bot, anti-ban, RLS, envio Evolution/Whapi, worker do portal.

---

## Validação

- Abrir uma conversa antiga com 70+ mensagens → todas visíveis (com paginação).
- Bot envia mídia + texto → aparece na hora, sem sumir no próximo poll.
- Mensagem de botão respondida pelo lead → renderiza o texto da opção.
- Lead de anúncio acabou de chegar → aparece em Captação clicando "Atualizar do tráfego".

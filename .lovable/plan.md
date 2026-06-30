## Auditoria — mídias pós-venda na base

Tabela `pos_venda_default_media` (fallback institucional usado quando o consultor não customizou):

| Estágio | Texto | Áudio | Imagem | Ativo |
|---|---|---|---|---|
| aprovado | ✅ | ✅ | ✅ | ✅ |
| reprovado | ✅ | ✅ | ✅ | ✅ |
| d30 | ✅ | ✅ | ✅ | ✅ |
| d60 | ✅ | ✅ | ✅ | ✅ |
| d90 | ✅ | ✅ | ✅ | ✅ |
| d120 | ✅ | ✅ | ✅ | ✅ |

Os 6 estágios estão completos (texto + áudio `.ogg` + imagem `.jpg`).

## Regra de canal (conforme pedido do usuário)

- **Cada consultor envia pela própria Evolution** (comportamento atual de `resolveChannelForCustomer`).
- Whapi só é usado quando o próprio usuário/consultor está configurado em Whapi (ex.: Super Admin).
- **Não vamos forçar Whapi** no pós-venda.

## Diagnóstico do "chegou só a imagem"

`sendSingleMessage` (`_shared/channel-sender.ts` linhas 258–295) já tenta imagem → áudio → texto quando o estágio é tipo `audio` com `image_url`. A lógica está correta, mas na Evolution o `sendAudio` falha silenciosamente em parte dos envios (sem exception, sem log útil) e o log final marca `status: sent` mesmo assim, escondendo o problema.

## Plano de correção (sem enviar nada agora)

### 1. Tornar o envio das 3 peças observável
`sendSingleMessage` passa a embrulhar cada peça (imagem / áudio / texto) em `try/catch` próprio e retorna um objeto `{ image_ok, audio_ok, text_ok, errors }`.

### 2. Retry leve só para áudio na Evolution
Quando `channel.kind === "evolution"` e `sendAudio` falhar (exception OU resposta sem messageId), aguardar 1,5s e tentar 1 vez de novo. Imagem e texto não precisam — quase nunca falham.

### 3. Log honesto em `customer_auto_message_log`
Trocar o `status: "sent"` cego por:
- `sent` → todas as peças OK.
- `partial:audio_missing` / `partial:image_missing` → faltou algo. `message_preview` ganha `[img:ok|audio:fail|text:ok]`.
- `failed` → nada chegou.
Assim o painel `/admin/portal-monitor` mostra exatamente onde a Evolution falhou, por consultor.

### 4. Fallback final do áudio
Se mesmo com retry o áudio falhar na Evolution, enviar uma 4ª mensagem curta de texto: "🎧 Áudio: <link>" usando a URL pública do MinIO. Garante que o conteúdo do áudio chegue de alguma forma sem trocar o canal do consultor.

### 5. Nenhum disparo agora
As mudanças só passam a valer no próximo disparo natural (aprovação real ou cron diário d30/60/90/120). Sem teste manual.

## Arquivos alterados
- `supabase/functions/_shared/channel-sender.ts` — `sendSingleMessage` com try/catch por peça + retry de áudio + fallback link.
- `supabase/functions/pos-venda-auto-progress/index.ts` — usar o novo retorno e gravar status detalhado em `customer_auto_message_log`.

Nenhuma mudança de schema, nenhuma mudança de canal, nenhum envio de teste.
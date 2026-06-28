# Plano: zerar OOM no `evolution-webhook` sem regredir nada

## Princípio
Nenhuma mudança de comportamento do bot. Só **onde** os bytes vivem e **por quanto tempo**. Se qualquer etapa falhar, cai no caminho atual (fail-open). Nada de "quebrar igual o whapi".

## O que causa o OOM hoje (medido nos logs que você mostrou)
1. `sender.downloadMedia()` retorna **base64** (string ~1.33× o tamanho do arquivo).
2. Mesmo arquivo vira **3 cópias vivas** ao mesmo tempo no heap: `fileBase64` (string) + `data:${mime};base64,${b64}` (string maior ainda, jogada em `fileUrl`) + `Uint8Array` quando vai pro MinIO. Uma foto de 4MB consome ~24MB.
3. Esse `fileBase64` é **passado adiante** para `runBotFlow` e gravado em `customers.bill_base64` — segue vivo até o fim do request.
4. Quando duas mensagens chegam quase juntas no mesmo isolate, dobra tudo → passa de 256MB → SIGKILL no meio da resposta → bot "trava" (foi o caso da Silvia depois do `d_como_funciona`).
5. Bonus: `bot-flow.ts` tem 5.956 linhas carregadas no cold-start mesmo quando a mensagem é só "oi".

## Mudanças (apenas em `supabase/functions/evolution-webhook/`)

### 1. Uma única cópia dos bytes (mudança principal, baixo risco)
- Manter `downloadMedia` como está (retorna base64 — API externa, não mexo).
- Converter **imediatamente** para `Uint8Array` em uma variável `fileBytes`.
- Setar `fileBase64 = null` e **não** construir `fileUrl = data:...` (a string gigante).
- Quando OCR/transcrição precisarem de base64, gerar **sob demanda** dentro do `fetch` (`btoa` em chunks) e soltar a referência logo após.
- Parar de gravar `bill_base64` no `customers.update` (a foto já vai pro MinIO; guardar base64 no Postgres infla toda leitura futura do lead). **Antes** vou grepar todo o repo para ver se algo lê `bill_base64`; se ler, mantenho a coluna mas paro de reescrever (já existe valor antigo) e abro item separado para limpar consumidores.

**Ganho estimado:** ~60% menos heap por request com mídia.

### 2. Imports preguiçosos do que é pesado
- `import("./handlers/bot-flow.ts")`, `import("../_shared/media-storage.ts")`, `import("./handlers/otp-intercept.ts")` movidos para `await import` dentro dos branches que realmente precisam.
- Texto curto sem mídia não paga o custo de carregar OCR/MinIO/Gemini helpers.

**Ganho:** cold-start mais leve, menos pressão em isolates com 2 requests concorrentes.

### 3. Limite duro de histórico
Toda query de `conversations` para montar contexto/prompt ganha `.order('created_at', { ascending: false }).limit(20)`. Hoje algumas não têm limit e o Supabase devolve o default de 1000 — em leads antigos isso é megabytes.

### 4. Lock de concorrência por telefone (proteção)
Já existe `customer_processing_lock`. Vou garantir que **toda entrada** do webhook tenta `try_acquire` e, se falhar, responde `200 OK` enfileirando em `whatsapp_message_buffer` (tabela também já existe). Isso impede dois handlers do mesmo lead viverem no mesmo isolate — que é o gatilho do OOM nas conversas rápidas.

### 5. Guard final (cinto + suspensório)
No `catch` global do handler: se a exceção for `Memory limit exceeded` ou `WORKER_LIMIT`, gravar `engine_logs` com kind `webhook_memory_pressure` + `inbound_media_retry.insert` com o payload bruto. Cron já existente reprocessa em <30s. Bot nunca fica mudo sem deixar rastro.

## O que NÃO vou fazer (decisões para evitar o "erro do whapi")
- **Não** vou mover OCR de conta/doc para background. Esses passos dependem do resultado para responder — manter síncrono, só com bytes únicos.
- **Não** vou mexer em `whapi-webhook`, `bot-flow.ts` (lógica), prompts, ou no servidor Evolution.
- **Não** vou tocar em schema (a coluna `bill_base64` continua existindo; só paro de escrever).
- **Não** vou ativar engine v3 nem mudar feature flags.

## Verificação (ordem obrigatória)
1. Deploy → ler logs `evolution-webhook` por 60s procurando boot errors.
2. Você manda **texto "oi"** no 5514998155015 → confirmar resposta + zero `Memory limit` em 5 min.
3. Você manda **uma foto de conta** no mesmo número → confirmar OCR + upload MinIO + bot avança para próximo step.
4. Você manda **3 mensagens em rajada** (texto, texto, foto) → confirmar que nenhuma é perdida (ou via resposta direta, ou via `whatsapp_message_buffer` reprocessado).
5. Se aparecer **qualquer** `Memory limit exceeded` em 24h, eu aperto: histórico para 10, lazy-import agressivo no `_helpers.ts`, e investigo se algum step específico do fluxo carrega tabela inteira.

## Risco e rollback
- Todas as mudanças são em **arquivos do `evolution-webhook` apenas**. Rollback = redeploy do commit anterior, sem migração de banco para reverter.
- A coluna `bill_base64` continua lendo o valor antigo enquanto eu confirmo que ninguém depende dela.

## Nota sobre `.lovable/`
Esse plano está em `.lovable/plan.md`, que seu `.gitignore` exclui — então ele não vai pro git. Quer que eu remova `.lovable/` do `.gitignore` para o plano persistir entre snapshots?

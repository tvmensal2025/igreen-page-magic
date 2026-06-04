## Objetivo

Fechar as 4 pendências reconhecidas na auditoria para eliminar de vez o risco de ban e os bugs de UX dos botões.

---

## 1. Aplicar `check_send_quota` em cada envio do bot (anti-ban real)

**Problema:** o hard-lock cobre o caso fatal, mas durante operação normal o `bot-flow` chama `sendText`/`sendMedia` direto, sem respeitar:

- intervalo mínimo entre mensagens (warmup),
- quota diária,
- janela de horário,
- `recovery_mode` (modo lento).

**Correção:**

- Criar wrapper `safeSend(instanceId, to, fn)` em `supabase/functions/bot-flow/_send.ts` que:
  1. chama RPC `check_send_quota(instance_id)` antes de enviar;
  2. se bloqueado → retorna `{ ok:false, reason }` e NÃO avança `conversation_step`;
  3. se ok → executa o envio, registra `register_message_sent(instance_id)` e respeita jitter (1.5–4s) + delay extra se `recovery_mode_until` ativo (8–15s).
- Substituir todas as chamadas diretas a `sendText`/`sendMedia`/`sendButtons` em `bot-flow/index.ts` e handlers por `safeSend`.
- Em caso de bloqueio por quota, logar em `bot_send_blocked_log` (nova tabela leve) para auditoria.

---

## 2. Não avançar `conversation_step` em falha de envio

**Problema:** ~12 pontos no `bot-flow` fazem `await sendText(...)` e logo depois `update conversation_step = X` mesmo se o envio retornou `false`. Lead fica preso em estado errado.

**Correção:**

- `safeSend` retorna boolean/objeto; todo `update` de step passa a ser condicional:  
`if (result.ok) await advanceStep(...)` else `await markRetry(...)`.
- Adicionar tabela `bot_send_failures` (lead_id, step, error, retry_count, next_retry_at) e cron leve (1 min) que reprocessa pendentes até 3x.
- Auditar e corrigir os 12 call sites (handlers de boas-vindas, OCR, indicação, agendamento, etc.).

---

## 3. Botões reais (substituir fallback numerado)

**Problema:** `sendButtons` cai sempre em texto numerado ("1 - Sim / 2 - Não"), o que confunde leads e força digitação livre (mais erros, mais retrabalho do bot).

**Correção:**

- Verificar se a Evolution API conectada suporta `/message/sendButtons` (Baileys legacy não, Cloud API sim).
- Se Cloud API disponível → implementar envio nativo de buttons/list em `sendButtons` com fallback automático para texto numerado apenas se a API retornar 4xx.
- Se só Baileys → implementar **list message** (`/message/sendList`) que ainda funciona em Baileys recentes, com fallback numerado.
- Centralizar a detecção de capacidade em `instance_capabilities` (cacheada por 1h) para não pingar a API a cada envio.

---

## 4. Erro de hook no console (`RESET_BLANK_CHECK` / re-render)

**Problema:** após adicionar `useState(fatalLocked/fatalReason)` no `useWhatsApp`, surgiu warning de hook em HMR.

**Correção:**

- Revisar `useWhatsApp.ts`: garantir que `useState`/`useEffect` novos estejam no topo do hook (ordem fixa), nunca dentro de condicionais.
- Mover leitura de `manual_review_required`/`fatal_lock_until` para o mesmo `useEffect` que já faz fetch da instância (evita effect duplicado).
- Validar com reload da preview que warning some.

---

## Arquivos afetados

- `supabase/functions/bot-flow/index.ts` e handlers
- `supabase/functions/bot-flow/_send.ts` (novo)
- `supabase/functions/_shared/evolution.ts` (sendButtons/sendList)
- `src/hooks/useWhatsApp.ts`
- Migrations: `bot_send_blocked_log`, `bot_send_failures`, `instance_capabilities`, cron de retry.

## Critério de aceite

- Nenhum `sendText` no bot-flow sem passar por `safeSend`.
- `conversation_step` só avança em envio confirmado.
- Botões nativos quando suportados; fallback só em erro real.
- Console limpo de warnings de hook.
- Instância `igreen-953f7e48509b` continua em hard-lock até 2026-06-18 (não tocada).

Posso prosseguir? Sim
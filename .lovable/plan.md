# Plano de Correção e Investigação de Bloqueio de Envios

O usuário informou que a alteração anterior no Dashboard foi indevida e que o problema real é operacional: leads que receberam mensagens em massa hoje deveriam estar bloqueados/em handoff, mas o sistema parece estar enviando mensagens (prospecção ou IA) para eles.

## Análise do Problema
1. **Contexto:** Ontem implementamos uma trava para que envios via "Bulk Pro" coloquem o lead em `bot_paused = true` com motivo `bulk_pro` e tempo de 48h (handoff).
2. **Sintoma:** O usuário relata que leads que receberam massa hoje "não deveriam receber msg", mas aparentemente receberam.
3. **Hipótese:** O motor de cadência (`cadence-tick`) ou a Sofia (`ai-agent-router`) pode estar ignorando o status de bloqueio/pausa por `bulk_pro` ou o `afterSendAction` do disparo em massa não foi aplicado corretamente a todos os leads.

## Alterações Propostas

### 1. Reversão de Texto no Dashboard
- **Arquivo:** `src/components/admin/DashboardTab.tsx`
- **Ação:** Restaurar o rótulo original "Total de cadastros" (ou "Cadastros") no primeiro `StatCard` para limpar a interface.

### 2. Investigação e Reforço do Bloqueio (Handoff Bulk)
- **Arquivo:** `supabase/functions/cadence-tick/index.ts` (ou similar que processe a fila).
- **Ação:** Garantir que o filtro de clientes elegíveis EXCLUA explicitamente quem tem `bot_paused = true` OU quem teve disparo em massa recente (motivo `bulk_pro`).
- **Arquivo:** `supabase/functions/bulk-scheduler/index.ts`.
- **Ação:** Verificar se a marcação de `bot_paused` está sendo aplicada corretamente no loop de processamento do disparo.

### 3. Ajuste de Runtime Guard (Sofia)
- **Arquivo:** `supabase/functions/ai-agent-router/index.ts`.
- **Ação:** Reforçar a verificação de `bot_paused` antes de processar qualquer resposta da IA, garantindo que se o motivo for `bulk_pro`, a IA permaneça em silêncio absoluto.

## Verificação
1. Simular um disparo em massa (dry-run) e verificar se o campo `bot_paused` é atualizado no banco.
2. Validar a lógica de `isBotPaused` nos motores de envio.

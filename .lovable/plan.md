## Aviso ao rodízio quando a campanha for pausada

Hoje o rodízio recebe a mensagem única de "campanha aprovada pela Meta" (via `rodizio-metrics-broadcast` → `formatCampaignApprovedMessage`) e depois o card de métricas de 1 em 1 hora. Não existe nenhum aviso quando a campanha é pausada — o parceiro fica sem entender por que os leads pararam.

Vou espelhar o mesmo padrão para pausas: uma mensagem única por evento de pausa, tranquilizadora, com o motivo específico (aquecimento/teste/ajuste/saldo/etc), e sem duplicar.

### Motivos de pausa que vou cobrir

O sistema pausa campanhas em 4 pontos hoje:

1. `**facebook-toggle-campaign**` — pausa manual pelo admin/consultor. Reason: `manual`.
2. `**facebook-balance-check**` — pausa quando o saldo Meta zera. Reason: `low_balance`.
3. `**facebook-sync-metrics**` — 3 caminhos:
  - `end_time` atingido → reason: `ended`
  - Anúncio rejeitado pela Meta → reason: `rejected`
  - Auto-pause por performance ruim → reason: `auto_performance`
4. `**facebook-auto-pause**` — pausa por regras de performance. Reason: `auto_performance`.

### Mensagens (sempre positivas, tom de "estamos cuidando")

Nova função `formatCampaignPausedMessage(campaignName, reason)` em `supabase/functions/_shared/rodizio-metrics-format.ts` que devolve textos como:

- **manual** → "⏸️ *Campanha em ajuste*\n🎯 {name}\n\nPausamos temporariamente para *otimizar o desempenho* e trazer leads de mais qualidade. Fique tranquilo(a) — voltamos em breve! 💪"
- **low_balance** → "⏸️ *Pausa rápida para recarga*\n🎯 {name}\n\nEstamos *recarregando o saldo* da campanha. Assim que entrar, os leads voltam automaticamente. 🚀"
- **ended** → "🏁 *Campanha concluída*\n🎯 {name}\n\nEssa fase acabou! Obrigado pela parceria — em breve começamos uma nova rodada. 🙌"
- **rejected** → "⏸️ *Ajuste de criativo*\n🎯 {name}\n\nA Meta pediu um pequeno ajuste no anúncio. Já estamos *revisando e reenviando* — em algumas horas voltamos ao ar. ✅"
- **auto_performance** → "🧪 *Fase de aquecimento/teste*\n🎯 {name}\n\nO sistema pausou para *testar novas variações* e melhorar o custo por lead. É rotina de otimização — os leads voltam em breve! 🔥"

Fallback genérico ("Pausa temporária para otimização — voltamos logo") para qualquer razão não mapeada.

### Como não duplicar

**1. Migração**

```sql
ALTER TABLE public.rodizio_pools
  ADD COLUMN paused_notified_at timestamptz,
  ADD COLUMN last_pause_reason text;
```

**2. Novo helper** `supabase/functions/_shared/rodizio-pause-notify.ts`:

- `notifyRodizioOnCampaignPaused(supabase, campaignId, reason)`:
  1. Busca `rodizio_pools` do `campaignId` onde `paused_notified_at IS NULL`.
  2. Para cada pool, busca membros elegíveis (`is_active`, `rodizio_metrics_enabled`, com `notification_phone`).
  3. Insere em `outbound_message_log` com `idempotency_key = 'rodizio_paused:{partner_id}:{campaign_id}:{iso_pause_bucket}'`. Erro 23505 = já enviado, pula.
  4. Chama `sendRawToNumber(consultant_id, phone, text)`.
  5. Marca `paused_notified_at = now()` e `last_pause_reason = reason` no pool.

**3. Reset ao reativar** — em `facebook-toggle-campaign` no branch `activate`:

```ts
await admin.from("rodizio_pools")
  .update({ paused_notified_at: null, last_pause_reason: null })
  .eq("campaign_id", c.id);
```

Assim, se pausar → reativar → pausar de novo, dispara a mensagem outra vez (evento novo).

### Onde chamar `notifyRodizioOnCampaignPaused`

- `facebook-toggle-campaign/index.ts` — após o update para `paused`, chamar com `reason="manual"`.
- `facebook-balance-check/index.ts` — nas 2 chamadas de `?status=PAUSED`, chamar com `reason="low_balance"`.
- `facebook-sync-metrics/index.ts` — nos 3 pontos: `end-time` (`reason="ended"`), `pre-pause` de rejeição (`reason="rejected"`), `auto-pause` de performance (`reason="auto_performance"`).
- `facebook-auto-pause/index.ts` — para cada campanha pausada no loop (`reason="auto_performance"`).

Todas as chamadas dentro de `try/catch` isolado — falha de notificação nunca deve bloquear a pausa em si.

### Fora de escopo

- Não muda o card de métricas de 1 em 1 hora.
- Não muda a mensagem de "aprovada pela Meta" (já OK).
- Não muda o comportamento de pause/activate no Meta.

### Arquivos alterados/criados

- Migração: coluna `paused_notified_at` + `last_pause_reason` em `rodizio_pools`.
- Criar `supabase/functions/_shared/rodizio-pause-notify.ts`.
- Editar `supabase/functions/_shared/rodizio-metrics-format.ts` (adicionar `formatCampaignPausedMessage`).
- Editar `facebook-toggle-campaign/index.ts`, `facebook-balance-check/index.ts`, `facebook-sync-metrics/index.ts`, `facebook-auto-pause/index.ts`.

Aprovado? sim  
  
E COLOQUE PARA CRIAR CAMPANHA EU POSSO COLOCAR UM NOME NA FRENTE E DEPOIS O SISTEMA COLOCA O PADRAO ATUAL, ASSIM EU DIFERENCIO UMA DA OUTRA.  

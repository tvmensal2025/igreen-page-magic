## Diagnóstico (dados reais consultados agora)

Consultei `lead_cadence_state` e a divergência é clara:

| Segmento | Qtd | Aparece na Pizza? | Aparece em "Próximos envios"? |
|---|---|---|---|
| COLD_1 congelado (`manual_admin_clear_sla_backlog`) | 61 | ❌ excluído | ✅ **aparece** |
| PAUSED `dnc` | 17 | ❌ excluído | ✅ **aparece** |
| PAUSED `handoff_humano` | 4 | ❌ excluído | ✅ **aparece** |
| PAUSED `invalid_phone` | 12 + 5 + 3 = 20 | ❌ perdido (sem `prev`) | ✅ **aparece** |
| `not_lead_outside_dddXX` | 5 | parcialmente | ✅ **aparece** |
| AI_QUALIFYING / GREETED / COLD_1 sem pause | ~52 | ✅ pizza A/B | ✅ aparece |
| PAUSED `lead_responded[:A]` | 30 | ✅ pizza A "flow" | ✅ aparece |

**Total agendado bruto:** 185 (hub mostra 143 depois de dedup/cortes) — **Total na pizza:** ~82.

**Causa raiz:** o hook `useAgendamentosHub` (`src/hooks/useAgendamentosHub.ts` L117-124) lê `lead_cadence_state` **sem nenhum filtro de elegibilidade**, enquanto `ReheatCyclePizza` aplica `isCycleLeadEligible` (exclui `manual_admin_clear_sla_backlog`, `dnc`, `handoff_humano`, `opt_out`, `invalid_phone`, DND, origens iGreen wallet, status já aprovado/rejeitado, etc.).

Resultado: o painel de agendamentos exibe pessoas que o motor **nunca vai despachar** (o próprio `cadence-tick` também pula esses `paused_reason`), causando a sensação de "cadê essas pessoas na pizza?".

## O que fazer

Alinhar **1 fonte de verdade** para "quem está no ciclo A/B/C": mesma regra na pizza, no hub de agendamentos e no motor.

### 1. Extrair filtro compartilhado
Criar `src/lib/cycleEligibility.ts` exportando:
- `FROZEN_PAUSE_REASONS` (incluindo os que faltavam: `invalid_phone`, `not_lead_outside_ddd*`, `opt_out`, `dnc:*`)
- `isCycleLeadEligible(customer, pausedReason)` — mesma lógica de hoje em `ReheatCyclePizza.tsx` L181-199
- `isPausedGroupA(pausedReason)` — hoje em L158-170

Refatorar `ReheatCyclePizza.tsx` para importar dessas funções (sem mudar comportamento).

### 2. Aplicar o filtro no hub de agendamentos
Em `src/hooks/useAgendamentosHub.ts`:
- Após buscar `cadenceRows`, carregar de `customers` os campos usados pelo filtro (já busca `name`/`phone_whatsapp` — adicionar `customer_origin, status, conversation_step, portal_submitted_at, do_not_contact` no mesmo `select`).
- Cruzar com `paused_reason` de cada linha (ampliar o `select` de `lead_cadence_state` para incluir `paused_reason`).
- Descartar linhas onde `isCycleLeadEligible` = false OU (`stage='PAUSED'` E não classificável como A/B/C via `paused_reason`).

Isso faz "Próximos envios" mostrar exatamente as mesmas pessoas da pizza.

### 3. Aba "Congelados / fora do ciclo"
Ninguém some sem rastro. Adicionar um contador clicável no cabeçalho do hub ("⏸️ 78 fora do ciclo") que abre uma lista com motivo (`manual_admin_clear_sla_backlog`, `dnc`, `invalid_phone`, `handoff_humano`, …) e ações:
- **Reativar** (limpa `paused_reason`, reagenda `next_action_at` para próximo slot útil)
- **Arquivar** (marca `PAUSED` com `dnc` explícito)

### 4. Limpar `next_action_at` de quem está congelado
Migration/insert único: para todas as linhas com `paused_reason` em `FROZEN_PAUSE_REASONS`, zerar `next_action_at` (o motor já ignora, mas isso remove do "radar futuro" de qualquer view/consulta que só olhe `next_action_at is not null`). Reversível pelo botão Reativar da aba nova.

### 5. Contador da pizza vs. hub — mesma métrica
Trocar o subtítulo "143 Próximos envios" no cabeçalho do admin (`src/pages/AdminAgendamentos*` ou componente equivalente) para usar o mesmo total exibido em "A/B/C no radar", garantindo que o número bata visualmente.

## Riscos e validação

- Motor de envio (`cadence-tick`, `daily-reheat-cron`) não muda — ele já pula esses `paused_reason`. Só estamos alinhando a UI.
- Após aplicar, esperar: Pizza total ≈ Agendamentos "Próximos envios" (±diferenças de manual/pós-venda/campanhas, que continuam separados por design).
- Validação SQL sugerida:
  ```sql
  SELECT count(*) FROM lead_cadence_state l
  JOIN customers c ON c.id = l.customer_id
  WHERE l.next_action_at IS NOT NULL
    AND (l.paused_reason IS NULL OR l.paused_reason IN ('lead_responded','lead_responded:AI_QUALIFYING','lead_responded:NEW','lead_responded:GREETED'))
    AND c.do_not_contact = false
    AND c.status NOT IN ('approved','registered_igreen','cadastro_concluido','rejected','contato_incompleto');
  ```
  Esse número tem que bater com o total da pizza.

## Não faz parte deste plano

- Mudar o motor de disparo (`cadence-tick`) — já filtra correto.
- Mexer em pós-venda, bulk, voice — visíveis separadamente por design.
- Alterar horário/janela — trava de 20h já implementada no turno anterior.

## Validação da blindagem do rodízio

Revisei toda a implementação (migração, edge functions `evolution-webhook` + `whapi-webhook`, helpers `rodizio-cas.ts`, `rodizio-assignment.ts`, `meta-ctwa-fallback.ts`, `notify-consultant.ts` e o card `ManualReviewQueueCard.tsx`). **O núcleo está correto e sem trava**: CAS previne notificar 2 parceiros, o unique index impede 2 pools ativas na mesma campanha, fallback silencioso foi removido, todas as rotas de falha caem na fila manual + WhatsApp pro dono, `logRodizioOutcome` grava rastro (o campo `campaign_match_log.campaign_id` é nullable, então o insert `no_campaign_manual_review` não quebra).

Encontrei **4 ajustes finos** que valem aplicar antes de ligar anúncio real — nenhum é bloqueador, mas fecham brechas residuais.

### Ajustes propostos

**1. `resolveSingleActivePool` ainda está exportada em `meta-ctwa-fallback.ts`**
O comentário diz "removido", mas a função continua no arquivo (linhas 58+). Ninguém importa mais, porém deixar código morto é armadilha — daqui a 2 meses alguém pode reimportar sem saber que ela é justamente o furo original. Remover a função (manter só o comentário-alerta explicando o porquê).

**2. `markManualReview` não sobrescreve motivo quando já está em revisão**
Hoje o filtro `.eq("needs_manual_review", false)` torna a função idempotente, mas se o mesmo lead entrar por 2 motivos (ex.: 1ª msg `rodizio_pool_empty`, 2ª msg `rodizio_rpc_error`), só o 1º motivo fica registrado — o admin vê a razão errada. Ajuste: sempre gravar o motivo mais recente (remover o filtro `.eq(...false)` e sempre atualizar `manual_review_reason`/`manual_review_at`; manter `needs_manual_review = true`).

**3. Atribuição manual não consome turno do rodízio nem notifica parceiro**
No `ManualReviewQueueCard.handleAssign`, quando o admin escolhe um parceiro, o código só faz `UPDATE customers`. Não avisa o parceiro no WhatsApp e não registra `campaign_match_log`. Isso deixa o parceiro sem aviso e o histórico incompleto. Ajuste: após o UPDATE, chamar `notifyPartnerNewLead` (via nova edge function fina `assign-lead-manual` ou reaproveitando um endpoint já existente) e inserir em `campaign_match_log` com `method='manual_assignment'`, `rodizio_outcome='assigned'`.

**4. Realtime do card invalida em qualquer UPDATE de `customers`**
O filtro `consultant_id=eq.${consultantId}` dispara refetch em toda atualização de qualquer cliente do consultor (pode ser dezenas por minuto em produção). Custa Realtime à toa. Ajuste: trocar por `event: '*'` com um debounce leve, ou (melhor) escutar apenas UPDATE e filtrar client-side por `payload.new.needs_manual_review === true || payload.old.needs_manual_review === true` antes de invalidar.

### Fora de escopo (funcionando, não mexer)
- CAS em `casAssignPartner` — OK, `.is("referral_partner_id", null)` no UPDATE é a forma correta.
- `decideRodizioAssignment` puro + testável — OK.
- Notificação `notifyOwnerManualReview` fire-and-forget com `.catch` — OK.
- Unique index parcial `WHERE is_active = true` — OK.
- Coluna `rodizio_outcome` nullable + índice parcial — OK.

### Diagnóstico técnico

Fluxo validado ponta-a-ponta:
```text
msg WhatsApp
  ├─ identifica campanha (AD ID / CTWA CLID / initial_message)
  │    ├─ achou → rodizio_next(campaign_id)
  │    │    ├─ RPC error       → markManualReview("rodizio_rpc_error") + notify owner
  │    │    ├─ pool vazia      → markManualReview("rodizio_pool_empty") + notify owner
  │    │    └─ partner_id ok   → casAssignPartner
  │    │         ├─ applied    → notifyPartnerNewLead (só este ganha)
  │    │         └─ race       → descarta silenciosamente (outro turno já venceu)
  │    └─ frase-âncora sem campanha → markManualReview("no_campaign_ctwa_phrase")
  └─ sem sinal de anúncio → fluxo normal do consultor dono
```

Nenhum caminho leva a "chuta um parceiro qualquer". Com os 4 ajustes acima, sistema fica pronto pra escalar (2, 10, 50 parceiros) sem risco de lead ir pro dono errado.
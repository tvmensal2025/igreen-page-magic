## Diagnóstico atual

Hoje o fluxo de saldo tem 3 furos que podem te deixar no prejuízo:

1. **Sincronização lenta (até 30 min de atraso)** — `facebook-sync-metrics` roda via cron a cada ~30 min. Entre uma rodada e outra a Meta pode gastar muito além do saldo antes do sistema "ver" e pausar. Numa campanha de R$ 50/dia o estrago é pequeno, mas em R$ 500/dia o overrun pode passar de R$ 10.
2. **Sem teto na Meta** — a campanha é criada só com `daily_budget`, sem `lifetime_budget`/`spend_cap` espelhando o saldo do consultor. Ou seja, a Meta não sabe que ele só tem R$ 100 — quem segura é a nossa pausa, que depende do item 1.
3. **Acabou o saldo = pausa silenciosa** — `debit_consultant_wallet` já gera `debt_cents` quando ultrapassa, e o sync pausa a campanha + manda notificação, mas **não existe popup/modal** forçando o consultor a escolher: "recarregar X" ou "subir o orçamento" no momento em que a campanha morre. Ele só descobre quando entra no painel.

E também: campanha pode ser criada **sem nenhum saldo** se o consultor for admin (bypass na linha 229 do create-campaign), e a UI não bloqueia "Criar campanha" mostrando o popup de recarga antes.

## O que vou construir

### 1. Saldo virou orçamento real (lifetime cap na Meta)

Na criação da campanha (`facebook-create-campaign`):

- Calcular `lifetime_cap_cents = floor(saldo_disponivel / (1 + fee%))` (desconta nosso markup, sobra o que a Meta pode gastar).
- Mandar pra Meta `lifetime_budget = lifetime_cap_cents` **junto** com `daily_budget` (Meta aceita os dois: daily limita o ritmo, lifetime trava o total).
- Salvar `lifetime_cap_cents` em `facebook_campaigns` (nova coluna) pra UI mostrar "gastou X de Y reservados".
- Quando o consultor recarregar, um job realinha o `lifetime_budget` de cada campanha ativa pra (gasto_atual + saldo_novo_disponivel).

Assim, mesmo se nosso sync atrasar, a **Meta** segura — você nunca gasta além do que tem em caixa.

### 2. Pausa quase-instantânea (sync sob demanda + cron mais frequente)

- Reduzir o cron de `facebook-sync-metrics` de 30 min → 5 min (a Meta atualiza insights em ~minutos mesmo).
- Em paralelo, criar `facebook-balance-check` (cron de 2 min) que só lê `amount_spent` por campanha ativa (chamada barata, 1 campo) e dispara a pausa se já bateu no `lifetime_cap`. Sem fazer o sync pesado de leads/insights/breakdown.
- Trigger no banco: quando `wallet_transactions.type='spend'` derruba `balance_cents <= 0`, marca a campanha como `pause_pending` e o próximo balance-check garante a pausa.

### 3. Popup obrigatório de recarga quando acabar o saldo

UI (front):

- Novo hook `useWalletGuard()` escutando realtime em `consultant_wallet`. Quando `balance_cents <= auto_pause_at` **ou** alguma campanha do consultor virou `paused` por motivo `saldo_*`, abre um `<RechargeRequiredDialog>` modal.
- O modal tem 3 ações:
  1. **Recarregar R$ X** (sugerido = 7 dias do daily_budget total das campanhas pausadas) → cria Stripe checkout via `wallet-create-topup`.
  2. **Aumentar orçamento** (ajusta `daily_budget` e/ou `lifetime_cap` da campanha) → reativa quando tiver saldo.
  3. **Encerrar campanha** (arquiva).
- Fechar o modal sem ação só é permitido em "Lembrar depois" (cooldown de 24h) — a campanha continua pausada.

### 4. Bloquear criação sem saldo

- Remover o bypass `!isAdmin` na linha 229 do `facebook-create-campaign` (admin também precisa ter saldo na carteira do próprio consultor que ele está criando).
- No front (`CampaignFormDialog` e formulário de criar campanha de anúncio), botão "Criar" abre o `<RechargeRequiredDialog>` antes do submit se `saldo < min_required` em vez de só toast de erro.

### 5. Auditoria a prova de bala

- Toda chamada `debit_consultant_wallet` continua persistindo `gross_spend_cents` (Meta real) + `amount_cents` (cobrado com fee). Hoje já faz, manter.
- Adicionar índice único `(campaign_id, date)` em `facebook_metrics_daily` (já existe via onConflict, vou confirmar) e `synced_to_wallet_cents` pra **nunca** debitar duas vezes o mesmo gasto. Hoje já trata, vou rodar uma migration de validação pra garantir constraint.
- `facebook-balance-reconcile` continua rodando 1x/dia: compara `Meta.amount_spent` vs soma de `wallet_transactions.gross_spend_cents` e ajusta delta — assim qualquer drift é detectado em 24h no máximo.

### Detalhes técnicos

```text
Wallet (R$ 100) ──▶ create_campaign
                    ├─ lifetime_cap_cents = 100/(1+0.20) = 83,33 (líquido Meta)
                    ├─ daily_budget = X
                    └─ Meta recebe daily + lifetime
                          │
                          ▼
                    [Meta gasta]
                          │
                          ├─ cron 5 min: facebook-sync-metrics (insights completos + débito)
                          └─ cron 2 min: facebook-balance-check (só amount_spent, pausa se ≥ cap)
                                              │
                                              ▼
                                        wallet.balance ≤ 0
                                              │
                                              ├─ pausa Meta (status=PAUSED)
                                              ├─ marca rejection_reason
                                              ├─ trigger realtime
                                              └─ front abre <RechargeRequiredDialog>
                                                    ├─ Recarregar (stripe)
                                                    ├─ Aumentar budget (recria lifetime_cap)
                                                    └─ Encerrar
```

Migrations necessárias:

- `ALTER TABLE facebook_campaigns ADD COLUMN lifetime_cap_cents bigint`
- `ALTER TABLE facebook_campaigns ADD COLUMN pause_pending boolean DEFAULT false`
- Confirmar UNIQUE em `facebook_metrics_daily(campaign_id, date)`
- Cron novos via `pg_cron`: `facebook-balance-check` a cada 2 min, ajustar `facebook-sync-metrics` pra 5 min.

Arquivos tocados:

- `supabase/functions/facebook-create-campaign/index.ts` — adicionar lifetime, remover bypass admin
- `supabase/functions/facebook-sync-metrics/index.ts` — cron mais frequente
- `supabase/functions/facebook-balance-check/index.ts` — **novo**
- `supabase/functions/facebook-realign-lifetime/index.ts` — **novo** (chamado após recarga)
- `supabase/functions/wallet-stripe-webhook/index.ts` — invocar realign após topup confirmado
- `src/hooks/useWalletGuard.ts` — **novo**
- `src/components/wallet/RechargeRequiredDialog.tsx` — **novo**
- Integração no shell do `/admin` ou `App.tsx` pra mount global do hook
- Migration SQL (3 alterações + cron)

## Pontos pra você confirmar

1. **Markup atual**: tá em 20% (`platform_fee_percent=20`). O `lifetime_cap` da Meta vai ser **saldo / 1.20** (a parte que sobra pra anúncio real). Ok?
2. **Frequência do sync**: 5 min é ok ou prefere 10? Mais frequente = mais chamadas Graph API (custa rate-limit, não dinheiro).
3. **Comportamento do popup**: "Lembrar depois" libera 24h ou você quer que ele **bloqueie a navegação** até recarregar/encerrar (mais agressivo, garante 0% prejuízo)?bloquei a camapnha o escritorio nao, 0 prejuizo
4. **Valor sugerido de recarga**: 7 dias do orçamento total das pausadas, ou prefere oferecer botões fixos (R$ 50, R$ 100, R$ 200, R$ 500)?e valor livre- 
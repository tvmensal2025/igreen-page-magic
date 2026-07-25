# Cérebro MG + Rodízio (avisos ao parceiro)

Documentação operacional para IAs e humanos. **Não apagar** guards/migrations. **Não mexer em campanhas Meta ativas** só para trocar copy.

**Canônica de produto/Cérebro Ads:** [`docs/CEREBRO-ADS-OFICIAL.md`](./CEREBRO-ADS-OFICIAL.md)

Atualizado: 2026-07-25.

## Visão geral

Três circuitos distintos:

| Circuito | Para quem | O quê |
|----------|-----------|--------|
| **Cérebro MG** | Consultor (dono) | Âncora + exploradoras Minas, slots, escala âncora |
| **Cérebro por campanha** | Consultor | Escala budget **desta** campanha (qualquer cidade; não MG-ROT) |
| **Rodízio avisos** | Parceiro(s) do pool | Campanha aprovada, métricas periódicas, pausa/fim |

Campanha Meta ↔ UUID `facebook_campaigns.id`. Rodízio usa **só** esse UUID (`rodizio_pools.campaign_id`). Texto WA **não** escolhe parceiro.

---

## 1. Cérebro de Campanhas MG

### Arquivos

| Path | Papel |
|------|--------|
| `_shared/brain-config.ts` | Tipo + normalize `brain_config` |
| `_shared/brain-budget-scale.ts` | Decisão scale_up/down/hold + textos WA |
| `_shared/campaign-waste-guard.ts` | Regras waste 48h |
| `_shared/ad-copy-bank.ts` | 100× título/descrição/primary/CTWA |
| `facebook-mg-city-rotator` | Seed fila, slots, escala âncora |
| `facebook-auto-pause` | Waste real + tick autopilot → rotator |
| `campaign-brain-rank` | UI rank/save/apply |
| `CampaignBrainPanel.tsx` | UI + modal controles + modal “i” ajuda |

### Config (`consultant_ad_settings.brain_config`)

Campos típicos: `autopilot`, `anchor_budget_cents`, `max_anchor_budget_cents`, `target_cpl_cents` (ex. 200), `scale_step_pct` (15), `explorer_budget_cents` (~517), `max_explorers` (4), `preferred_slugs`, `age_min`, `last_anchor_scale_at`.

### Modelo no ar

- 1 âncora Uberlândia (ID fixo no rotator/rank deste consultor).
- Até `max_explorers` campanhas `MG-ROT-*`.
- Fila: pausadas com `ROTATION_QUEUE` / seed `queue_only`.

### Escala (regra crítica)

```
CPL medido em janela 48h  →  decide subir/descer
Intervalo entre degraus   →  ~4h (anti-spam do cron 30min)
NÃO existe “sobe só a cada 48h”
```

Aviso de escala → WhatsApp do **consultor**.

### CTWA / criativo

- Frase do Zap **sem cidade**.
- Atribuição: AD ID → `source_campaign_id` (UUID).
- Seed usa banco + foto vencedora; **não** reescreve ativas.

### Waste

- Spend sem conversa/clique na janela → pausa com `AUTO_PERF_PAUSE:`.
- Só Play manual reativa.

### UI

- Engrenagem quase invisível → controles.
- Ícone **i** → explicação objetivo/regras.
- Salvar / Salvar e aplicar na Meta.

---

## 1b. Cérebro por campanha (qualquer cidade)

Serve para **melhorar o orçamento daquela campanha** (parceiro / outra cidade). **Não** é o rotator de Minas.

### Arquivos

| Path | Papel |
|------|--------|
| Colunas `brain_scale_*` em `facebook_campaigns` | enabled, step %, teto, CPL alvo, last_at |
| `facebook-auto-pause` → `campaign_scale_ticks` | Após waste: decide + PATCH budget + WA consultor |
| `CampaignBrainScaleDialog.tsx` | Botão Brain na lista → liga/%/teto/CPL |
| `isBrainScaleEligible` | Exclui `MG-ROT-*` e âncora UDI |

### Regras

- Default **desligado** (não liga sozinho em campanhas antigas).
- Degrau escolhido: **15 / 20 / 25 / 30%**.
- Mesma lógica `decideAnchorBudgetScale`: mede CPL 48h; sobe/desce; gap ~4h.
- Excluído de MG-ROT e da âncora (lá o rotator realinha budget).
- Aviso WA → **consultor**.

### UI

Lista de campanhas → ícone cérebro (só elegíveis) → modal. Badge `Cérebro +15%` quando ligado.

---

## 2. Rodízio — avisos ao parceiro

### Arquivos

| Path | Papel |
|------|--------|
| `rodizio-metrics-format.ts` | Templates WA (aprovada / métricas / pausa / fallback) |
| `rodizio-metrics-broadcast` | Cron ~10min: aprovada 1× + métricas live |
| `rodizio-pause-notify.ts` | Aviso 1× na pausa |
| `facebook-create-campaign/rodizio-pool.ts` | Plano puro da pool (defaults 3h) |
| RPC `configure_rodizio_pool` | Cria/atualiza pool + membros |
| `CampaignRodizioLeadsDialog.tsx` | Modal: intervalo, quiet, leads |
| `RodiziosBroadcastPanel.tsx` | Intervalos na Central |
| `CampaignsList.tsx` | Botão pessoas abre o modal |

### Fluxo

```
Wizard (rodízio ON + ≥1 parceiro)
  → configure_rodizio_pool
  → INSERT pool: interval 180, quiet 21–09
     (UPDATE de pool existente NÃO muda o intervalo)
  → Meta ACTIVE → is_active=true
  → broadcast: msg aprovada 1× (approval_notified_at)
  → métricas a cada N min (slot + dedup + quiet hours)
  → pausa: msg 1× (paused_notified_at); Play reseta paused_notified_at
```

### Intervalos UI

`0, 30, 60, 120, 180, 240, 360, 720, 1440` minutos (check constraint).

### Mensagens enriquecidas (2026-07-23)

- Aprovada: protocolo, budget, cidades, exclusiva vs rodízio, checklist “o que você recebe”, quiet hours.
- Métricas: gasto, alcance, CTR, clique→conversa, conversa→lead, CPL, % orçamento, protocolo, leitura rápida.
- Sem inventar número: Meta falhou → fallback.

### Elegibilidade do parceiro

`notification_phone` + `rodizio_metrics_enabled` + `is_active` + membro do pool.

---

## 3. Deploy / ops

Funções relevantes (JWT):

- `rodizio-metrics-broadcast` — `verify_jwt=false` (cron)
- `facebook-mg-city-rotator` — `verify_jwt=false`
- `facebook-auto-pause` — `verify_jwt=false`
- `facebook-create-campaign` — `verify_jwt=true`

CLI (Context7 / Supabase CLI):

```bash
source .env.mcp.local   # SUPABASE_ACCESS_TOKEN
supabase functions deploy rodizio-metrics-broadcast --project-ref zlzasfhcxcznaprrragl --no-verify-jwt --use-api
supabase functions deploy facebook-mg-city-rotator --project-ref zlzasfhcxcznaprrragl --no-verify-jwt --use-api
```

Migration pools novas 3h: `20260723043000_rodizio_pool_default_metrics_3h.sql`.

---

## 4. Checklist “não quebrar”

- [ ] CTWA sem cidade; atribuição por Meta ID/UUID
- [ ] Não reescrever criativo de ativas sem pedido
- [ ] Escala: 48h = medida; ~4h = degrau
- [ ] Cérebro por campanha ≠ Cérebro MG; não em MG-ROT/âncora
- [ ] Waste `AUTO_PERF_PAUSE` só Play
- [ ] Não inventar métricas no broadcast
- [ ] Não resetar `approval_notified_at` sem motivo
- [ ] Defaults 3h só em **novas** pools; não forçar nas atuais
- [ ] Não misturar aviso de escala (consultor) com métricas (parceiro)
- [ ] WhatsApp deste consultor = **Whapi** (não Evolution reconnect)

---

## 5. Gaps conhecidos

- IDs de âncora/consultor hardcodados no rotator/rank (acoplado a Rafael/UDI).
- `RodiziosBroadcastPanel` não edita quiet hours (só o modal da campanha).
- Waste usa métricas diárias (lag); broadcast usa insights live.
- Quiet hours do bot (outros fluxos) ≠ quiet da pool de métricas.

# Cérebro Ads (Meta) — Documentação oficial

**Versão:** 1.0 · **Data:** 2026-07-25 · **Status:** canônica  
**Escopo:** Cérebro de campanhas Facebook/Meta (MG + escala + waste).  
**Fora de escopo:** Cérebro Sofia / IA WhatsApp (`cerebro_ativo`) — é outro produto.

Este documento é a **fonte oficial de produto + operação** do Cérebro Ads.  
Combina: (A) documentação **oficial Meta** vigente, (B) arquitetura do sistema iGreen, (C) política operacional congelada (sem redesenhar motor a cada conversa).

---

## 0. Uma frase

O Cérebro Ads **protege carteira e gira slots**; a Meta **barateia conversa**.  
O formato oficial Meta para custo baixo é **1 campanha CTWA ampla + orçamento concentrado + Advantage+**.  
O Cérebro **não substitui** esse formato — ele deve **servir** a ele, não fragmentá-lo.

---

## 1. Fontes Meta oficiais (pesquisa 2026-07-25)

| Tema | URL oficial |
|------|-------------|
| Click to WhatsApp (Marketing API v25) | https://developers.facebook.com/docs/marketing-api/ad-creative/messaging-ads/click-to-whatsapp/ |
| Criar CTWA no Ads Manager | https://www.facebook.com/business/help/447934475640650 |
| Best practices click to message | https://www.facebook.com/business/help/269324800441478 |
| Advanced best practices CTM | https://www.facebook.com/business/help/1451473636259991 |
| Reduzir cost per result | https://www.facebook.com/business/help/321695409726523 |
| Advantage+ campaign budget (resultados) | https://www.facebook.com/business/help/220698029821552 |
| Advantage+ campaign budget (visão geral) | https://www.facebook.com/business/help/153514848493595 |
| Best practices Advantage+ campaign budget | https://www.facebook.com/business/help/2177212182495139 |
| Advantage+ placements | https://www.facebook.com/business/help/196554084569964 |
| Advantage+ campaign setup (on/off) | https://www.facebook.com/business/help/906206294602874 |
| About ads that click to message | https://www.facebook.com/business/help/1816962591668838 |
| Learning phase (~50 resultados/semana) | https://www.facebook.com/business/help/112167992830700 |
| Significant edits (reset learning) | https://www.facebook.com/business/help/316478108955072 |
| Best practices delivery | https://www.facebook.com/business/help/950694752295474 |
| Auction overlap | https://www.facebook.com/business/help/537699989762051 |
| Otimizar CTM para purchases | https://www.facebook.com/business/help/1214599109289826 |
| Click to message (produto) | https://www.facebook.com/business/ads/click-to-message-ads |

### 1.1 O que a Meta define como formato CTWA

Da Marketing API (v25):

| Campo | Valor oficial |
|-------|----------------|
| Objetivo da campanha | `OUTCOME_ENGAGEMENT` (também Leads / Sales / Traffic) |
| Destino do conjunto | `destination_type = WHATSAPP` |
| Cobrança | `billing_event = IMPRESSIONS` |
| Otimização (Engagement) | Preferir **`CONVERSATIONS`** (não só cliques) |
| Criativos | Imagem, vídeo, carrossel ou slideshow |

### 1.2 O que a Meta recomenda para **baratear**

1. **Advantage+ placements** — mais eficiente; sistema escolhe onde mostrar.  
2. **Advantage+ campaign budget** — orçamento na campanha; Meta reparte em tempo real para os melhores conjuntos.  
3. **Consolidar conjuntos** — ~**50 eventos de otimização por conjunto por semana** para sair do learning.  
4. **Não fazer edição significativa** à toa (budget grande, bid, pause ≥7d, etc. reiniciam learning).  
5. **Evitar auction overlap** — vários conjuntos no mesmo público competem consigo e encarecem.  
6. Texto **conversacional**; eventos de mensagem / CAPI quando possível; para purchase goal: ≥10 purchases/30d e campanha ≥7 dias.

### 1.3 Formato Meta “ouro” (resumo operacional)

```
1 campanha Click to WhatsApp
  · Advantage+ campaign budget: ON
  · 1 conjunto (no máximo poucos)
      · Destino WhatsApp · Otimizar Conversas
      · Público amplo (geo região/cidade grande + idade)
      · Advantage+ placements ON
      · Budget diário concentrado (suficiente p/ ~50 conversas/semana)
  · 2–4 anúncios no MESMO conjunto (variações de criativo)
```

**Não é** “N campanhas = N cidades = N orçamentos mínimos”.  
Isso fragmenta learning e gera overlap — o oposto do Help Center.

---

## 2. O que é o Cérebro Ads (iGreen)

### 2.1 Três circuitos (não misturar)

| Circuito | Para quem | Função |
|----------|-----------|--------|
| **Cérebro MG** | Consultor | 1 âncora + até N exploradoras `MG-ROT-*`, slots, escala da âncora, waste |
| **Cérebro por campanha** | Consultor | Escala budget de **uma** campanha (não MG-ROT, não âncora) |
| **Rodízio avisos** | Parceiro | Avisos de campanha aprovada / métricas / pausa (UUID) |

Campanha Meta ↔ `facebook_campaigns.id` (UUID). Rodízio **só** por UUID.

### 2.2 O que o Cérebro **é**

- Autopilot de **proteção** (waste, saldo, prazo).  
- Rotação de **slots** exploradores (quando `automation_mode` permite).  
- Escala de budget da **âncora** por CPL vs alvo (degraus ~15%, gap ~4h).  
- Rank de praças → `preferred_slugs` (UI / apply).

### 2.3 O que o Cérebro **não é**

- Não é o criativo “mágico” nem substituto de Advantage+ da Meta.  
- Não é o Cérebro Sofia (resposta IA no Zap).  
- Não autoriza `targeting_patch` / `create_object` genérico automático (human-only).  
- Não deve fragmentar o aprendizado Meta com dezenas de conjuntos ativos fracos.

---

## 3. Arquitetura (código)

| Componente | Responsabilidade | Path |
|------------|------------------|------|
| Config | `brain_config` tipado + normalize | `supabase/functions/_shared/brain-config.ts` |
| Policy | Gate protetiva vs expansiva | `supabase/functions/_shared/ad-automation-policy.ts` |
| Escala | `decideAnchorBudgetScale` | `supabase/functions/_shared/brain-budget-scale.ts` |
| Waste | Pausar queima sem conversa | `supabase/functions/_shared/campaign-waste-guard.ts` |
| Âncora | ID âncora / helpers | `supabase/functions/_shared/ads-anchor.ts` |
| Conversas Meta | 1 action_type canônico | `supabase/functions/_shared/meta-insight-actions.ts` (`pickMetaConversations`) |
| Rotator | Slots MG + seed + escala âncora | `supabase/functions/facebook-mg-city-rotator/` |
| Auto-pause | Waste + tick autopilot | `supabase/functions/facebook-auto-pause/` |
| Rank | Score praças / save / apply | `supabase/functions/campaign-brain-rank/` |
| Create | Publica CTWA (seed/wizard) | `supabase/functions/facebook-create-campaign/` |
| Creative rotator | Pausa ads losers | `supabase/functions/facebook-creative-rotator/` |
| UI | Controles + ajuda | `src/components/admin/ads/CampaignBrainPanel.tsx` |
| UI escala | Brain por campanha | `src/components/admin/ads/CampaignBrainScaleDialog.tsx` |

Persistência: `consultant_ad_settings.brain_config` (JSONB).

### 3.0 Onde editar (sem código)

**Central de Anúncios → Cérebro → engrenagem → Controles do Cérebro.**  
Salva estratégia geográfica (sede × cidades), raio, CPL, budgets, mensagem obrigatória.  
**Salvar config não cria campanha** — criar = Express/wizard → Publicar.

### 3.1 Modos de autonomia (`automation_mode`)

| Modo | Expansivo | Notas |
|------|-----------|--------|
| `disabled` | Não | Default seguro (+ `kill_switch` true no default) |
| `shadow` | Não muta | Observa |
| `limited` | activate, budget_scale | Sem seed/criativo auto |
| `full` | + `creative_rotate`, `seed_explorer` | Piloto explícito |

**Protetivas sempre on:** `pause_waste`, `pause_balance`, `pause_schedule` — independem de kill/modo.

**Human-only (nunca auto):** `targeting_patch`, `create_object`, `audience_sync`.

### 3.2 Waste (constantes atuais)

| Regra | Limiar | Janela |
|-------|--------|--------|
| Zero conversa | R$ 10 (`1000` cents) | 48h |
| Zero clique | R$ 8 | 48h |
| Ad zumbi | R$ 12 | 48h |

Prefixo `AUTO_PERF_PAUSE:` — health/rotator **não** reativam; só Play.

### 3.3 Escala da âncora

- Mede CPL ~48h (métricas diárias).  
- Sobe se CPL ≤ alvo; desce se CPL > 1,35× alvo; hold no meio.  
- Gap anti-spam ~4h (não confundir com janela de medição).  
- Piso Meta de budget: **R$ 5,17** (`517` cents).  
- **Proibido** `brain_scale_*` em `MG-ROT-*` e na âncora (rotator brigaria).

### 3.4 Idempotência Meta (incidente 2026-07-23)

Tick **não pode** POST cego de targeting/idade/criativo em ativa.  
Só PATCH se valor atual ≠ desejado. Senão a Meta **reinicia aprendizado**.

---

## 4. `brain_config` — campos oficiais

| Campo | Default código | Papel |
|-------|----------------|-------|
| `autopilot` | `false` | Flag legada; sozinha **não** autoriza mutação |
| `automation_mode` | `disabled` | Nível real de autonomia |
| `kill_switch` | `true` | Trava expansivas |
| `anchor_campaign_id` | `null` | UUID âncora do consultor |
| `anchor_budget_cents` | `1000` | Alvo diário âncora |
| `max_anchor_budget_cents` | `50000` | Teto escala |
| `target_cpl_cents` | `750` | Alvo CPL (centavos) — **deve ser realista** |
| `scale_step_pct` | `10` | Degrau % |
| `explorer_budget_cents` | `517` | Budget exploradora |
| `max_explorers` | `0` | 0 = só âncora (formato Meta concentrado) |
| `preferred_slugs` | `[]` | Slugs exploradoras; vazio = sem MG-ROT |
| `geo_mode` | `radius_sede` | `radius_sede` \| `cities_mg_rot` (legado) |
| `sede_*` | null / 50 km | Lat/lng/raio/nome da sede operacional |
| `require_initial_message` | `true` | Create bloqueia sem `initial_message` explícita |
| `age_min` / `age_max` | 30 / 65 | Preferência idade |
| `winner_photo_url` | null | Criativo vencedor p/ seed |
| `last_anchor_scale_at` | null | Anti-spam escala |

---

## 5. Política oficial de operação (congelada)

Alinhada à Meta (§1) + evidência de produção 2026-07.

### 5.1 Princípio

```
Formato Meta ouro (1 CTWA amplo + budget concentrado na sede)
  → Cérebro protege (waste/saldo) + escala âncora
  → max_explorers=0 / geo_mode=radius_sede (sem MG-ROT automático)
  → Só reabrir exploração com pedido explícito
```

### 5.2 Valores de config recomendados (piloto)

| Alavanca | Valor oficial iGreen | Motivo |
|----------|----------------------|--------|
| `target_cpl_cents` | **750** (R$ 7,50) | Alvo R$ 2 trava escala no piso |
| `max_explorers` | **0** | Só âncora sede; sem MG-ROT automático |
| `geo_mode` | **`radius_sede`** | 1 raio na sede (não slots cidade) |
| `sede_radius_km` | **50** | Teto do publisher; Meta API até 80 |
| `require_initial_message` | **true** | Toda campanha CTWA exige frase WA |
| `anchor_budget_cents` | **≥ 1500** | Concentrar volume na vencedora |
| `explorer_budget_cents` | 517 | Piso (só se reabrir exploração) |
| `scale_step_pct` | 15 | Estável |
| `automation_mode` | `full` só com piloto explícito | — |
| `mode` | `conservative` | — |

### 5.2.1 Campanha sede (piloto Rafael — 2026-07-25)

| Campo | Valor |
|-------|--------|
| Portal UUID | `944c5bf7-1851-4961-97ad-f8c4c46c5a28` |
| Nome | `SEDE-UDI-50km` |
| Geo | Jaraguá/UDI `-18.92417, -48.30179` · **50 km** |
| Budget | R$ 15/dia |
| `initial_message` | `Oi! Quero saber como economizar na conta de luz.` |

MG-ROT extras + remarketing antiga: **pausadas**. Próximas criações humanas: Express/wizard default **raio sede** + mensagem inicial obrigatória.

### 5.3 Checklist humano (Ads Manager / portal)

1. Pausar exploradoras com CPL alto ou 0 conversa.  
2. Manter **uma** campanha principal CTWA com budget suficiente.  
3. Não editar targeting/idade “por garantia” em ativas.  
4. Revisar `preferred_slugs` no máximo **1×/semana**.  
5. Medir CPL com **1** action Meta (`pickMetaConversations`) — nunca somar started+reply+connection.  
6. Funil: acompanhar Ads → portal (Meta barato + portal 5% = lead “caro” no negócio).

### 5.4 KPIs — só reabrir debate se quebrar 3 dias

| KPI | Alerta | Crítico |
|-----|--------|---------|
| CPL âncora 48h | > R$ 8 | > R$ 12 |
| Exploradoras ativas com âncora ruim | > 1 | > 2 |
| Taxa Ads → portal 14d | < 10% | < 5% |

### 5.5 Proibido (motor / produto)

- Novo motor / `targeting_patch` automático / `create_object` genérico no cron.  
- `brain_scale` em MG-ROT ou âncora.  
- Voltar `target_cpl` para R$ 2 com mercado em R$ 7–12.  
- Patch semanal de código “para ver se melhora”.  
- POST Meta sem diff (reset learning).

### 5.6 Única constante de código candidata (se pedido explícito)

`WASTE_ZERO_CONV_SPEND_CENTS`: 1000 → 600. Nada mais sem pedido.

---

## 6. Relação Cérebro × formato Meta

### 6.1 O que o `facebook-create-campaign` já faz certo (alinhado à Meta)

Na publicação (wizard/seed), o código já aplica o formato oficial:

- `objective = OUTCOME_ENGAGEMENT`
- `optimization_goal = CONVERSATIONS`
- `destination_type = WHATSAPP`
- `billing_event = IMPRESSIONS` (via fluxo CTWA)
- `targeting_automation.advantage_audience = 1`
- Placements Advantage+ (omitir positions fixas / auto)
- CTA `WHATSAPP_MESSAGE`
- Sem interests finos (deixa o algoritmo achar)

**Ou seja: cada campanha criada já nasce no formato Meta.**  
O problema de custo não é “publicar errado” — é **quantas** campanhas ficam ativas ao mesmo tempo com budget miúdo.

### 6.2 Lacuna estrutural (Cérebro MG vs Help Center)

| Meta oficial | Cérebro MG hoje | Diretriz oficial |
|--------------|-----------------|------------------|
| 1 campanha ampla + Advantage+ **campaign** budget | N campanhas cidade (cada uma com budget próprio) | Preferir **concentrar** na âncora; exploradora ≤1 se CPL ruim |
| ~50 conversas/semana/conjunto | R$ 5/dia × N cidades → learning limited / overlap | Subir budget da âncora; não abrir N caixas |
| Não editar significantemente | Guardas de noop já existem | Manter; nunca afrouxar |
| Otimizar CONVERSATIONS | Já na criação + `pickMetaConversations` | Manter 1 action_type |
| Advantage+ placements/audience | Já na criação | Manter |

**Conclusão de produto:** o Cérebro é o **guardião e o rotador auxiliar**. O **formato de mídia** vencedor é o da Meta (§1.3). A alavanca certa é **quantas campanhas ativas + budget**, não reescrever o publisher.

### 6.3 Default código × piloto × política

| Campo | Default código | Piloto observado | Política oficial (§5) |
|-------|----------------|------------------|------------------------|
| `automation_mode` | disabled | full | full (só com pedido) |
| `target_cpl_cents` | **750** | **750** | **750** |
| `max_explorers` | **0** | **0** | **0** (só âncora) |
| `geo_mode` | `radius_sede` | `radius_sede` | `radius_sede` |
| `require_initial_message` | true | true | true |
| `anchor_budget_cents` | 1000 | **1500** | **≥ 1500** |

UI do painel pode mostrar defaults “otimistas”; o backend é fail-closed (`disabled` + `kill_switch`). Save de autonomia pela UI não deve burlar SQL/piloto explícito.

---

## 7. Runbook rápido

### Ligar piloto

1. `anchor_campaign_id` preenchido.  
2. `kill_switch=false`, `autopilot=true`, `automation_mode=full` (pedido explícito).  
3. `target_cpl_cents` realista (§5.2).  
4. `max_explorers=1` até CPL âncora estável 3 dias.  
5. Waste/saldo já protegem mesmo se desligar expansivas.

### Emergência (gasto)

1. Pausar exploradoras no Ads Manager / portal.  
2. `kill_switch=true` ou `automation_mode=disabled` (para expansivas).  
3. Protetivas continuam (waste/saldo).  
4. Se necessário: pausar âncora manualmente.

### Diagnóstico “lead caro”

1. CPL âncora 48h vs alvo.  
2. Quantas campanhas ativas e budget cada.  
3. Gasto em `AUTO_PERF_PAUSE` (queima).  
4. Taxa portal.  
5. Se muitas cidades ativas com budget baixo → **consolidar** (Meta), não “melhorar o robô”.

---

## 8. Artefatos relacionados

| Artefato | Uso |
|----------|-----|
| Este arquivo | **Canônico** Cérebro Ads |
| `docs/cerebro-e-rodizio-avisos.md` | Detalhe operacional + rodízio parceiro |
| `docs/CEREBRO-ADS-POLITICA-CONGELADA-2026.md` | Resumo curto da política (§5) |
| `.kiro/steering/cerebro-mg-e-rodizio.md` | Steering agentes (`#cerebro-mg-e-rodizio`) |
| `.cursor/rules/cerebro-campanhas-mg.mdc` | Rule Cursor |
| `scripts/analysis/cerebro_ads_2026_analysis.py` | Análise reproduzível (números) |

---

## 9. Histórico

| Data | Mudança |
|------|---------|
| 2026-07-25 | v1.2 — UI Controles: sede/raio/`geo_mode`/`require_initial_message` editáveis por consultor |
| 2026-07-25 | v1.1 — sede 50 km + `geo_mode=radius_sede` + `max_explorers=0` + `require_initial_message` |
| 2026-07-25 | v1.0 — documentação oficial: Meta Help/API + arquitetura + política congelada |
| 2026-07-25 | v1.1 — pesquisa com agentes: Help Center CTWA + inventário código (create já CONVERSATIONS/Advantage+; lacuna = N campanhas ativas) |

---

## Apêndice A — Checklist operacional Meta (Help Center)

1. Objetivo: Engagement / Leads / Sales alinhado ao outcome.  
2. Performance goal: **Maximize number of conversations** (default em Leads CTWA).  
3. Destino: WhatsApp.  
4. Advantage+ audience + Advantage+ placements: ON.  
5. Se 2+ conjuntos na mesma campanha: Advantage+ **campaign** budget ON.  
6. Criativo deixa claro que abre chat; template Start conversation / icebreakers.  
7. Rodar ≥ 7 dias antes de julgar; evitar edição significativa.  
8. Consolidar conjuntos para atingir ~50 resultados/semana e sair do learning.  
9. Evitar overlap de leilão (mesma Page, públicos sobrepostos).  
10. Para purchase goal: elegibilidade (≥10 purchases/30d) + medir purchases Meta, não só conversas.

---

## Apêndice B — Tick autopilot (o que FAZ / NÃO FAZ)

**FAZ:** waste (sempre) · rank/slugs · ensure slots com diff · escala âncora · seed 1/tick (full) · creative_rotate losers · brain_scale elegível · WA só se mudou.  
**NÃO FAZ:** targeting_patch · create_object genérico · reativar AUTO_PERF · brain_scale em MG-ROT/âncora · POST cego · spam noop.

---

## 10. Como agentes devem usar este doc

1. Antes de qualquer patch Ads/Cérebro: ler **este arquivo** + `#cerebro-mg-e-rodizio`.  
2. Não inventar métricas; não somar action_types Meta.  
3. Não ligar expansão multi-cidade sem âncora saudável + pedido explícito.  
4. Preferir mudança de **config/operação** a mudança de **motor**.  
5. Qualquer mudança de motor: pedido explícito do usuário + KPI quebrado 3 dias.  
6. Não confundir: publisher CTWA já está certo; o erro operacional é **fragmentar** campanhas ativas.

## Análise honesta do plano anterior

O plano de "rodízio simples entre campanhas" funciona mas é **cego** — chuta com fairness, sem usar evidência que já temos no banco. Dá pra fazer melhor: usar sinais reais antes de cair no rodízio.

## Escada de decisão (do mais forte pro mais fraco — tudo automático, nada manual)

Cada degrau é uma tentativa deterministica. Só desce se o degrau acima não conclui. Todos gravam em `campaign_match_log` com `method` distinto — dá pra auditar cada lead depois.


| #   | Regra                                            | Sinal usado                                               | Método logado            | Já existe? |
| --- | ------------------------------------------------ | --------------------------------------------------------- | ------------------------ | ---------- |
| 1   | AD ID exato                                      | `customers.source_ad_id` ↔ `facebook_campaigns.fb_ad_ids` | `ad_id`                  | ✅          |
| 2   | ctwa_clid                                        | `ctwa_clid_mapping`                                       | `ctwa_clid`              | ✅          |
| 3   | Protocolo FB-xxxxx no texto                      | regex + `tracking_protocol`                               | `tracking_protocol`      | ✅          |
| 4   | Pool única ativa                                 | 1 campanha com pool = sem ambiguidade                     | `sole_active_pool`       | ✅          |
| 5   | Similaridade Jaccard ≥ 0.4 com `initial_message` | texto de abertura do anúncio                              | `jaccard`                | ✅          |
| 6   | **NOVO** Match de DDD/cidade                     | DDD do telefone → estado → só 1 campanha ativa mira lá    | `ddd_city_match`         | ❌          |
| 7   | **NOVO** Campanha "quente"                       | única com lead atribuído por sinal forte nas últimas 24h  | `recent_strong_activity` | ❌          |
| 8   | **NOVO** Rodízio justo entre ativas              | campanha com último lead mais antigo                      | `fallback_rotation`      | ❌          |


Só depois de **todos** os 8 degraus falharem (ex: consultor sem nenhuma pool ativa) o lead vira manual. Na prática, com 2+ campanhas ativas isso nunca acontece.

## Como cada degrau novo é rastreado

**Degrau 6 — DDD/cidade**

- Extrai DDD do `phone_whatsapp` → mapa DDD→UF (BR, 67 DDDs, tabela fixa no código).
- Compara com `facebook_campaigns.cities` (JSON já tem nomes tipo "Belo Horizonte", "Uberlândia") — checa se alguma cidade da campanha pertence à UF do lead.
- Grava `campaign_match_log.message_sample = "DDD 34 → MG · match apenas em [Jaraguá]"`.

**Degrau 7 — atividade recente**

- Query: campanhas ativas do consultor + `MAX(customers.created_at)` onde `source_ad_id IS NOT NULL OR source_ctwa_clid IS NOT NULL` nas últimas 24h.
- Se só uma teve sinal forte recente → é ela. Se duas → passa pro degrau 8.
- Grava `message_sample = "última entrada forte: 12min atrás"`.

**Degrau 8 — rodízio justo**

- `MIN(customers.created_at) OVER (source_campaign_id)` — pega a campanha com último lead mais antigo. Nunca recebeu → entra primeiro.
- Empate → ordena por `campaign_id` (estável entre webhooks concorrentes).
- Grava `message_sample = "rot: camp A(último=2h) vs camp B(último=8h) → B"`.

## Painel de auditoria (opcional, mas recomendo)

Adiciono uma seção em `/admin/protocolos` (já existe) mostrando os leads dos degraus 6–8 dos últimos 7 dias com:

- Regra que decidiu
- Evidência (`message_sample`)
- Parceiro que ganhou
- Botão "reatribuir" caso você discorde

Zero mudança de schema — `campaign_match_log` já tem tudo.

## Blindagens (o que **não** vai quebrar)

- **Nenhum degrau novo é chamado se AD ID/ctwa_clid/protocolo já resolveu** — degraus fortes têm prioridade absoluta.
- **CAS continua** — dois webhooks concorrentes não geram lead duplicado.
- `**markManualReview` continua** como último recurso (só se consultor não tem pool ativa nenhuma).
- **Notificação ao super-admin** (`notifySuperAdminUnmatchedLead`) dispara nos degraus 5–8, marcando qual regra decidiu. Você fica sabendo em tempo real.
- `**rodizio_next` + CAS + protocolo `PPP-YYMMDD-####**` intocados — a única mudança é qual `source_campaign_id` grava antes de chamar.

## Arquivos tocados

- `supabase/functions/_shared/single-pool-campaign-resolver.ts` — adiciona `resolveByDddCity`, `resolveByRecentActivity`, `resolveByFallbackRotation`. Exporta um `resolveCampaignAutoLadder(supabase, consultantId, {phone, messageText})` que roda os degraus 6→8 e devolve `{campaignId, method, sample}`.
- `supabase/functions/_shared/ddd-uf-map.ts` — tabela DDD→UF (arquivo novo, ~30 linhas).
- `supabase/functions/evolution-webhook/index.ts` (L1082–1109) — depois do Jaccard, chama a escada nova; passa o resultado pro `logRodizioOutcome` com o `method` certo.
- `supabase/functions/whapi-webhook/index.ts` (~L880–905) — mesmo patch.
- `supabase/functions/_shared/meta-ctwa-fallback.ts` — atualiza o comentário do topo explicando a nova escada.
- (opcional) `src/pages/AdminProtocolos.tsx` ou similar — aba "Atribuições fracas (auditoria)".

Sem migração de banco. Nenhuma tabela nova. Zero risco no fluxo de rodízio principal — só amplia o gate de qual campanha entra.

## Sobre o lead (21) 97448-4291

DDD 21 = RJ. Nenhuma das 2 campanhas ativas mira RJ → nos degraus novos ele cairia no **degrau 8 (rodízio justo)**. Se quiser, resolvo ele agora manualmente escolhendo pelo mesmo critério e disparando a notificação pro parceiro — me fala., seja justo 
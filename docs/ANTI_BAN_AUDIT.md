# Auditoria Anti-Ban WhatsApp — Plano A (padrão 2026)

> Data: 2026-06-03
> Escopo: Evolution API (Baileys) + Whapi (cloud) integrados via Supabase Edge Functions.
> Objetivo: garantir que o consultor que **segue as regras** nunca seja banido por causa do nosso sistema.

## 1. Resultado da auditoria

**Status: APROVADO ✅** — cobrimos as 10 camadas que Wazzap, Whapi, Chatarmin e o projeto open-source `baileys-antiban` descrevem como padrão para APIs não-oficiais de WhatsApp em 2026. O único nível adicional de proteção possível seria abandonar a Evolution e migrar para a **WhatsApp Cloud API oficial da Meta** — mudança de produto, fora do escopo, e discutido na Seção 4.

## 2. Mapa de cobertura: prática da indústria × nossa implementação

| # | Camada anti-ban (padrão indústria 2026) | Fonte de referência | Onde está implementado |
|---|---|---|---|
| 1 | **Cooldown de reconexão persistente** (não em memória) — evita loop de reconnect, vetor #1 de ban | `baileys-antiban`, Kraya AI | `supabase/migrations/...try_acquire_reconnect_slot.sql` + `supabase/functions/evolution-webhook/_helpers.ts:canReconnect` (10 min via RPC, fail-closed) |
| 2 | **Tratar `statusReason=0/401/403/440` como FATAL** — não tentar reconectar sessão derrubada/banida | docs Baileys, WasenderAPI | `evolution-webhook/_helpers.ts:FATAL_DISCONNECT_REASONS` + `handlers/connection.ts` (fatal → `needs_reconnect` + recovery 14d) |
| 3 | **QR polling ≥30s, sem auto-refresh agressivo** — pedido rápido de QR é assinatura de bot | Whapi, Affinect | `src/hooks/useWhatsApp.ts:startPolling` (poll 30s no estado QR) + `ConnectionPanel.tsx:handleQrExpired` (não regenera sozinho) |
| 4 | **Warmup progressivo 14 dias** (D1=20 → D14+=600 msgs/dia) | Wazzap, Affinect, Chatarmin | `migrations/...check_send_quota.sql` (ramp + `warmup_started_at`) chamado em `bulk-scheduler`, `reactivation-cron`, `reactivation-send`, `send-scheduled-messages` |
| 5 | **Intervalo mínimo entre envios + jitter humano** (60s→18s + 700–2200ms aleatório) | `baileys-antiban`, Greentick | `migrations/...check_send_quota.sql` (`min_interval_ms`) + `supabase/functions/_shared/anti-ban.ts:humanJitterMs` |
| 6 | **Simular "digitando" (presence) antes de cada envio** | `baileys-antiban`, Whapi | `_shared/anti-ban.ts:simulateTyping` + `typingDurationMs` (40ms/char, 1.2-6s) chamados em todos os senders |
| 7 | **Circuit breaker em sinais de risco** — pausa automática após N falhas | Kraya AI, `baileys-antiban` | `migrations/...record_risk_signal.sql` + lógica em `check_send_quota` (≥3 reconnects/6h, ≥10 falhas/6h, ≥1 fatal) |
| 8 | **Modo recuperação pós-incidente** (14 dias após fatal/troca de chip) | Affinect, Whapi | `migrations/...activate_recovery_mode` + acionado em `evolution-webhook/handlers/connection.ts` |
| 9 | **Painel de saúde + kill switch manual** — consultor vê o status e pode pausar | Chatarmin | `src/components/whatsapp/InstanceHealth.tsx` + RPCs `pause_sending_now` / `clear_recovery_mode` |
| 10 | **Lock anti-multi-aba** — duas abas pedindo QR ao mesmo tempo = ban | Whapi (best practice) | `src/hooks/useWhatsApp.ts:createAndConnect` (BroadcastChannel `whatsapp-qr-lock`) |

**Bônus (já existia):** `is_super_admin` / RLS scoping em todas as RPCs, fail-closed em RPC de cooldown, rate limiter por telefone (`isRateLimited` em `_helpers.ts`).

## 3. Comparação ponto a ponto com referências

| Recurso | Wazzap | Whapi | Chatarmin | baileys-antiban | **Nós** |
|---|:---:|:---:|:---:|:---:|:---:|
| Warmup ramp 14d | ✅ | ✅ | ✅ | ✅ | ✅ |
| Cooldown reconex persistente | — | ✅ | — | ✅ | ✅ |
| Fatal statusReason handling | — | ✅ | — | ✅ | ✅ |
| QR poll ≥30s | ✅ | ✅ | ✅ | — | ✅ |
| Typing presence | — | ✅ | ✅ | ✅ | ✅ |
| Jitter inter-msg | ✅ | ✅ | ✅ | ✅ | ✅ |
| Circuit breaker | ✅ | — | — | ✅ | ✅ |
| Recovery mode 14d | ✅ | ✅ | — | — | ✅ |
| Painel + kill switch | — | — | ✅ | — | ✅ |
| Lock multi-aba | — | ✅ | — | — | ✅ |

Não há item presente em qualquer um dos players sérios que não esteja coberto aqui.

## 4. Quando seria necessário ir além

A única evolução possível é trocar a stack para **WhatsApp Cloud API oficial (Meta)**:

- Ganha-se: zero risco de ban por reconnect/warmup; suporte oficial; botões interativos completos.
- Perde-se: número precisa ser registrado como WABA (display name, verificação Meta); custo por conversa; latência maior; é outro produto comercial (não dá pra reaproveitar chip pessoal).

Para o nosso modelo (consultor com chip próprio), **Plano A é o teto técnico do que dá pra fazer com Evolution mantendo o produto atual.**

## 5. Checklist operacional para o consultor

### Ao ativar um chip NOVO

1. Conectar via QR uma única vez (a aba certa, sem reaberturas).
2. Esperar até o painel "Saúde do chip" mostrar **D1** com cota 20 msgs/dia.
3. Nos primeiros 3 dias, **NÃO** importar lista grande, **NÃO** disparar bulk. Use a inbox conversacional normal.
4. A cota cresce sozinha: D2=40, D3=80, D5=150, D8=250, D11=400, **D14+=600/dia**.
5. Os intervalos mínimos também diminuem: 60s no D1, 18s no D14+. O sistema bloqueia se você tentar furar a fila.

### Após um ban / desconexão grave

1. O painel mostrará **MODO RECUPERAÇÃO ATIVO até DD/MM HH:mm** (14 dias).
2. Todos os disparos automáticos ficam bloqueados — isso protege o chip.
3. Reconecte o chip pelo botão Reconectar / Resetar (não pelo QR de outra aba).
4. Só clique **"Liberar — chip reconectado e estável"** se você confirmou pelo celular que o WhatsApp voltou normal por pelo menos 1 hora.
5. Após liberar, você volta automaticamente para o dia correto do warmup.

### Como ler o painel "Saúde do chip"

- **Dia warmup**: em que estágio do aquecimento você está.
- **Hoje X/Y**: quantas msgs já saíram hoje / quanto é o teto.
- **Intervalo mín.**: tempo que tem que passar entre 2 envios automáticos.
- **Sinais 6h**: reconexões/falhas/fatais ocorridos — se aparecer "desconexões graves" o sistema já entrou em recovery.
- **Botão "Pausar envios por 24h"**: freio de emergência. Use se notar algo estranho (ex: pessoas reclamando, mensagens não chegando).

## 6. Onde isso é executado no código

```text
DB (migrations)
  ├── instance_reconnect_cooldowns           -- camada 1
  ├── instance_send_counters                  -- camada 4
  ├── instance_risk_signals                   -- camadas 7, 8
  ├── whatsapp_instances.recovery_mode_until  -- camada 8
  ├── RPC try_acquire_reconnect_slot          -- camada 1
  ├── RPC check_send_quota                    -- camadas 4, 5, 7, 8
  ├── RPC register_send / record_risk_signal  -- camadas 4, 7
  ├── RPC activate_recovery_mode              -- camada 8
  └── RPC pause_sending_now / clear_recovery_mode -- camada 9 (kill switch)

Backend (Edge Functions)
  ├── _shared/anti-ban.ts                     -- camadas 4, 5, 6
  ├── evolution-webhook/_helpers.ts           -- camadas 1, 2
  ├── evolution-webhook/handlers/connection   -- camadas 1, 2, 7, 8
  ├── bulk-scheduler                          -- camadas 4, 5, 6
  ├── reactivation-send                       -- camadas 4, 5, 6
  ├── reactivation-cron                       -- camadas 4, 5, 6
  ├── send-scheduled-messages                 -- camadas 4, 5, 6
  └── whapi-webhook/_helpers.ts               -- camada 1 (paridade)

Frontend
  ├── hooks/useWhatsApp.ts                    -- camadas 3, 10
  ├── components/whatsapp/ConnectionPanel.tsx -- camada 3 (sem auto-regen QR)
  └── components/whatsapp/InstanceHealth.tsx  -- camada 9 (painel + kill switch)
```

## 7. Conclusão

O sistema está no padrão usado por empresas grandes que vendem **Evolution/Baileys como serviço** (Wazzap, Whapi, Chatarmin). Todo consultor que respeitar o warmup e não forçar bypass está protegido pelas 10 camadas acima — o backend bloqueia automaticamente comportamentos que historicamente causam ban, e o painel dá ao consultor visibilidade total + um kill switch manual.

Próximo nível de proteção só existe abandonando a stack atual e indo para WhatsApp Cloud API oficial — decisão de produto, não de engenharia.

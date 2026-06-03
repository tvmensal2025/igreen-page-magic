
## Verificação: Plano A é o padrão usado por profissionais?

Validei contra fontes 2025/2026 (Whapi, Chatarmin, Affinect, Wazzap, WasenderAPI, baileys-antiban, Kraya AI, docs Meta). Conclusão: **sim, Plano A é o estado-da-arte para APIs não-oficiais (Evolution/Baileys)**. Toda fonte séria recomenda exatamente as 7 camadas que propusemos. Nada melhor existe hoje sem migrar para WhatsApp Cloud API oficial (o que muda preço e UX).

### Comparação Plano A × consenso da indústria

| Prática recomendada pela indústria | Onde aparece | Plano A cobre? |
|---|---|---|
| Cooldown de reconexão persistente (não em memória) | baileys-antiban, Kraya | ✅ Camada 1 (DB + RPC, 10min) |
| Tratar `statusReason=401/403/440` como FATAL | docs Baileys, WasenderAPI | ✅ Camada 1 (já parcial, ampliando p/ `0`) |
| QR polling ≥30s, sem auto-refresh agressivo | Whapi, Affinect | ✅ Camada 2 |
| Warmup progressivo 14 dias (20→500+/dia) | Wazzap, Affinect, Chatarmin | ✅ Camada B (idêntico ao Wazzap) |
| Intervalo mínimo entre mensagens com jitter | baileys-antiban, Greentick | ✅ Camada 4 + B |
| Simular "digitando" (presence) antes de enviar | baileys-antiban, Whapi | ✅ Camada 4 |
| Circuit breaker em sinais de risco | Kraya, baileys-antiban | ✅ Camada C |
| Modo de recuperação pós-incidente | Affinect, Whapi | ✅ Camada D |
| Painel de saúde + kill switch manual | Chatarmin | ✅ Camada E |
| Excluir respostas inbound do cap diário | Wazzap | ✅ Camada B |

**Nada faltando.** A única alternativa "mais segura" seria abandonar Evolution e usar WhatsApp Cloud API oficial — fora do escopo (mudaria todo o produto).

### Plano A — execução em 4 PRs

**PR1 — Conexão à prova de ban (crítico, libera tudo)**
- Migration: tabela `instance_reconnect_cooldowns` + RPC `try_acquire_reconnect_slot(instance, ttl_ms)`.
- `evolution-webhook/_helpers.ts`: `canReconnect` agora consulta RPC (10 min, persistente). Adicionar `0` em `FATAL_DISCONNECT_REASONS`.
- `handlers/connection.ts`: delay 5s→30s antes de reconectar transiente; logar classificação.
- Mesmo tratamento em `whapi-webhook/_helpers.ts`.

**PR2 — Frontend não dispara reconexão (crítico)**
- `useWhatsApp.ts`: polling QR mínimo 30s (era 8s). Remover `connectInstance` de `multiSignalCheck`.
- `ConnectionPanel.tsx`: remover auto-regenerate QR de 45s; só botão manual.
- `BroadcastChannel` para impedir duas abas pedindo QR simultâneo.

**PR3 — Warmup + caps + circuit breaker (alto impacto)**
- Migration: `instance_send_counters` (instance, date, sent_count, first_send_at), `instance_risk_signals` (signal_type, severity, expires_at), coluna `recovery_mode_until` em `whatsapp_instances`, RPC `check_send_quota(instance)` que retorna `{allowed, reason, remaining, min_interval_ms}`.
- Ramp: D1=20, D2=40, D3=80, D5=150, D8=250, D11=400, D14+=600. Intervalo mín: D1=60s → D14=18s. Inbound bot replies não contam.
- Aplicar `check_send_quota` em: `bulk-scheduler`, `reactivation-cron`, `reactivation-send`, `send-scheduled-messages`, `ai-followup-cron`.
- Circuit breaker em `evolution-webhook` connection handler: registra signals (reconexões, falhas, fatais) → ≥3 reconex/6h pausa bulk 2h, ≥1 fatal exige confirmação manual + ativa `recovery_mode_until = now()+14d`.

**PR4 — Humanização do envio + painel (alto)**
- `evolution-api.ts`: helper `sendPresence(instance, jid, "composing", ms)` antes de cada `sendText`. Duração ∝ tamanho do texto (40ms/char, min 1.2s, max 6s).
- Jitter entre mensagens sequenciais do bot (700–2200ms aleatório).
- `InstanceHealth.tsx`: mostrar dia do warmup, cota usada/restante, sinais de risco ativos, recovery mode, botão "Pausar envios agora" (kill switch grava `recovery_mode_until = now()+24h`).

### Arquivos afetados

DB migrations (2): tabelas + RPCs.
Backend: `evolution-webhook/_helpers.ts`, `evolution-webhook/handlers/connection.ts`, `whapi-webhook/_helpers.ts`, `bulk-scheduler/index.ts`, `reactivation-cron/index.ts`, `reactivation-send/index.ts`, `send-scheduled-messages/index.ts`, `ai-followup-cron/index.ts`, `_shared/evolution-api.ts`.
Frontend: `useWhatsApp.ts`, `whatsappStateChecks.ts`, `ConnectionPanel.tsx`, `InstanceHealth.tsx`.

### Garantias para o usuário que segue as regras

- Nunca mais ban por loop de reconexão (cooldown agora real, persistente).
- Nunca mais ban por disparo no Dia 1 (warmup força ramp).
- Nunca mais ban silencioso após chip novo (recovery mode automático).
- Consultor vê painel claro do que pode/não pode enviar hoje.
- Kill switch manual sempre disponível.

### Ordem de execução proposta

PR1 e PR2 primeiro (resolvem causa direta dos 2 bans já sofridos), depois PR3 e PR4 em sequência. Cada PR é independente e seguro de reverter.

Aprovando este plano, aplico os 4 PRs em sequência.

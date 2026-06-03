# Finalizar Plano A + Auditoria Enterprise

Já está aplicado: migration completa (cooldown, warmup, risk signals, recovery mode, RPCs), shared `anti-ban.ts`, integração em `bulk-scheduler`, `reactivation-send`, `send-scheduled-messages`, `evolution-webhook` (fatal/transient + recovery 14d), QR polling 30s no frontend e remoção do auto-reconnect.

Faltam 4 peças para fechar o padrão usado por Wazzap/Whapi/Chatarmin + uma auditoria documentada.

## 1. reactivation-cron (gap crítico)

`supabase/functions/reactivation-cron/index.ts` envia via `sender.sendText` sem passar por `checkSendQuota`. É a única porta de envio massivo ainda sem proteção. Vou:
- Importar `checkSendQuota`, `registerSend`, `simulateTyping`, `typingDurationMs`, `humanJitterMs`.
- Antes do `sendText`: chamar `checkSendQuota(supabase, instanceName)`; se `allowed=false`, pular o lead, logar `reason` e seguir (sem queimar fila).
- Antes do envio: `simulateTyping(...)` proporcional ao texto.
- Depois do envio OK: `registerSend(...)`.
- Entre leads: aplicar `humanJitterMs() * N` (700–2200ms × multiplicador) no lugar de delays fixos.

## 2. ai-followup-cron (verificação)

Confirmar que não dispara mensagens diretas (parece apenas enfileirar/agendar). Se enviar, aplicar mesma proteção; se só agenda, ok — `send-scheduled-messages` já protege.

## 3. Kill switch + RPC de saída de recovery

Migration nova (mínima):
- RPC `clear_recovery_mode(p_instance TEXT)` — `SECURITY DEFINER`, exposta a `authenticated`, valida que `auth.uid()` é o `consultant_id` da instância antes de zerar `recovery_mode_until` (sai do bloqueio manualmente após confirmar que o chip foi reconectado).
- RPC `pause_sending_now(p_instance TEXT, p_hours INT DEFAULT 24)` — mesma validação de dono; chama lógica equivalente ao `activate_recovery_mode` mas com default 24h (kill switch suave).

## 4. Painel `InstanceHealth.tsx` (novo)

Componente em `src/components/whatsapp/InstanceHealth.tsx`, embutido no `ConnectionPanel.tsx` (abaixo do bloco de QR/status). Lê em tempo real:
- `whatsapp_instances.recovery_mode_until` → badge "MODO RECUPERAÇÃO até DD/MM HH:mm" se ativo.
- `check_send_quota(instance)` chamado client-side (RPC já liberada para `authenticated`) → mostra: dia do warmup, cota usada / total, próximo horário liberado, motivo do bloqueio.
- `instance_risk_signals` últimos 6h agregados por `signal_type` → ícones coloridos (reconnects, falhas, fatais).
- Botões: **"Pausar envios por 24h"** (`pause_sending_now`) e **"Liberar após reconectar chip"** (`clear_recovery_mode`, só visível em recovery mode, exige `confirm()`).
- Atualização a cada 60s.

Mantém estilo do design system (`bg-card`, `text-muted-foreground`, `Badge` variants), sem cores hard-coded.

## 5. BroadcastChannel anti-multi-aba (PR2 leftover)

Em `useWhatsApp.ts`: criar `BroadcastChannel('whatsapp-qr')`. Antes de chamar `connectInstance` (QR), enviar `{type:'qr-lock', instance, ts}`. Se outra aba responder/recebeu lock recente (<30s) na mesma instância, abortar com toast "Outra aba já está gerando QR para esta instância". Evita pedido duplo de QR (vetor real de ban).

## 6. Whapi parity

Verificar `whapi-webhook/_helpers.ts` — já tem `canReconnect` via RPC. Garantir que o handler de close trata fatais → `recordRiskSignal` + `activateRecoveryMode` igual ao Evolution. Se faltar, alinhar.

## 7. Auditoria enterprise (entregável)

Criar `docs/ANTI_BAN_AUDIT.md` com:
- Tabela "Prática indústria 2026 × Onde implementamos × Arquivo:linha" cobrindo as 10 camadas (cooldown persistente, fatal `reason=0`, QR poll ≥30s, warmup 14d, intervalo+jitter, typing presence, circuit breaker, recovery mode, painel+kill switch, multi-aba).
- Comparação ponto-a-ponto com Wazzap, Whapi, Chatarmin, baileys-antiban (fontes citadas).
- Checklist operacional para o consultor: o que fazer em chip novo, o que fazer pós-ban, como ler o painel.
- Limites conhecidos e quando seria necessário migrar para WhatsApp Cloud API oficial.

## Arquivos afetados

```text
Migration nova:
  supabase/migrations/<timestamp>_kill_switch_rpcs.sql

Backend:
  supabase/functions/reactivation-cron/index.ts        (anti-ban)
  supabase/functions/whapi-webhook/_helpers.ts         (paridade fatal)
  supabase/functions/whapi-webhook/handlers/*          (se aplicável)

Frontend:
  src/components/whatsapp/InstanceHealth.tsx           (novo)
  src/components/whatsapp/ConnectionPanel.tsx          (embutir painel)
  src/hooks/useWhatsApp.ts                             (BroadcastChannel)

Doc:
  docs/ANTI_BAN_AUDIT.md                               (auditoria)
```

## Ordem de execução

1. Migration kill switch (precisa aprovação) → aguarda regen de `types.ts`.
2. reactivation-cron + whapi parity (paraleliza).
3. `InstanceHealth.tsx` + integração no `ConnectionPanel`.
4. BroadcastChannel no `useWhatsApp`.
5. `ANTI_BAN_AUDIT.md` consolidando tudo + verificação final lendo cada arquivo citado.

## Garantia pós-execução

Após este PR o sistema cobre 100% das camadas que Wazzap/Whapi/Chatarmin descrevem publicamente como padrão 2026 para APIs não-oficiais. O único nível adicional possível seria abandonar Evolution e ir para WhatsApp Cloud API oficial (Meta) — mudança de produto, fora do escopo, e o doc de auditoria deixa isso explícito.

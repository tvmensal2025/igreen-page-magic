---
name: Evolution Whapi Parity
description: evolution-webhook tem paridade total com whapi-webhook (custom flow engine, conversational, FAQ, handoff, reentry notify); whapi continua apenas para super admin
type: feature
---

# Paridade Evolution ↔ Whapi (qualquer consultor)

> **Unificação parcial (jun/2026):** `state-machine`, `step-namespace`, `types`, `intent-classifier` e `templates` foram consolidados em `_shared/bot/` com shims nos webhooks. Iniciativa **encerrada na Etapa 3a** — detalhes antes/depois em [`docs/auditoria/17-unificacao-webhooks-whapi-evolution.md`](../../docs/auditoria/17-unificacao-webhooks-whapi-evolution.md). *Não confundir com Fase 1 Segurança, Fase 3 Portal 2 ou auditoria geral 01–16.*

## Arquitetura final

- **whapi-webhook**: SOMENTE super-admin (`settings.superadmin_consultant_id`). Endpoint único, token único.
- **evolution-webhook**: TODOS os outros consultores. Identifica instância por `body.instance` em `whatsapp_instances`.
- Frontend (`useWhatsApp`/`useChats`/`useMessages`) já roteia: `isWhapi=true` só quando `consultantId === settings.superadmin_consultant_id`.

## Módulos compartilhados

**Unificados em `_shared/bot/` (fonte única + shim):** `conversational-state-machine`, `step-namespace`, `handler-types`, `intent-classifier`, `conversational-templates`.

**Ainda espelhados (dois arquivos físicos):**

- `handlers/bot-flow.ts` — motor `sys`, OCR, portal, steps UUID custom.
- `handlers/conversational/index.ts` — `runConversationalFlow`, FAQ, handoff, envio em cascata.
- `index.ts` — orquestrador do webhook (parse, dedupe, Cérebro, engine v3).

Trocar apenas a camada de envio: `ctx.sender` = `createEvolutionSender` para Evolution; Whapi sender para super-admin. Lógica de negócio deve manter paridade manual nos arquivos ainda duplicados.

## index.ts (evolution-webhook) — features obrigatórias

1. Select consultant com `conversational_flow_enabled`.
2. `notifyNewLead` em criação E em reentrada (sem inbound nas últimas 24h).
3. Routing engine `sys` vs `flow` (igual whapi linhas 609-693): se há `bot_flows` ativo com steps e step não é cadastro, força `engine="flow"` e zera `conversation_step` para o motor restartar no firstActive.
4. `runBotFlow` (sys, pipeline OCR/cadastro) ou `runConversationalFlow` (flow, DB-driven).
5. Strip `__*` keys antes do `customers.update`.
6. `normalizeOutgoing(updates.conversation_step, engineUsed)` antes de persistir.
7. `logStepTransition` com `stripPrefix(updates.conversation_step)`.

## Sem mudança de schema

Todas as colunas necessárias já existem: `last_custom_prompt_at`, `bot_paused`, `pending_inbound_message_id`, `notification_phone`, `conversational_flow_enabled`.

## Como validar um consultor novo

1. Cria consultor → trigger `seed_camila_flow_on_consultant_insert` semeia o FluxoCamila.
2. `/admin/whatsapp` → cria instância (`igreen-{slug}`) → webhook auto-configurado para `/functions/v1/evolution-webhook`.
3. Conecta QR → `CONNECTION_UPDATE.open` grava `connected_phone`.
4. Lead manda mensagem → router pega `bot_flows` ativo → `runConversationalFlow` → fluxo customizado roda.
5. `notifyNewLead` chega no `notification_phone` do consultor.
6. Pergunta fora do FAQ → `notifyHandoff` + `bot_paused`.
7. Painel `/admin/whatsapp` lista o chat via `findChats(instanceName)` (Evolution), não Whapi.

## Secrets obrigatórios na edge function

- `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`
- `GEMINI_API_KEY` (OCR)
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (auto-injetados)
- `WHAPI_TOKEN` (só para whapi-webhook)

---
inclusion: fileMatch
name: igreen-sync-oficial
description: Sync carteira iGreen (Playwright).
fileMatchPattern:
  - "worker-igreen-sync/**"
  - "supabase/functions/sync-igreen-customers/**"
  - "supabase/functions/_shared/igreen-sync-worker.ts"
  - "src/lib/igreenSync.ts"
---

# iGreen sync worker — leitura de carteira

Helper: #[[file:supabase/functions/_shared/igreen-sync-worker.ts]]  
Setting: `settings.igreen_sync_worker_url` · secret opcional `IGREEN_SYNC_WORKER_URL`

**URL oficial EasyPanel:** `https://igreen-worker-igreen.d9v63q.easypanel.host`  
Health: `GET /health` → `mode` começa com `tor+playwright+api-vo-`

| Worker | Setting | Uso |
|---|---|---|
| igreen-sync | `igreen_sync_worker_url` | Leitura carteira |
| portal-2 | `portal2_worker_url` | Cadastro leads |
| club | `club_worker_url` | Club |

## Auditoria IA (Gemini 2.5 Flash)

Shadow review dos syncs (não muda o sync):
- Edge: `sync-ai-audit` · tabela `sync_audit_traces`
- Worker: `worker-igreen-sync/ai-audit.mjs` (chama no `/sync-all` e em falhas)
- Modelo: **gemini-2.5-flash** (~US$ 0,0002/run)
- Limite de sucessos: `SYNC_AI_AUDIT_LIMIT` (default **20** na edge). **Falhas sempre auditam.**
- Falha com finding `error` → alerta WA (`sync_fail:*`) via `notifySuperAdminOpsAlert`

Env no Easy Panel do Sync:
- `SUPABASE_URL` = URL do projeto
- `WORKER_TOKEN` (ou `SYNC_AI_AUDIT_SECRET`) = mesmo secret da edge (`IGREEN_SYNC_WORKER_SECRET` / `WORKER_SECRET` / `PORTAL2_WORKER_SECRET`)
- Opcional: `SYNC_AI_AUDIT_DISABLED=true` · `SYNC_AI_AUDIT_LIMIT=0`

## Multi-conta / telefone

Subcontas em `igreen_portal_accounts`. A API da Conta principal mascara `celular` da rede; a subconta dona devolve o número. Unique `(consultant_id, igreen_code)` = 1 linha. Sync **sempre promove** `sem_celular_*` → telefone real via UPDATE por código (não só upsert por phone). Enrich da subconta atualiza a linha mesmo se ela nasceu na Conta principal. Novas subcontas: cadastrar login + sync_all — telefones têm que colar sozinhos.

## Proibido
localhost:3102 · docker interno · typo `d9v83a` · usar `portal2_worker_url` para sync · re-mapear sem helper+/health · filtrar enrich por `igreen_account_id` de forma que bloqueie upgrade de placeholder na principal.

## Aviso “boleto chegou” (WhatsApp)

- Cron horário `igreen-boleto-notify-hourly` → edge `igreen-boleto-notify` (hora BRT editável em `boleto_notify_config`).
- Sync **só boletos** (`mode=sync_boletos`) pode furar `igreen_sync_manual_only`; `sync_all` continua manual (Evomi).
- Toggle por consultor: `igreen_automation_settings.auto_wa_boleto_chegou` (default OFF).
- Fila: `customer_auto_message_log` stage `boleto_chegou:{mes}`.
- Pacote = **3 mensagens**, nesta ordem: áudio Sofia → texto Club-first (Play Store + App Store + link Club) → convite curto com botão “Receber boleto”. **Não usar a palavra PDF** nos textos ao cliente.
- O botão vai **sempre em mensagem própria** (`buildBoletoButtonPrompt`). Junto do corpo o WhatsApp achata a formatação e o Evolution cola a lista numerada no fim do texto longo. `stripBoletoButtonCta` limpa a CTA de `wa_text` legado/editado para não duplicar o convite.
- Whapi manda quick_reply real; Evolution faz downgrade para `*1.* Receber boleto` — o convite curto mantém o downgrade legível. Os dois reconhecem clique **e** `1` via `isBoletoReceberDocIntent`.
- Clique/1 → `sendMedia` document com `url_boleto`. Helper: `_shared/boleto-notify.ts`.
- Paridade Whapi/Evolution: os dois webhooks passam `buttonId` + `sendDocument` para `tryReplyClienteCanalNovidades` **no caminho normal e no `pending-drain`**. Sem isso o clique que chega em rajada não entrega o arquivo.
- `customer_auto_message_log` precisa de policy de **UPDATE** própria: o upsert do reteste no mesmo mês passa por UPDATE e sem a policy o clique não é rearmado.
- Textos/hora editáveis na UI Automações iGreen (`boleto_notify_config`).

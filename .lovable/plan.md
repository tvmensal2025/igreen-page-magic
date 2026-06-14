## Objetivo

Limpar 100% dos dados de teste e cravar como regra estrutural (no banco, não só no código) a separação:

- **Lead** = vem do WhatsApp → entra no Kanban CRM, passa pelo bot.
- **Cliente** = vem da extensão Chrome ou worker do portal iGreen → entra no Kanban **Pós-Venda**, e agora precisa ser **autorizado** pelo consultor antes de avançar.

Manter apenas o super admin `rafael.ids@icloud.com`.

---

## 1. Wipe da base (migration única, transação)

Apaga em ordem de dependências:

```text
proposal_events → proposals → sales → sale_status_history
crm_auto_message_log → customer_auto_message_log → outbound_message_log
scheduled_messages → pending_outbound_media → inbound_media_retry → inbound_media_failures
bot_messages → bot_flow_audit_log → engine_logs
ai_decisions → ai_costs → ai_usage_log → ai_agent_logs → ai_slot_dispatch_log
lead_insights → customer_memory → customer_tags → customer_processing_lock
conversations → customer_flow_state → crm_deals → crm_page_events
portal2_audit_traces → worker_phase_logs
webhook_message_dedup → webhook_rate_limit → ctwa_clid_mapping
capture_* (diagnostics, field_events, field_suggestions, scoreboard, achievements)
campaign_match_log → bulk_campaign_targets → bulk_campaigns
customers   ← por último
_deleted_customers_backup
```

Depois: apagar todos os `consultants` exceto `rafael.ids@icloud.com` e suas dependências (`consultant_*`, `network_members` cuja `referrer_consultant_id` deixou de existir, `whatsapp_instances`, `facebook_connections`, `igreen_extension_tokens`, `user_roles` órfãos).

Não toco em: `app_settings`, `rollout_config`, `kanban_stages`, `products`, `holidays`, `ai_knowledge_sections`, `message_templates`, `flow_router_rules`, `bot_flows`, `bot_flow_steps`, `flow_variants`, `voice_*`, `audio_library`, `ai_media_library`, `pos_venda_default_media`, `ad_*`, `platform_*`.

---

## 2. Regra eterna no banco (migration 2)

Hoje a função `igreen-ingest-customers` grava `customer_origin = 'igreen_extension'`, mas TODOS os filtros do app esperam `'igreen_sync'` → bug que faz cliente da extensão virar lead.

Correções estruturais:

- **CHECK constraint** em `customers.customer_origin` permitindo só: `whatsapp_lead`, `manual`, `igreen_sync`. Default `whatsapp_lead`, NOT NULL.
- **Trigger imutável** `enforce_customer_origin_lock`: bloqueia `UPDATE` que mude `customer_origin` de `igreen_sync` ↔ qualquer lead. Origem é definida na criação e nunca muda.
- **Trigger já existente** `prevent_non_lead_deals` em `crm_deals` (bloqueia card de igreen_sync no Kanban CRM) — mantido e validado.
- **Novo trigger** `enforce_lead_phone_source`: ao inserir customer com `customer_origin in (whatsapp_lead, manual)`, recusa se já existe registro com mesmo `phone_whatsapp` e `customer_origin = igreen_sync` (evita duplicar como lead alguém que já é cliente).
- **Comment SQL** nas colunas + arquivo `mem/features/customer-origin-separation.md` atualizado com a regra "NUNCA REMOVER".

---

## 3. Corrigir ingestão da extensão

Em `supabase/functions/igreen-ingest-customers/index.ts`:

- trocar `customer_origin: "igreen_extension"` → `"igreen_sync"`
- adicionar campo `pos_venda_stage: 'pending_authorization'` no insert/upsert.

Mesma coisa em `igreen-ingest-xlsx` (já está correto) e `sync-igreen-customers` (já está correto) — só normalizar para garantir.

---

## 4. Kanban Pós-Venda: nova coluna "Aguardando autorização"

- Migration: estender enum/CHECK de `customers.pos_venda_stage` para incluir `pending_authorization`. Atualizar função `compute_pos_venda_stage` para devolver `pending_authorization` quando `pos_venda_authorized_at IS NULL` (nova coluna timestamp).
- Adicionar coluna `customers.pos_venda_authorized_at TIMESTAMPTZ NULL` e `pos_venda_authorized_by UUID NULL`.
- Cliente novo da extensão entra em `pending_authorization` automaticamente (default + função recalc respeita autorização).
- `src/components/whatsapp/PosVendaKanban.tsx`: adicionar coluna como primeira; menu de contexto "Autorizar cliente" preenche `pos_venda_authorized_at = now()`, marca `pos_venda_manual = false`, e dispara `recompute_pos_venda_stages` para aquele cliente cair na coluna real (Aprovado/Reprovado/D30…).
- Após autorizar, fluxos de pós-venda (cron `pos-venda-bucket-cron`, mensagens automáticas, etc.) começam a agir. Antes disso ficam silenciosos.

---

## 5. Guard no whapi-webhook

Antes de criar lead ao receber WhatsApp, verificar se já existe customer com mesmo `phone_whatsapp` e `customer_origin = igreen_sync` → se sim, NÃO cria lead nem `crm_deal`; só registra `conversation`/log marcando "mensagem de cliente da carteira" (visível para o consultor responder, mas fora do funil de captação). Já está parcialmente no código — vou validar e fechar o gate.

---

## 6. Memória e documentação

- Criar `mem://index.md` com regra Core: "Extensão Chrome/portal iGreen = `igreen_sync` (cliente, Kanban Pós-Venda). WhatsApp = `whatsapp_lead` (CRM). NUNCA misturar. NUNCA remover triggers de origem."
- Atualizar `mem/features/customer-origin-separation.md` e `mem/crm/pos-venda-kanban.md` com a etapa de autorização.
- Não criar arquivo TODO/reminder (regra do usuário).

---

## Ordem de execução

1. Migration #1: wipe (transação).
2. Migration #2: CHECK + triggers de origem + nova coluna `pending_authorization` + colunas `pos_venda_authorized_*` + atualização de `compute_pos_venda_stage`.
3. Editar `igreen-ingest-customers/index.ts` (auto-deploy).
4. Editar `PosVendaKanban.tsx` (nova coluna + ação Autorizar).
5. Atualizar guard em `whapi-webhook` (verificação rápida).
6. Atualizar memórias.
7. Smoke-test: `psql` para confirmar counts zerados; simular insert lead com phone já igreen_sync (deve falhar); simular insert extensão (deve cair em `pending_authorization`).

---

## Riscos

- Operação destrutiva e irreversível. Confirmação no botão "Implementar plano" é o ponto de não retorno. Vou rodar o wipe em uma única transação para garantir atomicidade.
- Pode existir consultor de teste com dados que o `rafael.ids` queira manter — confirmar que **só** ele permanece.  
  
EXCLUIR APENAS DADOS NADA DE REGRAS OU CODIGO, SAO APENAS CLIENTES DE TESTE
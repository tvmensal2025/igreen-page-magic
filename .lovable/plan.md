
## Resumo

1 unico Kanban Pos-Venda. Adicionamos **1 nova coluna "Em Espera"** entre `Finalizando Cadastro` e `Aprovado`. Antigos param la ate o consultor classificar manualmente. Novos cadastros pos-cutoff caem em `Em Espera` tambem, mas geram **popup de aviso** ("X novos clientes Aprovados / Y Reprovados aguardando confirmacao") — o consultor clica e confirma, dai entra na autoprogressao (30/60/90/120) ou no fluxo de reprovado/devolutiva. Nada de mensagem disparada sem o consultor ver.

## O que sao os 29 erros do ultimo sync

`igreen-ingest-xlsx` faz upsert linha a linha. Quando o banco rejeita, conta como erro. Causas provaveis:
1. Colisao com indice unico parcial `customers(phone_whatsapp, consultant_id) WHERE is_test_lead=false AND is_sandbox=false` contra registros antigos com `customer_origin` diferente.
2. Telefones que normalizam pro mesmo numero entre 2 codigos iGreen do mesmo consultor.
3. Linhas sem celular caindo no fallback `sem_celular_<id>` duplicando.
4. Triggers de validacao (CPF/status fora do enum).

Hoje so guardamos `last_error` agregado. Item 6 abaixo lista os 29 com motivo.

## Regras de negocio (confirmadas)

- **LEAD** (`whatsapp_lead`|`manual`): Kanban CRM de leads. Bot conversa.
- **CLIENTE** (`igreen_sync`): comprou produto iGreen. So no Kanban Pos-Venda. Nunca vira card de lead.
- **REDE** (`network_members`): licenciado. Tabela separada.
- Cada lead/cliente classificado **so pelo dono**, exceto se ele compartilhar com outro consultor.

## Plano

### 1. Nova coluna "Em Espera" no Kanban Pos-Venda (mesmo CRM, 1 coluna nova)

Posicao 6: depois de `Finalizando Cadastro`, antes de `Aprovado`. Base ja existe em `.tmp/add-espera-stage.sql` — promover pra migracao oficial com cutoff.

Regras:
- `auto_message_enabled=false` na coluna.
- Fora de `ACTIVE_FUNNEL_STAGES` (bot nunca move pra/de la).
- Fora do cron `crm-auto-progress` e `pos-venda-bucket-cron-daily`.
- Cliente em `espera` **nao** dispara mensagem automatica de jeito nenhum.

Fluxo por idade do cliente:
- **Antigos** (importados antes do cutoff): caem em `espera`. Consultor arrasta manualmente pra Aprovado/Reprovado/Devolutiva. Sem popup, sem msg automatica.
- **Novos** (sync depois do cutoff): tambem caem em `espera`, mas o sistema ja calcula o bucket "destino" (`aprovado` | `reprovado` | `devolutiva`) e salva em `customers.pos_venda_pending_stage`. Esses geram **popup** (item 2).

### 2. Popup "Novos clientes aguardando confirmacao"

Componente novo: `src/components/whatsapp/PendingApprovalDialog.tsx`.

- Hook `usePendingApprovals(consultantId)` consulta `customers` com `pos_venda_stage='espera' AND pos_venda_pending_stage IS NOT NULL` (so novos pos-cutoff).
- Dispara **ao abrir** a aba "Clientes iGreen" e via realtime quando chega cliente novo.
- Layout: lista agrupada por destino — "X Aprovados" (verde), "Y Reprovados" (vermelho), "Z Devolutiva" (amarelo). Cada linha: nome, codigo iGreen, kW, motivo (se reprovado), botoes individuais "Confirmar" / "Rever".
- Botoes em massa: "Confirmar todos os Aprovados", "Confirmar todos os Reprovados", "Adiar (24h)".
- Ao confirmar: move card pra coluna destino, marca `pos_venda_manual=true`, dispara msg de boas-vindas (aprovado) ou devolutiva (reprovado) e entra na progressao 30/60/90/120. **So aqui a mensagem sai.**
- Adiar: seta `pending_snoozed_until = now() + 24h`. Popup nao aparece de novo ate la.

Salvaguarda: enquanto estivermos testando, popup tem flag `settings.key='pending_popup_enabled'` (default true) — desligavel pelo admin se quiser pausar tudo.

### 3. Padronizar `customer_origin` e hard lock

- Trocar constante em `igreen-ingest-xlsx` de `igreen_extension` → `igreen_sync`. Migracao de dados: `UPDATE customers SET customer_origin='igreen_sync' WHERE customer_origin='igreen_extension'`.
- Trigger `enforce_origin_immutability`: cliente criado como `igreen_sync` nao pode virar `whatsapp_lead`.
- Confirmar filtro `customer_origin in ('whatsapp_lead','manual', null)` em `useKanbanDeals`, `useSalesFunnel`, `useAnalytics` (ja parcialmente feito em `useCustomerDeals`).

### 4. Compartilhamento de classificacao entre consultores

- Tabela nova `customer_classifier_grants` (owner_consultant_id, grantee_consultant_id, scope `'leads'|'clientes'|'both'`, revoked_at).
- Funcao security definer `can_classify(customer_id, user_id)`.
- RLS UPDATE em `customers` (campos: `sales_phase`, `pos_venda_stage`, `pos_venda_manual`, `pos_venda_reason`, `status`, `qualification_score`) libera pra owner OU grantee ativo.
- UI no perfil do consultor pra adicionar/remover grants.
- Popup do item 2 tambem aparece pra grantee dos clientes compartilhados.

### 5. Diagnostico dos 29 erros

- Em `igreen-ingest-xlsx`: substituir `last_error` por `errors_detail: [{phone, codigo, motivo}]` (limite 50).
- `popup.js` da extensao: botao "Ver detalhes" abre modal com a lista.
- `IGreenExtensionCard.tsx`: mostra os ultimos erros tambem.
- Versao extensao → `1.3.0`, regerar `public/igreen-sync-extension.zip`.

### 6. Salvaguardas pra nao disparar msg agora

Antes da migracao:
1. Desabilitar temporariamente os crons `pos-venda-bucket-cron-daily` e `crm-auto-progress` (UPDATE em `cron.job active=false`).
2. Rodar migracao + backfill em `espera`.
3. Reativar crons.

A partir dai: clientes antigos ficam parados ate consultor mover. Novos entram em `espera` com `pending_stage` calculado e geram popup — **nenhuma msg sai sem clique humano**.

## Detalhes tecnicos

Migracao (resumo, baseado em `.tmp/add-espera-stage.sql`):

```sql
-- 1. Empurra positions
UPDATE kanban_stages SET position = position + 1
WHERE stage_key IN ('aprovado','reprovado','30_dias','60_dias','90_dias','120_dias') AND position >= 6;

-- 2. Insere "Em Espera" pra cada consultor
INSERT INTO kanban_stages (consultant_id, stage_key, label, color, position, auto_message_enabled)
SELECT consultant_id, 'espera', 'Em Espera', 'bg-slate-500/20 text-slate-400', 6, false
FROM kanban_stages WHERE stage_key='finalizando'
ON CONFLICT DO NOTHING;

-- 3. Novas colunas em customers
ALTER TABLE customers
  ADD COLUMN pos_venda_pending_stage text,        -- 'aprovado'|'reprovado'|'devolutiva' calculado, aguarda confirmacao
  ADD COLUMN pending_snoozed_until timestamptz,   -- popup adiado
  ADD COLUMN pos_venda_cutoff_at timestamptz;     -- marca o momento da migracao

-- 4. Cutoff global em settings
INSERT INTO settings (key, value) VALUES ('pos_venda_cutoff_at', now()::text)
ON CONFLICT (key) DO NOTHING;

-- 5. Backfill antigos em espera SEM pending (nao geram popup)
INSERT INTO crm_deals (consultant_id, customer_id, remote_jid, stage, deal_origin, notes)
SELECT c.consultant_id, c.id, c.phone_whatsapp, 'espera', 'igreen_sync', 'Importado iGreen - aguardando classificacao manual'
FROM customers c
WHERE c.customer_origin='igreen_sync' AND c.consultant_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM crm_deals d WHERE d.customer_id=c.id AND d.consultant_id=c.consultant_id);
```

`igreen-ingest-xlsx` (ajuste por cliente novo):
```ts
const cutoff = await getSetting('pos_venda_cutoff_at');
if (isNewCustomer && createdAt > cutoff) {
  customer.pos_venda_stage = 'espera';
  customer.pos_venda_pending_stage = compute_pos_venda_stage(...); // aprovado|reprovado|devolutiva
  await createDeal({ stage: 'espera', ... });
} // antigos ficam em 'espera' sem pending_stage
```

Confirmacao do popup (RPC nova `confirm_pending_classification(customer_id, action)`):
- `action='approve'` → move pra `pending_stage`, seta `pos_venda_manual=true`, limpa `pending_stage`, dispara msg, entra progressao.
- `action='review'` → mantem em `espera`, limpa `pending_stage` (consultor vai classificar manual).
- `action='snooze'` → seta `pending_snoozed_until=now()+24h`.

## Validacao

- `SELECT stage, count(*) FROM crm_deals WHERE deal_origin='igreen_sync' GROUP BY 1` → 800+ em `espera`.
- Forcar 1 cliente novo (timestamp > cutoff): cai em `espera` com `pending_stage='aprovado'`. Popup aparece. Confirmar → vai pra `aprovado`, recebe msg, agendamento 30/60/90/120 criado.
- Mover antigo manualmente espera → aprovado: entra na progressao normal (mesmo comportamento).
- Cliente `igreen_sync` nao aparece em `useKanbanDeals` (leads).
- Grant: consultor B sem permissao tenta UPDATE em cliente de A → erro RLS.

## Notas

- `.lovable/` esta no `.gitignore` — o plano nao persiste em commit. Avise se quiser remover.
- A migracao e idempotente; nenhum dado e apagado.
- Apenas **1 nova coluna** no Kanban existente; nao criamos CRM novo.

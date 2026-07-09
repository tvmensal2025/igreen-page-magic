# Unificar recuperação de leads no Cockpit de Conversão

Você não vai usar uma tela separada. Vamos jogar TODOS os leads parados dos últimos 120 dias direto no **Conversão**, para você trabalhar de lá mesmo.

## O que muda

1. **Remover** a página `/admin/recuperacao-leads` e o item da sidebar "Recuperar leads".
2. **Remover** a Edge Function `admin-recover-parked-leads`.
3. **Criar uma nova Edge Function `admin-promote-parked-leads`** que roda uma varredura única (pode ser chamada por um botão no topo da aba Conversão):
   - Busca `captured_leads` dos últimos 120 dias sem `customer_id` (excluindo `igreen_sync`).
   - Busca `customers` com `customer_origin='whatsapp_lead'` dos últimos 120 dias sem consultor.
   - Para cada lead sem `customer_id`: cria em `customers` com `customer_origin='whatsapp_lead'`, `lead_source` herdado, `pos_venda_stage=NULL`, herdando nome/telefone/UF/cidade.
   - Distribui via rodízio respeitando `consultant_entrada_rules` por DDD; se não achar consultor elegível, atribui manualmente numa fila "sem dono" visível no cockpit.
   - Dedup por telefone normalizado (E.164 sem +55) via upsert.
   - Grava tudo em `admin_audit_log`.
4. **No Cockpit de Conversão** (`ConversaoCockpit.tsx`), adicionar:
   - Botão **"Puxar leads parados (120d)"** no topo — chama a edge function e mostra toast com quantos foram promovidos e distribuídos.
   - Filtro rápido por **DDD** (com atalhos 11, 19, 34, "Minas", "SP capital", "Interior SP").
   - Chip **"Parado há X dias"** em cada card, calculado da `last_message_at` ou `created_at`.
   - Ordenação por "mais parados primeiro" como opção.

## Resultado

Um lugar só (Conversão) com todos os 1.775 leads parados já organizados no funil de cada consultor, prontos pra você trabalhar sem sair da aba.

## Detalhes técnicos

- Arquivos a remover: `src/pages/AdminRecoverLeadsPage.tsx`, rota em `src/App.tsx`, item `recuperacao-leads` em `src/components/layout/AppSidebar.tsx` e entrada em `TAB_META` em `src/pages/Admin.tsx`, pasta `supabase/functions/admin-recover-parked-leads/`.
- Índices já criados na migração anterior (`customers_phone_norm_idx`, `captured_leads_phone_norm_idx`, orfandade) permanecem — servem à nova função.
- Nenhuma alteração em webhooks, bot, protocolo ou lógica de `igreen_sync`.

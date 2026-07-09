## Diagnóstico (últimos 120 dias, só leads — sem clientes de sync/Excel)

Filtrei fora todo mundo que veio do sync do iGreen (`customer_origin='igreen_sync'`, 845 registros nos últimos 120 dias — esses **não são leads**, são a base sincronizada e ficam de fora).

Universo real de **leads parados**:

| Fonte | Total 120d | Sem consultor | Minas/SP |
|---|---|---|---|
| `customers` com `customer_origin='whatsapp_lead'` | **83** | 83 (100%) | 68 |
| `captured_leads` (formulário Facebook) sem `customer_id` | **1.692** | 1.692 | 311 |
| **Total** | **1.775** | **1.775** | **379** |

Alguns têm só telefone (WhatsApp Lead), outros têm nome + email + cidade (Facebook Form) mas nunca foram promovidos a `customers`. **Ninguém tem consultor atribuído.** Todos vão para a esteira de conversão.

## O que vou construir

### 1. Nova página `/admin/recuperacao-leads`

Tabela unificada mostrando **todos os 1.775 leads** de uma vez:
- **Nome** (ou "sem nome" quando só temos o telefone)
- **Telefone** normalizado (E.164)
- **DDD** e **UF/cidade** (quando existir)
- **Fonte** (WhatsApp Lead / Formulário FB)
- **Campanha** (se `source_campaign_id` existir)
- **Dias parado** (dias desde `created_at`/`updated_at`)
- **Status atual** (sem consultor / sem estágio / sem match de campanha)

### 2. Filtros e agrupamento

- **DDD** — múltipla seleção com atalhos "Minas (31-38)", "SP capital (11)", "SP interior (12-19)", "Todos"
- **Período** — 30d / 60d / 90d / 120d (padrão 120d)
- **Fonte** — WhatsApp Lead / Formulário FB / Ambos
- **Ordenação** — Mais recente / Mais antigo / DDD / Fonte
- **Busca livre** — por nome parcial ou telefone parcial

Contador no topo por DDD e por dia para o admin ver rapidamente onde estão os buracos.

### 3. Ação "Colocar em conversão" (bulk)

O botão principal executa em uma passada:

1. Para cada `captured_leads` sem `customer_id`:
   - Cria/upsert em `customers` (dedup por telefone normalizado), com `customer_origin='whatsapp_lead'`, `lead_source='meta_ads'` ou `'formulario_fb'`, herdando nome/email/UF/cidade.
   - Grava `customer_id` de volta no `captured_leads` (link).
2. Para cada `customers` recém-criado ou existente sem estágio: define `pos_venda_stage=NULL` (não é pós-venda) e coloca no **kanban de leads** em `stage_key='novo_lead'` — o funil de conversão que já existe.
3. Distribui via rodízio existente respeitando as regras de DDD por consultor (`consultant_entrada_rules`). Se nenhum consultor aceitar aquele DDD, cai numa fila **"Sem consultor elegível"** visível na mesma tela para atribuição manual.
4. Registra tudo em `admin_audit_log` (quem executou, quantos leads, filtros aplicados).

### 4. Organização automática no funil

- Todos entram em **"Novo Lead"** (posição 0 do kanban `stage_scope='lead'`).
- Se o lead já teve conversa registrada em `conversations`, marca `last_inbound_at` e joga em **"Em qualificação"** (posição 1).
- Se já tinha valor da conta capturado, vai para **"Valor da conta"** (posição 2).
- Assim o consultor não recebe todo mundo na mesma coluna — o sistema respeita o estado real do lead.

### 5. Edge Function `admin-recover-parked-leads`

- `GET /list` — devolve lista paginada (100/página) já unificada; filtros por querystring.
- `POST /promote` — recebe `{ lead_ids: string[], assign_mode: 'rodizio'|'manual', consultant_id?: string }` e executa a promoção + atribuição.
- `POST /mark-lost` — para descartar leads obviamente inválidos (números com <10 dígitos, testes, etc.).
- Usa `service_role` (bypass RLS) e dedup por telefone (`regexp_replace(phone,'\D','','g')`).

### 6. Migração mínima

- Índice funcional para acelerar dedup e busca:
  ```sql
  CREATE INDEX IF NOT EXISTS customers_phone_norm_idx
    ON public.customers ((regexp_replace(coalesce(phone_whatsapp,''),'\D','','g')));
  CREATE INDEX IF NOT EXISTS captured_leads_phone_norm_idx
    ON public.captured_leads ((regexp_replace(coalesce(phone,''),'\D','','g')));
  ```
- Índice `captured_leads(customer_id) WHERE customer_id IS NULL` para acelerar o filtro dos órfãos.

## Segurança e não-interferência

- **Nenhuma alteração** em `evolution-webhook`, `whapi-webhook`, `facebook-create-campaign`, protocolo de campanhas, ou fluxo do bot.
- **Não mistura com clientes reais**: `customer_origin='igreen_sync'` fica **explicitamente excluído** de todas as queries e ações.
- Idempotente: rodar o botão 2× não duplica leads (upsert por telefone normalizado).

## Resultado

- Uma única tela mostra os **1.775 leads parados** dos últimos 120 dias.
- Um clique promove todos a `customers`, coloca no funil de conversão e distribui pelo rodízio.
- Consultores dos DDDs 11/19/34 e Minas passam a ver os leads no kanban imediatamente.
- Nada de novo se perde: da próxima vez que um lead entrar sem match, ele aparece automaticamente aqui.

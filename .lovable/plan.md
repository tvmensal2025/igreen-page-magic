## Objetivo

Trazer o CRM Clientes (Pós-Venda iGreen) para o mesmo nível do CRM Leads:
1. Unificar as duas colunas iniciais ("Em análise" + "Em Espera") numa única coluna profissional.
2. Adicionar **autoprogressão** com mensagens automáticas (texto, áudio, imagem, vídeo) em cada estágio.
3. Garantir que todo envio passe pelo mesmo resolver de canal: **Evolution (instância do consultor) → fallback Whapi**, já usado em `crm-auto-progress`.

---

## 1. Unificar "Em análise" + "Em Espera"

Hoje `PosVendaKanban.tsx` mostra duas colunas iniciais que confundem o consultor. Vamos fundi-las em **uma única coluna chamada "Aguardando Classificação"** (cor âmbar, mais clara que "Em Espera"):

- Stage interno: manter `espera` (já é a coluna onde os clientes ficam parados aguardando ação manual).
- Remover `em_analise` do array `STAGES`.
- Migração de dados: `UPDATE customers SET pos_venda_stage='espera' WHERE pos_venda_stage='em_analise' OR (pos_venda_stage IS NULL AND customer_origin='igreen_sync' AND status NOT IN ('rejected','cancelled','canceled'))`.
- Função `computeStage()` passa a devolver `espera` em vez de `em_analise` no fallback.
- `PendingApprovalDialog` continua disparando para clientes em `espera`.

Layout final das colunas do CRM Clientes:
```text
Aguardando Classificação → Aprovado → Reprovado → 30d → 60d → 90d → 120d
```

## 2. Autoprogressão de mensagens (paridade com CRM Leads)

### 2.1 Reaproveitar `kanban_stages` + `stage_auto_messages`

Em vez de criar uma tabela nova, criar **stages dedicados Pós-Venda** por consultor com prefixo `pv_`:

- `pv_espera`, `pv_aprovado`, `pv_reprovado`, `pv_d30`, `pv_d60`, `pv_d90`, `pv_d120`

Isso permite reaproveitar 100% o componente `StageAutoMessageConfig` (texto + imagem + vídeo + áudio + voice template + delay + motivo de reprovação).

Migração:
- Adicionar coluna `kanban_stages.stage_scope text default 'lead'` (valores: `lead` | `pos_venda`).
- Seed inicial: para cada consultor existente, inserir as 7 linhas `pv_*` com `stage_scope='pos_venda'` (sem auto-mensagem ativada por padrão — consultor configura depois).

### 2.2 UI no `PosVendaKanban`

- Botão **"⚙ Configurar autoprogressão"** no header → abre dialog com lista das colunas Pós-Venda; em cada uma um `<StageAutoMessageConfig>` (mesmo componente do CRM Leads).
- Em cada card, manter botão 👁 (ver detalhes) já existente.
- Badge sutil "📨 auto ativa" quando o stage tem mensagens configuradas.

### 2.3 Engine — nova edge function `pos-venda-auto-progress`

Reusar resolver/sender já testado em `crm-auto-progress` (movemos para `_shared/channel-sender.ts` para evitar duplicação).

Lógica (rodando a cada hora via pg_cron):

```text
para cada customer com customer_origin='igreen_sync':
  - se status == aprovado e pos_venda_stage IS NULL ou 'espera' e o consultor já confirmou no popup
       → mover para 'aprovado' + disparar mensagens do pv_aprovado
  - se status == reprovado e pos_venda_stage != 'reprovado'
       → mover para 'reprovado' + mensagens do pv_reprovado (com filtro por motivo)
  - se está 'aprovado' há ≥30/60/90/120 dias e ainda não foi para o bucket
       → mover + disparar pv_d30 / pv_d60 / pv_d90 / pv_d120
```

Idempotência: nova tabela `customer_auto_message_log` (espelho do `crm_auto_message_log`) com `(customer_id, stage_key)` único — evita reenvio.

Respeitar: `quiet-hours`, `isConsultantAIDisabled`, `isPausedByPhone`, `checkSendQuota` (anti-ban). Idêntico ao `crm-auto-progress`.

### 2.4 Canal de envio (Evolution + Whapi)

O mesmo `resolveChannel()` do `crm-auto-progress`:
1. Procura `whatsapp_instances` do consultor → usa Evolution.
2. Senão usa Whapi (`settings.whapi_token`) como fallback compartilhado.

Toda mensagem (texto/áudio/imagem/vídeo) sai pelo `ChannelAdapter` unificado (`_shared/channels/index.ts`) — mesma pipeline já validada nos leads.

### 2.5 Cron

```sql
select cron.schedule(
  'pos-venda-auto-progress-hourly',
  '15 * * * *',
  $$ select net.http_post(url:='…/pos-venda-auto-progress', headers:='{…anon…}'::jsonb, body:='{}'::jsonb) $$
);
```

## 3. Salvaguarda anti-disparo nos clientes antigos

Os ~890 clientes antigos importados estão em `espera` com `pos_venda_manual=true` (já feito no v1.3.0). A nova engine **ignora `pos_venda_manual=true`** na hora de mover automaticamente — só age quando o consultor confirma no `PendingApprovalDialog` (que faz `pos_venda_manual=false` + setta stage final). Assim antigos só progridem se o consultor mandar; novos seguem o fluxo automático normal.

## 4. Arquivos alterados / criados

**Database (migração):**
- ALTER `kanban_stages` add `stage_scope`.
- INSERT `pv_*` stages por consultor.
- CREATE TABLE `customer_auto_message_log` (+ GRANTs + RLS).
- UPDATE `customers` movendo `em_analise` → `espera`.

**Frontend:**
- `src/components/whatsapp/PosVendaKanban.tsx` — remover coluna `em_analise`, renomear `espera`, botão de configurar autoprogressão.
- `src/components/whatsapp/PosVendaAutoConfigDialog.tsx` *(novo)* — lista 7 stages com `<StageAutoMessageConfig>`.

**Edge functions:**
- `supabase/functions/_shared/channel-sender.ts` *(novo)* — extrai `resolveChannel`, `sendText/Media/Audio`, `sendAutoMessages` do `crm-auto-progress`.
- `supabase/functions/crm-auto-progress/index.ts` — refatorar para usar shared.
- `supabase/functions/pos-venda-auto-progress/index.ts` *(novo)* — engine descrita em 2.3.
- `supabase/functions/pos-venda-bucket-cron/index.ts` — continua só fazendo bucket por tempo (sem mensagens), ou é absorvido pelo novo.

**Cron:** schedule do `pos-venda-auto-progress` via `supabase--insert`.

## 5. Validação

- [ ] Coluna única "Aguardando Classificação" aparece com badge âmbar.
- [ ] Botão "Configurar autoprogressão" abre 7 stages editáveis.
- [ ] Cliente aprovado no popup → mensagem `pv_aprovado` chega no WhatsApp via Evolution (ou Whapi se sem instância).
- [ ] Cliente parado em `aprovado` há 30 dias é movido pra `d30` e recebe a mensagem configurada (texto+áudio).
- [ ] Cliente reprovado com motivo X recebe só a mensagem `pv_reprovado` filtrada por motivo.
- [ ] `customer_auto_message_log` registra `sent`, evita duplicata.
- [ ] Anti-ban / quiet hours / consultor IA pausado bloqueiam envio.
- [ ] Clientes antigos (`pos_venda_manual=true`) não recebem nada até confirmação manual.

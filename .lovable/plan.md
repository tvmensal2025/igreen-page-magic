
## Problema

No `whapi-webhook/index.ts` (super admin), quando o lead chega de uma campanha com pool de rodízio ativa, hoje só **pulamos** o match por keyword — nunca chamamos `rodizio_next`, nunca setamos `referral_partner_id` e nunca avisamos o participante da vez. O lead fica todo no super admin, `lead_count` da pool nunca avança, e a regra diverge do `evolution-webhook` (viola "evolution e whapi não podem mudar").

No `evolution-webhook/index.ts` (linhas 969–1029) já existe o bloco correto, usando `decideRodizioAssignment` (helper puro em `evolution-webhook/rodizio-assignment.ts`).

## Solução

Portar o mesmo bloco para o whapi, **promovendo o helper para `_shared/`** para os dois webhooks consumirem exatamente a mesma decisão e nunca mais divergirem. Helper continua puro (sem rede, sem Supabase) — coberto pelas property tests P4/P5/P6 já existentes.

### Passos

1. **Mover helper para `_shared/`** (conteúdo idêntico):
   - `supabase/functions/evolution-webhook/rodizio-assignment.ts` → `supabase/functions/_shared/rodizio-assignment.ts`
   - Atualizar import em `evolution-webhook/index.ts` (linha 31).
   - Atualizar qualquer teste/arquivo que importe o path antigo (`rg` para confirmar lista exata antes da edição).

2. **whapi-webhook/index.ts — bloco do rodízio (substituir ~linhas 738–794):**
   - Manter a mini-resolução de `candidateCampaignId` já existente (source_campaign_id do customer; senão AD ID; senão ctwa_clid) — necessária porque no whapi a detecção completa de lead-source só roda mais à frente (linha ~1293), diferente do evolution.
   - Quando `candidateCampaignId` resolve E há pool ativa, chamar **`supabase.rpc("rodizio_next", { p_campaign_id: candidateCampaignId })`**.
   - Passar retorno por `decideRodizioAssignment({ customer: { ...customer, source_campaign_id: candidateCampaignId }, rodizioRows })`.
   - Se `decision.applied`: `update` em `customers` com `referral_partner_id` + `referral_detected_at` (não tocar `consultant_id`), atualizar a referência em memória, e chamar `notifyPartnerNewLead(superAdminConsultantId, partnerId, { id, name, phone_whatsapp, is_sandbox })` com `.catch` best-effort.
   - Também persistir `source_campaign_id` no customer quando resolvido aqui pela primeira vez (evita o lead-source posterior chamar `rodizio_next` novamente e consumir um segundo turno).
   - Manter `rodizioPoolAtiva = true` sempre que existir pool (mesmo no fallback de partner_id inválido), preservando a prioridade do rodízio sobre keyword (Req 8).
   - Fail-open total: qualquer erro só loga e segue para keyword.

3. **Nada mais muda:**
   - `rodizio_next` (RPC) é o mesmo nos dois canais → mesma fila atômica, mesmo `lead_count++`.
   - `decideRodizioAssignment` é o mesmo helper puro.
   - `notifyPartnerNewLead` é o mesmo (`_shared/notify-consultant.ts`).
   - Match por keyword (linhas 796+) intocado, só roda quando NÃO há pool ativa.
   - Fluxo D, motor conversacional, gates LGPD, anti-welcome, lock global — intocados.
   - `facebook-create-campaign` e `rodizio-pool.ts` — intocados.

### Coerência verificada

- **Imports:** `notifyPartnerNewLead` já está importado no whapi (linha 24). `supabase` (service role) já disponível no escopo. Sem novas dependências.
- **Tipos:** `RodizioCustomerState` aceita `referral_partner_id` e `source_campaign_id` opcionais — o objeto montado `{ ...customer, source_campaign_id: candidateCampaignId }` satisfaz.
- **Idempotência:** condição `!customer.referral_partner_id` antes do bloco impede dupla atribuição em reentrada.
- **Detecção lead-source posterior (linha ~1293):** já tem guarda `alreadyTagged = !!source_campaign_id` — se persistirmos `source_campaign_id` no bloco do rodízio, ela pula sem reprocessar. ✅
- **Bloco keyword posterior (linha ~803):** já tem guarda `!rodizioPoolAtiva` — continua funcionando. ✅
- **Edge runtime (Deno):** mover arquivo para `_shared/` é padrão do projeto (vários helpers compartilhados já lá). Sem mudança de schema, sem novos secrets.

### Riscos e mitigações

- **AD ID/ctwa_clid ausentes na 1ª mensagem:** `candidateCampaignId` fica nulo → nenhum turno consumido, cai no keyword. Sem regressão vs. hoje.
- **Quebra de import path do helper movido:** edição mecânica validada por `tsgo` antes do deploy.
- **Concorrência (duas mensagens simultâneas do mesmo lead):** `rodizio_next` é atômico via lock em `rodizio_pools`; a guarda `!referral_partner_id` mais o lock impedem dupla atribuição.

### Validação

- `tsgo` nos dois webhooks.
- Property tests P4/P5/P6 verdes apontando para o novo path em `_shared/`.
- Deploy `whapi-webhook` + `evolution-webhook`; smoke manual: lead de campanha do super admin com pool de 2+ participantes → confirmar `customers.referral_partner_id` setado e `rodizio_pool_members.lead_count` incrementando em rodízio.

### Arquivos tocados

- `supabase/functions/_shared/rodizio-assignment.ts` (novo — conteúdo movido sem alteração)
- `supabase/functions/evolution-webhook/rodizio-assignment.ts` (deletado)
- `supabase/functions/evolution-webhook/index.ts` (1 linha — import)
- `supabase/functions/whapi-webhook/index.ts` (~50 linhas no bloco rodízio)
- Arquivos de teste que importam o helper (atualizar path)

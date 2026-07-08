## Diagnóstico: por que a rede da Nilma "sumiu" (e o mesmo bug atinge qualquer subconta futura)

O worker JÁ sincroniza as 3 contas do Rafael (Conta principal, sirlene, Nilma santana) — os logs mostram isso rodando bem (`[multi-account] sync conta position=1/2/3 consultant=0c2711ad…`). O problema não é login nem Cloudflare, é **como a rede é persistida**.

### O bug (confirmado no banco agora mesmo)

Em `supabase/functions/sync-igreen-customers/index.ts` → `persistNetwork` (linhas 1711-1730):

```ts
// Remove stale members
const apiIds = netRecords.map((r) => Number(r.igreen_id));   // <-- só os IDs desta CONTA
const existingMembers = ... where consultant_id = <Rafael>;
const staleIds = existingMembers.filter(id NOT IN apiIds);
await supabase.from("network_members").delete()
  .eq("consultant_id", <Rafael>)                             // <-- apaga do OWNER inteiro
  .in("igreen_id", staleIds);
```

O que acontece na prática, na ordem em que o cron roda hoje (position=1 → 2 → 3):
1. Sincroniza `Conta principal` (rafael) → grava 33 membros, remove nada.
2. Sincroniza `sirlene` → grava 7 membros e **apaga os 33 do Rafael** (não estão na lista de 7).
3. Sincroniza `Nilma santana` → grava 31 membros e **apaga os 7 da sirlene**.

Resultado no banco agora: `SELECT COUNT(*) FROM network_members WHERE consultant_id='<Rafael>'` → **7 linhas** (uma corrida "azarada" — deveria ser união ~55-70). Confirma o que você viu: "a rede da Nilma não apareceu somada".

Toda subconta nova que você adicionar em `igreen_portal_accounts` vai continuar zerando a rede das outras. É determinístico.

### Correções (uma migração + uma edge function)

**1. Migração — adicionar `igreen_account_id` em `network_members`**
```
ALTER TABLE public.network_members
  ADD COLUMN igreen_account_id uuid REFERENCES public.igreen_portal_accounts(id) ON DELETE SET NULL;

-- unique compat: (consultant_id, igreen_id) permanece (dedup de mesmo membro entre contas — se
-- o mesmo idconsultor aparecer em 2 contas, upsert atualiza a mesma linha, enriquecendo).
CREATE INDEX IF NOT EXISTS network_members_owner_account_idx
  ON public.network_members(consultant_id, igreen_account_id);
```

**2. Edge function `sync-igreen-customers` → `persistNetwork`**
- Aceitar `igreenAccountId` como parâmetro (já é passado para `persistCustomers`; replicar).
- Gravar `igreen_account_id` em cada row do upsert.
- **Delete-stale escopado por conta**: `.eq("consultant_id", ownerId).eq("igreen_account_id", accountId).in("igreen_id", staleIds)`.
- Fallback para linhas legadas sem `igreen_account_id`: só apagar staleIds nulos quando estamos rodando a `position=1` (Conta principal).

Passar `igreenAccountId` na chamada (linha ~522):
```ts
out.network = await persistNetwork(supabase, consultantId, r.data?.members || [], igreenAccountId);
```

**3. Enriquecimento (o que você pediu: "somando e enriquecendo")**
Já funciona parcialmente para `customers` (upsert por `phone_whatsapp,consultant_id` faz merge). Para rede, o mesmo upsert por `(consultant_id, igreen_id)` já enriquece quando o mesmo `idconsultor` aparece em 2 contas — a última corrida escreve por cima os campos numéricos (gp/gi/qtde_diretos/bonificavel etc). Isso é o comportamento desejado ("dono acumula tudo, com dados enriquecidos da conta mais recente").

Para deixar 100% previsível, também vou incluir no upsert um `MERGE`-style para campos "somáveis" quando fizer sentido — mas o padrão do iGreen já é: cada membro tem métricas próprias e não somamos entre contas (seria dobrar). O correto é **exibir a união distinta**, que é exatamente o que o upsert por `(consultant_id, igreen_id)` faz.

### Verificação depois da fix
- Rodar sync full para o Rafael e conferir `SELECT COUNT(*) FROM network_members WHERE consultant_id='<Rafael>'` — deve ficar ≈ união(33 + 7 + 31) menos interseções.
- Adicionar/remover uma 4ª conta e conferir que a remoção de conta só apaga os membros com aquele `igreen_account_id`.

### Fora de escopo (não muda)
- `persistCustomers` — o dedup atual por telefone e `(consultant_id, igreen_code)` já agrega corretamente múltiplas contas no mesmo owner; só vou adicionar log para confirmar quantos vieram de cada `igreen_account_id`.
- Boletos, telecom, seguros — usam `consultant_id + idcliente/idcnxtelecom + mes_referencia` como conflict key, então já mesclam sem duplicar. Sem mudança.
- Login / Cloudflare / Tor — sem mudança, funcionando.

### Arquivos alterados
- `supabase/migrations/<nova>.sql` — adiciona coluna + índice em `network_members`.
- `supabase/functions/sync-igreen-customers/index.ts` — atualiza `persistNetwork` (assinatura, upsert com `igreen_account_id`, delete-stale escopado por conta) e o call site.

Quer que eu implemente exatamente isso? Se sim, vou também rodar um sync manual do Rafael depois da migração para reconstruir a rede completa.

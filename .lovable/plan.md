## Diagnóstico

Consultei a base. Para o passo `como_funciona` (e potencialmente outros), a tabela `ai_media_library` tem **duas linhas de áudio distintas** que ambas casam com a regra de "mídia visível para o consultor":

| id | consultant_id | is_public | kind | url |
|---|---|---|---|---|
| ae97f46b… | NULL | true | audio | `como_funciona_1778939276859.ogg` (órfã, sem dono) |
| fdde2dba… | 0c2711ad (Super Admin) | true | audio | `b467b41f…mp3` (a oficial) |

Como o flow público é do Super Admin (`0c2711ad`), a query do loader v3 em `supabase/functions/_shared/engine/loader.ts` (linha 178)

```ts
.or(`consultant_id.eq.${mediaOwnerId},is_public.eq.true`)
```

traz **as duas** linhas. O dedup atual em `mediaBySlotAndKind` (linha 195) só sobrescreve quando "público vira pessoal", mas como ambas têm `is_public=true`, o resultado é não-determinístico e pode vazar a duplicata. O mesmo princípio explica por que o painel /admin/fluxos do consultor lista mais mídias do que o painel do Super Admin para o mesmo slot.

A regra do produto, confirmada agora: **consultor em `sync_mode='public'` precisa ver e enviar EXATAMENTE as mídias do Super Admin — nem mais, nem menos.**

## O que vou fazer

### 1. Migration — desativar a linha órfã duplicada (cirúrgica)

Só uma linha está duplicando o áudio de `como_funciona`. Em vez de deletar (perde histórico), marco como inativa:

```sql
UPDATE public.ai_media_library
SET active = false,
    updated_at = now()
WHERE id = 'ae97f46b-98ad-418c-87ff-982f2c70ef2c'
  AND consultant_id IS NULL
  AND slot_key = 'como_funciona'
  AND kind = 'audio';
```

Também vou rodar uma checagem geral: para cada `(slot_key, kind)` com mais de uma linha visível no flow público, manter apenas a do `consultant_id` do dono do flow público e inativar as órfãs/duplicatas `consultant_id IS NULL`. Isso é seguro porque o Super Admin tem a versão "oficial" — qualquer linha `is_public=true` sem dono é resquício de migração antiga.

Sem `CREATE TABLE`, sem mexer em RLS, sem mudar grants.

### 2. Loader v3 — paridade total com o Super Admin (`supabase/functions/_shared/engine/loader.ts`)

Trocar a query OR pela regra "mídia do dono do flow público + fallback público estrito":

- Buscar primeiro `consultant_id = mediaOwnerId` (mídias do Super Admin/owner do flow público).
- Só fazer fallback em `is_public=true AND consultant_id IS NULL` se o owner não tiver nada naquele `(slot_key, kind)`.
- No `mediaBySlotAndKind`, ao detectar mais de uma linha para mesma `(slot, kind)`, **manter apenas uma** — a do owner ganha sempre; em empate, a mais recente por `updated_at`.

Isso elimina o vazamento mesmo que reapareçam linhas duplicadas no futuro (defesa em profundidade).

### 3. Caminhos legacy — auditoria rápida

`evolution-webhook/handlers/bot-flow.ts` e `whapi-webhook/handlers/bot-flow.ts` linhas ~1493 e ~1877 já usam `.eq("consultant_id", mediaOwnerId)` (sem OR), então estão corretos. O fallback em `is_public=true` na linha ~1887 é só quando não há nada pessoal — vou ajustar para também restringir a `consultant_id IS NULL OR consultant_id = mediaOwnerId`, evitando puxar mídia pública de outro consultor.

### 4. Painel /admin/fluxos do consultor

Vou abrir o componente do painel de mídias do passo (provavelmente `StepMediaPanel` / `flow editor`) e aplicar a mesma regra: listar somente as mídias do `mediaOwnerId` (em sync_mode public) ou do próprio consultor (custom). O consultor vai ver exatamente o mesmo conjunto que o Super Admin lista.

## Detalhes técnicos

- Sem mudança em RLS, sem `GRANT`, sem nova tabela.
- Sem mudança em anti-ban, dispatcher, dedupe ou ordem de envio.
- `flow_step_media_order` continua sendo lido do `mediaOwnerId` (já está correto).
- A linha desativada continua na base — se o Super Admin precisar reativar, basta `UPDATE … active=true`.

## Arquivos a editar

- **Migration nova** (cirurgica) — `UPDATE` em `ai_media_library`.
- `supabase/functions/_shared/engine/loader.ts` — query e dedup determinístico.
- `supabase/functions/whapi-webhook/handlers/bot-flow.ts` — fallback público restrito.
- `supabase/functions/evolution-webhook/handlers/bot-flow.ts` — idem.
- Componente do painel de mídias do passo no `/admin/fluxos` — filtro por `mediaOwnerId` (vou localizar exato em build mode).

## Limitação honesta

Vou só inativar a linha duplicada que já encontrei (`como_funciona`). Se houver outros slots duplicados no futuro, o reforço no loader+painel impede o vazamento automaticamente — mas se você quiser, posso rodar uma varredura ampla agora e te trazer a lista antes de inativar em massa. Por padrão vou no conservador: 1 UPDATE pontual + defesa no código.

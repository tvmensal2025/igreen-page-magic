## Diagnóstico

Os 4 consultores com Fluxo D estão configurados assim:

| Consultor | sync_mode | steps | media_order | ai_media_library |
|---|---|---|---|---|
| Rafael (público) | custom | 16 | 732 chars (cheio) | dezenas de áudios/vídeos pessoais |
| Bruna | public | 16 | `{}` vazio | 0 mídias pessoais |
| tvmensal01 | public | 16 | 56 chars | 0 |
| tvmensal22 | public | 16 | `{}` vazio | 0 |

**Os textos das 16 etapas batem 100%** (já validado linha a linha entre o flow público e o da Bruna). O que diverge no runtime é a **camada de mídia**, porque ela NÃO segue o `sync_mode`:

- `bot_flow_steps.message_text` → resolvido pelo flow público ✅
- `bot_flow_qa` (FAQ) → resolvido pelo flow público ✅ (após migração recente)
- **`consultants.flow_step_media_order`** → lido do consultor logado ❌ (Bruna = `{}`, sem áudio/vídeo/imagem por passo)
- **`ai_media_library`** → filtrado por `consultant_id = caller` ❌ (Bruna não tem nenhum item pessoal, só pega o `is_public=true` global, que é uma fração do que o Rafael tem)

Resultado: a Bruna recebe **só os textos e botões**, sem os áudios e vídeos que o Rafael tem cadastrados no Fluxo D público. Por isso "não está igual".

Arquivos onde isso vive hoje:
- `supabase/functions/_shared/engine/loader.ts` (linhas 115-168) — engine v3
- `supabase/functions/evolution-webhook/handlers/bot-flow.ts` (linhas 1220-1240, 1638-1830) — legacy
- `supabase/functions/whapi-webhook/handlers/bot-flow.ts` — legacy espelhado

## Plano

**Regra única:** quando `bot_flows.sync_mode = 'public'`, todo o lookup de mídia deve usar o **dono do flow público** (Rafael), não o consultor logado. Assim o consultor herda 100% áudio + vídeo + imagem + ordem.

### 1. Edge functions

**`_shared/engine/loader.ts`**
- Já resolve o `flow_id` público quando `sync_mode='public'`. Adicionar resolução paralela do `media_owner_id`:
  - se `sync_mode='public'` → `media_owner_id = consultant_id do flow público`
  - senão → `media_owner_id = consultantId` (atual)
- Trocar:
  - `consultants.flow_step_media_order` → buscar por `media_owner_id`
  - `ai_media_library .or(consultant_id.eq.${media_owner_id},is_public.eq.true)`
- Manter o fallback "personal trumps public" exatamente como está.

**`evolution-webhook/handlers/bot-flow.ts` e `whapi-webhook/handlers/bot-flow.ts`**
- Resolver `media_owner_id` uma vez no topo do handler (mesma regra).
- Substituir todas as chamadas `ai_media_library ... eq("consultant_id", consultantId)` por `eq("consultant_id", mediaOwnerId)`.
- Idem para a leitura de `consultants.flow_step_media_order`.

### 2. Áudio (`audio_library`)
Mesma regra: quando `sync_mode='public'`, fallback consulta `audio_library` do dono do flow público + `is_public=true`. Hoje a Bruna não recebe nenhum áudio "mutirão" porque o único `is_public=true` está sob outro consultor (tvmensal01).

### 3. Botões
Botões vivem dentro de `bot_flow_steps.captures._buttons` — já vêm do flow público. **Sem mudança** necessária. (Validado: bate.)

### 4. UI Super Admin — auditoria de paridade
Adicionar um botão "Validar paridade com público" no painel do Fluxo D que, para cada consultor com `sync_mode='public'`, mostra:
- ✅ Texto bate
- ⚠️ Mídia divergente em N passos
- Botão "Reaplicar mídia do público" (no-op se a regra acima já cobrir, só para inspeção visual)

Isso permite ao Super Admin verificar que Bruna, tvmensal01 e tvmensal22 estão 100% iguais ao Rafael sem precisar abrir cada flow.

### 5. Migração de dados (opcional, só limpeza)
Nenhuma migração de schema é necessária. Como bônus, podemos zerar `flow_step_media_order` dos 3 consultores em `sync_mode='public'` para deixar explícito que nada local é usado — mas a regra acima já ignora.

## Detalhes técnicos

- Não há mudança de schema, só edge-functions + 1 componente React.
- A resolução do `media_owner_id` pode ser cacheada por turno (mesmo `flow_id` público resolvido para os steps).
- Sem impacto em consultores com `sync_mode='custom'` (Rafael).
- Sem impacto em outras variants — a regra é puramente sobre `sync_mode='public'`.

## Arquivos a tocar

- `supabase/functions/_shared/engine/loader.ts`
- `supabase/functions/evolution-webhook/handlers/bot-flow.ts`
- `supabase/functions/whapi-webhook/handlers/bot-flow.ts`
- `src/pages/AdminFluxoD.tsx` (ou painel equivalente) — botão "Validar paridade"
- `src/components/admin/flow-builder/PublicParityCheck.tsx` (novo, ~120 linhas)

## Fora de escopo

- Mudar a forma como Super Admin edita mídia (continua tudo no consultor dono do flow público).
- Tocar QAs/FAQ (já está resolvido na migração anterior).
- Remote support, parceiros, disparo em massa.

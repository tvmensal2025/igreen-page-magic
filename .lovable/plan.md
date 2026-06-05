## Objetivo
Cada consultor deve executar o **mesmo fluxo do template público do superadmin** (mesma estrutura, textos, botões, transições, regras). Diferenças permitidas:
- **Mídias** (áudio/vídeo/imagem) são per-consultor — trocar uma mídia só afeta esse consultor.
- **Evolution renderiza botões como lista numerada 1️⃣2️⃣3️⃣** — já funciona em runtime (`appendButtonsToText` em `evolution-webhook/handlers/conversational/index.ts:245`), zero código novo.

Toggle no topo de `/admin/fluxos`: ligar = "100% igual ao público" (estrutura travada, mídias livres). Desligar = fork (libera edição de estrutura, mas perde sincronia automática).

Bônus: o "Passo removido" da tela atual some sozinho porque o consultor passa a ler os steps do template público, que é internamente consistente (verifiquei no banco: todas as 16 transições do flow público `320bf22c` resolvem; o flow do consultor `b539a8a2` tem step_keys e slot_keys 100% alinhados com o público).

## Arquitetura: `bot_flows.sync_mode`

Coluna nova: `bot_flows.sync_mode text NOT NULL DEFAULT 'public' CHECK (sync_mode IN ('public','custom'))`.

- `'public'`: ao resolver o fluxo em runtime/editor, **carregar steps do `bot_flows` com `is_public=true` da mesma variante**. Linha do consultor existe só pra carregar metadados (sync_mode, variant, consultant_id) e para preservar identidade.
- `'custom'`: comportamento atual, lê os próprios `bot_flow_steps`.

Mídias permanecem em `ai_media_library` filtradas por `consultant_id + slot_key` (já é assim — verifiquei que `slot_key` casa 1:1 entre público e consultor: `como_funciona`, `passo_mpagqq3g`, `prova_social`, etc.).

## Mudanças mínimas

### 1) Migration (1 arquivo SQL)
```sql
ALTER TABLE public.bot_flows
  ADD COLUMN IF NOT EXISTS sync_mode text NOT NULL DEFAULT 'public'
  CHECK (sync_mode IN ('public','custom'));

-- Preservar edições existentes: quem já tem fluxo próprio fica em 'custom'
UPDATE public.bot_flows SET sync_mode = 'custom'
  WHERE consultant_id IS NOT NULL AND is_public = false;

-- O template do superadmin é a fonte da verdade — sempre 'custom'
UPDATE public.bot_flows SET sync_mode = 'custom' WHERE is_public = true;
```
Nenhuma mudança em RLS (a coluna não muda regras de acesso).

### 2) Runtime: `supabase/functions/_shared/resolve-flow.ts` (1 arquivo, ~15 linhas)
Mudar `resolveFlowId` para, depois de achar o fluxo do consultor, consultar `sync_mode`. Se `'public'`, retornar o `id` do fluxo público da mesma variante. Devolve só `{ id }` (assinatura inalterada) — assim os **40+ call sites** em `evolution-webhook/handlers/bot-flow.ts` e `whapi-webhook/handlers/bot-flow.ts` não precisam ser tocados.

```ts
const { data: own } = await supabase
  .from("bot_flows")
  .select("id, sync_mode")
  .eq("consultant_id", consultantId).eq("is_active", true).eq("variant", v)
  .order("created_at").limit(1).maybeSingle();
if (own?.id) {
  if (own.sync_mode === "public") {
    const { data: pub } = await supabase
      .from("bot_flows").select("id")
      .eq("is_public", true).eq("is_active", true).eq("variant", v)
      .limit(1).maybeSingle();
    if (pub?.id) return { id: pub.id };
  }
  return { id: own.id };
}
```
Mídia/FAQ continuam por `consultant_id` (já são) → mudança transparente.

### 3) Editor `src/pages/FluxoBuilder.tsx`

**A) `reload()` (linha 247-296):** após buscar o fluxo do consultor (`flows[0]`), também ler `sync_mode`. Se `'public'`, fazer 2ª query para pegar o **id do fluxo público** da mesma variante e carregar `bot_flow_steps WHERE flow_id = <publicId>` em vez do próprio. Guardar `syncMode` e `publicFlowId` em estado.

**B) Header novo (acima de `StepListToolbar`):** um `<Switch>` "Seguir modelo público do superadmin" + badge "Sincronizado" / "Personalizado". Banner amarelo quando ligado:
> "Estrutura sincronizada com o modelo público. Você pode trocar apenas as **mídias** dos passos. Alterações do superadmin aparecem automaticamente."

**C) Read-only quando `syncMode==='public'`:**
- Desabilitar: drag-and-drop (`sensors` desativados), botões "Adicionar passo", "Duplicar", "Remover", "Editar transições", "Editar texto/botões/captures" no `StepInspector`.
- **Manter habilitado:** `StepMediaPanel` (linha 475 do `StepInspector.tsx`) — ele grava em `ai_media_library` por `consultant_id`, comportamento desejado.

**D) Toggle handlers:**
- **Desligar (público → custom):** modal "Vai perder a sincronia. Continuar?". Ao confirmar, RPC `fork_flow_from_public(consultant_id, variant)` que: (1) clona todos `bot_flow_steps` do público para o flow do consultor; (2) seta `sync_mode='custom'`. Recarregar.
- **Ligar (custom → público):** modal "Suas edições nos passos serão ignoradas (não apagadas). Mídias preservadas. Continuar?". Update `sync_mode='public'`. Recarregar (passa a renderizar steps do público).

### 4) RPC `fork_flow_from_public` (na mesma migration)
Função SECURITY DEFINER que copia `bot_flow_steps` do público para o flow do consultor (re-gerando UUIDs e remapeando `goto_step_id` nas transitions). Chamada só pelo editor. Idempotente: se o consultor já tem steps, faz `DELETE` antes do `INSERT` (com confirm no UI).

### 5) Seed para novos consultores
Atualizar trigger/RPC `seed_default_camila_flow` para criar a linha em `bot_flows` com `sync_mode='public'` e **sem clonar steps** (não precisa — runtime lê do público).

## O que NÃO muda
- Schema de `bot_flow_steps`, `ai_media_library`, `bot_flow_qa_media`, `customer_flow_state`.
- `sender-guard` + burst-bypass (já implementado).
- Whapi continua editando o template em `'custom'` (superadmin).
- `appendButtonsToText` no Evolution (já transforma botões em 1️⃣2️⃣3️⃣).
- Os 40+ call sites de `resolveFlowId` (assinatura preservada).

## Validação
1. Após migration: consultor `tvmensal01` (`953f7e48`) está em `'custom'` (preservou edições). Toggle desligado.
2. Ligar toggle → confirma → editor recarrega mostrando os 16 passos do público, **sem "Passo removido"**, drag-and-drop e edição estrutural desabilitados, mídias editáveis.
3. Trocar áudio do passo "Como funciona" → salva em `ai_media_library` (consultor_id = tvmensal01) → outros consultores não afetados.
4. Lead manda "oi" no Evolution → recebe boas-vindas do template público com botões "1️⃣ 2️⃣ 3️⃣". Clica "2" → recebe áudio do consultor + vídeo do consultor + texto com lista numerada **no mesmo turno** (burst-bypass).
5. Superadmin edita texto do passo "Boas-vindas" no público → próximo lead de qualquer consultor em `'public'` vê a mudança.
6. Desligar toggle em outro consultor → fork copia steps do público → consultor edita à vontade sem afetar os demais.

## Escopo: arquivos tocados
- 1 migration nova (ADD COLUMN + UPDATE + função `fork_flow_from_public`)
- `supabase/functions/_shared/resolve-flow.ts` (lookup do sync_mode)
- `src/pages/FluxoBuilder.tsx` (reload + header toggle + read-only gating)
- `src/components/admin/flow-builder/StepInspector.tsx` (desabilitar edição quando read-only)
- `src/components/admin/flow-builder/StepTimelineItem.tsx` (esconder botões de edição em read-only)
- (opcional) atualizar `seed_default_camila_flow` para novos consultores nascerem `'public'`

## Risco
- **Baixo.** Mudança no `resolve-flow` é transparente para callers. Consultores existentes ficam em `'custom'` (zero efeito). Novos consultores e quem ligar o toggle usam o caminho `'public'`.
- A coluna nova é compatível: código antigo que não conhece `sync_mode` continua funcionando (UPDATE só preenche valores existentes; default cobre INSERTs futuros).
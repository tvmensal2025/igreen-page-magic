# Reconciliação "100% igual ao público"

## Diagnóstico

Hoje o consultor `tvmensal01` (e qualquer flow consultor existente antes da última migração) está marcado como `sync_mode = 'custom'`. A migração preservou edições antigas como custom, mas o resultado é que esses consultores **não** seguem o template público — eles veem uma cópia congelada e divergente (steps duplicados, regras antigas, mídias defasadas).

Estrutura atual:

| Flow | sync_mode | steps | observação |
|---|---|---|---|
| Público D (super-admin) | custom | 16 | fonte da verdade |
| tvmensal01 D | **custom** | 16 | cópia antiga, não atualiza |
| Outros consultores | custom | varia | mesmo problema |

Quando `sync_mode='public'`, `resolveFlowId` e o `FluxoBuilder` já redirecionam para os steps do template público — isso está correto. Falta apenas **virar o default** para os consultores existentes.

## Mudanças

### 1. Migration: re-sincronizar consultores

```text
UPDATE bot_flows
SET sync_mode = 'public'
WHERE is_public = false
  AND consultant_id <> '<super-admin uuid>';
```

- Não apaga nada do `bot_flow_steps` do consultor (a coluna fica como backup).
- Super-admin permanece `custom` — ele edita o template público.
- Consultor que quiser divergir clica no toggle "Personalizar" → `fork_flow_from_public` re-popula os steps.

### 2. Garantir paridade em runtime (revisão)

Conferir nos 3 caminhos abaixo que, quando `sync_mode='public'`, **estrutura** vem do flow público e **mídias** seguem a regra "consultor primeiro, público como fallback":

- `_shared/resolve-flow.ts` → já redireciona ✅
- `_shared/engine/loader.ts` → `ai_media_library` lê `consultant_id OR is_public=true` ✅
- `evolution-webhook/handlers/bot-flow.ts` e `whapi-webhook/handlers/bot-flow.ts` → confirmar que o lookup direto por `media_id` também respeita `active=true` e que, na ausência da mídia do consultor para um slot, usa a pública.

Qualquer divergência encontrada nessa revisão (ex.: duração de áudio, ordem de envio, regras de transição) é corrigida editando o template público — passa a refletir em todos automaticamente.

### 3. FluxoBuilder: feedback visual claro

- Banner no topo quando `sync_mode='public'`: "Você está vendo o modelo do super-admin. Mídias podem ser personalizadas; estrutura e regras seguem o template."
- Botão "Personalizar este fluxo" (já existe) com confirmação explícita: "Ao personalizar, você perde atualizações futuras do super-admin nesse fluxo".
- Para super-admin, esconder o toggle (já feito).

### 4. Limpeza opcional do template público

Os steps `d_como_funciona_copy_in3s` ("Como funciona (2)") e `d_como_funciona_copy_qwpu` ("Como funciona (3)") parecem duplicatas órfãs no template público. Confirmar com o usuário se devem ser removidos do template — se sim, sai do público uma única vez e desaparece para todos os consultores em modo `public`.

## Validação

1. Após a migration, abrir `/admin/fluxos` como `tvmensal01` → toggle aparece como "Sincronizado", lista mostra exatamente os 16 steps do super-admin, edição bloqueada.
2. Editar um texto/regra no template público (logado como super-admin) → recarregar como `tvmensal01` → mudança aparece imediatamente.
3. Subir uma mídia nova como `tvmensal01` no slot `como_funciona` → runtime envia a mídia do consultor; outros consultores continuam recebendo a pública.
4. Clicar "Personalizar" como `tvmensal01` → `fork_flow_from_public` roda, steps clonados, edição liberada, super-admin para de propagar.

## Pontos abertos para o usuário

- **Remover as duplicatas "Como funciona (2)" e "(3)"** do template público? (item 4)
- Confirmar lista de consultores que devem permanecer em `custom` (se houver algum que já personalizou de propósito).

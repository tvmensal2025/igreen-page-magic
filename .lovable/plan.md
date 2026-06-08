
## Diagnóstico

Investiguei o banco e o código. Encontrei 3 causas raiz distintas, que vou resolver de uma vez.

### 1. "Não consigo criar outras variantes"
A RPC `ensure_bot_flow_variant` existe, mas tem 2 problemas:
- Ela exige que `auth.uid() = _consultant_id` (ou super admin). Quando o consultor logado tem um `auth.users.id` diferente do `consultants.id` (caso comum: consultor cadastrado por outro usuário), ela devolve `forbidden` e o painel só mostra essa string crua no toast — daí a impressão de "deu erro sem explicação".
- A UI também não revalida `existingVariants` se a criação falhar, então o usuário não entende o estado.

### 2. "Passos removidos" no fluxo da Bruna e diferente do público
Confirmado no banco. O fluxo da Bruna (`577f46d1…`, variante D) tem `fallback.success_goto_step_id` apontando para IDs que só existem no fluxo público (`320bf22c…`) — ex.: `b1e1a001-…`, `9f2d47d4-…`, `4df1f90a-…`. Isso aconteceu porque o clone antigo (e o atual) só remapeia `transitions[].goto_step_id` e `fallback.goto_step_id`, **não** remapeia `fallback.success_goto_step_id`, nem campos análogos dentro de `captures`. Resultado: o editor mostra "⚠ Passo removido" em vários passos.

Além disso, o fluxo da Bruna está com `sync_mode='public'`. Isso significa que o runtime (resolveFlowId) ignora os passos da Bruna e roda o público — então qualquer ajuste que ela fizer no editor **não tem efeito real**. O editor não deixa isso claro.

### 3. "Modo mouse desativado no suporte"
No operador o controle vem ligado por padrão (`controlEnabled=true`), mas o `RemoteControlOverlay` só monta quando `hasStream && controlEnabled && !paused`. No lado do consultor (`useRequesterSession`) o estado `paused` começa `false`, porém o overlay no operador esconde-se atrás da `PlayerToolbar` quando ela está aberta (z-index/pointer-events) e o cursor virtual some assim que o ponteiro sai do vídeo — dá a sensação de "não dá pra clicar". Também há um caso em que `controlEnabled` fica falso por causa de prefs antigos salvos em `localStorage` (`PREFS_KEY`).

---

## Plano de correção

### A. Variantes A–E livres e com erro legível
1. **Migration**: relaxar a checagem da RPC `ensure_bot_flow_variant` para aceitar qualquer um destes casos:
   - `auth.uid() = _consultant_id` (consultor editando o próprio).
   - `is_super_admin(auth.uid())`.
   - existe `consultants` com `id = _consultant_id` cujo `auth_user_id` (ou e-mail) bate com o caller.
   - Mensagens de erro passam a vir com prefixo legível (`'Sem permissão para criar variante neste consultor'`, etc.).
2. **UI** (`VariantDistributionBar.tsx`):
   - Capturar `error.message` e mostrar toast amigável ("Não foi possível criar o fluxo X: …").
   - Chamar `onChanged()` mesmo em erro para refrescar a lista.
   - Após criar, dar feedback claro (qual variante foi criada e de onde foi clonada — público ou outra variante).

### B. Clone fiel ao público + tela de "Passo removido" zerada
1. **Migration**: nova versão da `ensure_bot_flow_variant` que também remapeia:
   - `fallback.success_goto_step_id`
   - `fallback.failure_goto_step_id` (quando existir)
   - qualquer `goto_step_id` aninhado dentro de `captures` (varre o jsonb).
   - Preserva `position` (já preserva) e copia `text_delay_ms`, `persuasive_text`, `respect_business_hours`, `business_hour_*`, `wait_seconds`, `wait_for`, `media_order` — campos que hoje ficam de fora.
2. **Migration de "reparo" idempotente** para fluxos já existentes:
   - Para cada `bot_flow` não-público, varrer steps cujo `fallback.success_goto_step_id` aponta para um step de outro flow; tentar casar com um step da MESMA `position` ou MESMO `step_key` dentro do flow do consultor; se casar, atualiza; se não, limpa o campo (vira "repeat") em vez de manter referência quebrada. Isso elimina os "Passo removido" da Bruna sem perder semântica.
3. **Sincronizar Bruna com o público**:
   - Como ela está em `sync_mode='public'`, ofereço duas saídas (sem decidir por ela em runtime):
     - Botão "Re-clonar do público" na barra de variantes (visível quando `sync_mode='public'` ou quando há refs quebradas) que dispara a nova `ensure_bot_flow_variant` com `force=true`, recriando os steps a partir do público atual e marcando `sync_mode='custom'`.
     - Aviso no topo do editor explicando: "Esta variante está espelhando o fluxo público — edições aqui não afetam o atendimento até clicar em ‘Personalizar’."

### C. Suporte remoto — destravar o mouse
1. **Operador (`SuperAdminRemoteSupport.tsx` + `RemoteControlOverlay`)**:
   - Forçar `controlEnabled=true` na primeira sessão (ignorar `localStorage` antigo) e mostrar aviso "Controle ativo" por 3s no topo do vídeo.
   - Garantir `pointer-events: auto` no overlay e `z-index` acima da toolbar; toolbar passa a `pointer-events: none` exceto nos botões.
   - Manter cursor virtual visível mesmo sem movimento (não esconder em `pointerleave` — só some quando a aba perde foco).
   - Logar no console (`[remote-support]`) cada `mouseClick`/`mouseDown`/`mouseUp` enviado para facilitar diagnosticar próximos casos.
2. **Consultor (`actionHandler.ts`)**:
   - Quando `mouseClick` chega, fazer `element.focus()` antes do `pointerdown` para inputs/selects (faltava em alguns casos do Radix).
   - Habilitar `wheel` e `keydown` mesmo quando o foco está em iframe interno (usa `document.elementFromPoint` + fallback no `document.activeElement`).
   - Mostrar um overlay sutil "Controle remoto ativo" no canto inferior do consultor quando estiver recebendo eventos — confirmação visual de que o mouse está chegando.

---

## Arquivos que vou tocar

- `supabase/migrations/<new>_fix_variant_clone_and_perms.sql` (RPC v2 + reparo idempotente)
- `src/components/admin/flow-builder/VariantDistributionBar.tsx`
- `src/pages/FluxoBuilder.tsx` (aviso de sync_mode + botão "Personalizar/Re-clonar")
- `src/pages/SuperAdminRemoteSupport.tsx`
- `src/features/remote-support/actionHandler.ts`
- (talvez) `src/features/remote-support/useRequesterSession.ts` para o overlay de confirmação

Nada será removido — só correções. Posso começar?

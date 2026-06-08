## Auditoria do clique no suporte remoto

### Causa raiz principal — cliques não funcionam em componentes Radix/shadcn

No lado do operador, o overlay (`RemoteControlOverlay` em `src/pages/SuperAdminRemoteSupport.tsx:721`) já captura `pointer/click/wheel` e envia comandos `mouseClick / mouseMove / mouseDblClick` para o consultor pelo DataChannel.

No lado do consultor (`src/features/remote-support/actionHandler.ts:163-207`), os handlers `mouseClick / mouseDown / mouseUp / mouseMove` disparam **apenas `MouseEvent`** (`mousedown`, `mouseup`, `click`) e fazem fallback com `el.click()`.

**O problema:** quase toda a UI do app é **Radix UI (shadcn)**. Componentes como `Select`, `DropdownMenu`, `Dialog/Sheet`, `Popover`, `Slider`, `Tooltip`, `Switch` e os botões dentro deles escutam `pointerdown` / `pointerup` / `pointermove` — não `mousedown/click`. Como nenhum `PointerEvent` é dispatched, dropdowns, selects, menus, abas de fluxo, links em popovers etc. não abrem nem reagem aos cliques. É exatamente o sintoma "vejo os links na lateral mas não consigo clicar".

Além disso, `mouseClick` hoje dispara `click` sintético **e** `el.click()`, o que aciona o handler duas vezes — em toggles, abas e checkboxes isso abre-e-fecha imediatamente, dando a sensação de "não clica".

### Outros bugs que pioram a experiência

1. **Toolbar flutuante sobre o overlay (`PlayerToolbar`, linha 630)** — está em `z-20` enquanto o `RemoteControlOverlay` não tem z-index. Cliques no topo central do vídeo são consumidos pelos botões da toolbar do operador, não enviados ao consultor.
2. **Sem `pointerleave` → cursor "fantasma"** — ao sair do vídeo, o cursor virtual continua no último ponto e o consultor pode receber hovers presos.
3. **Sem coalescing de `mousedown/up` para drag** — atualmente só `mouseClick` é enviado; o usuário não consegue arrastar sliders, redimensionar painéis nem selecionar texto.
4. **`elementFromPoint` ignora o elemento que está sob o ponteiro virtual visível no consultor** — se o consultor estiver com um cursor de outro app por cima, o elemento real ainda é detectado, mas overlays próprios do projeto (banner de suporte) já são respeitados via `data-remote-support-banner`. OK.
5. **`focusable()` chama `focus()` antes do click** — em alguns inputs do Radix isso pode roubar foco antes do menu abrir. Vamos manter, mas só focar quando o alvo for de fato campo de input.

### Plano de correção

**A. `actionHandler.ts` — emitir PointerEvents + simplificar clique (resolve 95% do caso)**

1. Adicionar helper `dispatchPointer(type, el, x, y, button)` que dispara `PointerEvent` com `pointerType: 'mouse'`, `isPrimary: true`, `pointerId: 1`, `bubbles`, `cancelable`.
2. Em `mouseMove`: disparar `pointermove` + `mousemove`.
3. Em `mouseDown`: `pointerdown` → `mousedown`.
4. Em `mouseUp`: `pointerup` → `mouseup`.
5. Em `mouseClick`: sequência completa `pointerdown → mousedown → pointerup → mouseup → click`. **Remover o `el.click()` duplicado**; só faz fallback `el.click()` se `defaultPrevented` for `false` E o elemento não tiver capturado o `pointerup` (heurística: se for `<a>`/`<button>` nativo sem React handler).
6. Em `mouseDblClick`: dois `pointerdown/up` + `dblclick`.
7. Adicionar caso `pointerLeave` (opcional, para limpar hover) — disparado quando o operador sai do overlay.

**B. `SuperAdminRemoteSupport.tsx` — ajustes de overlay**

1. `RemoteControlOverlay`: adicionar `z-10` no container do overlay e mover toolbar para `z-30`, garantindo que cliques na área central do vídeo cheguem ao overlay (sem mudar a toolbar visual).
2. Adicionar `onPointerLeave` no overlay que envia `mouseMove` com x/y fora de tela (ou novo `pointerLeave`) e esconde o cursor virtual.
3. Adicionar `onPointerDown`/`onPointerUp` no overlay enviando `mouseDown`/`mouseUp` — habilita **drag** (sliders, seleção de texto, arrastar abas).
4. Manter `onClick` como hoje, mas só enviar `mouseClick` se não houve `mouseDown` recente no mesmo ponto (evita clique duplicado quando o navegador já gerou pointerdown→pointerup→click).

**C. `types.ts`** — sem mudança de schema; comandos existentes (`mouseDown/mouseUp/mouseMove/mouseClick/mouseDblClick`) já cobrem tudo. Opcional: adicionar `pointerLeave` se quisermos resetar hover; pode ficar para depois.

### Detalhes técnicos

- `PointerEvent` precisa de polyfill? Não — todos os browsers modernos têm `window.PointerEvent`. Adicionar guard: `if (typeof PointerEvent !== 'undefined') dispatch(new PointerEvent(...))`.
- Radix usa `onPointerDown` em `DropdownMenu.Trigger`, `Select.Trigger`, `Dialog.Trigger`, etc. Com `pointerdown` bubbling e `cancelable`, abrirão normalmente.
- `el.setPointerCapture(pointerId)` é chamado por Radix em sliders — funcionará pois o pointerId é constante (1) entre down/up.
- Manter `data-remote-support-banner` para continuar protegendo o ícone do consultor.

### Arquivos afetados

- `src/features/remote-support/actionHandler.ts` — adicionar pointer dispatch e reordenar `mouseClick`.
- `src/pages/SuperAdminRemoteSupport.tsx` — z-index do overlay/toolbar, handlers `onPointerDown/Up/Leave` no `RemoteControlOverlay`.

### Critério de aceite

- Abrir Select/Dropdown/Combobox da UI remota com um clique.
- Conseguir arrastar slider e selecionar texto.
- Toolbar do operador não bloqueia mais a região central do vídeo.
- Cursor virtual desaparece quando o operador tira o mouse do vídeo.

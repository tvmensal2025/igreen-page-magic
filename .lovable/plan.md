# Toast de atualização com hard-reset

## Problema

Hoje, quando há uma versão nova publicada:

- O app verifica `/version.json` a cada 60s e tenta recarregar **sozinho**, mas só quando o usuário não está digitando / sem modal aberto / sem áudio gerando.
- Se a janela do navegador fica com um modal aberto o dia inteiro, ou o usuário fica digitando sem parar, a atualização **nunca acontece** — e ele continua na versão antiga sem saber.
- O usuário não tem nenhum botão visível para forçar a atualização. As únicas saídas (`?nuke=1` ou `/reset`) são "URLs secretas" que o cliente final não conhece.

## Solução

Mostrar um **toast persistente** (sonner) no canto da tela assim que `checkVersionGate()` detectar `buildId` diferente. O toast tem:

- Texto: **"Nova versão disponível"** + descrição "Atualize para receber as últimas melhorias."
- Botão de ação: **"Atualizar agora"** → executa **hard-reset** (mesma rotina do `/reset` + `?nuke=1`):
  1. `caches.delete()` para todos os caches do navegador
  2. `serviceWorker.getRegistrations()` + `unregister()` em todos
  3. `localStorage.clear()` e `sessionStorage.clear()`
  4. `window.location.replace("/?fresh=" + Date.now())`
- Botão secundário: **"Depois"** → fecha o toast; ele volta a aparecer no próximo `focus`/`visibilitychange`.
- `duration: Infinity` (não some sozinho) e `dismissible: true`.

O **auto-reload silencioso** atual continua funcionando como fallback: se o usuário ignorar o toast e em algum momento ficar ocioso (sem digitar, sem modal), o app recarrega sozinho como já faz hoje. O toast só dá a opção **manual** para quem nunca atinge a janela segura.

## Arquivos a alterar

### 1. Novo: `src/lib/hardReset.ts`

Função única e reutilizável. Recebe `reason: string` para log. Faz:

```text
limpar caches → unregister SWs → limpar storages → reload("/?fresh=<ts>")
```

Exporta `hardReset(reason)`. A página `/reset` (`src/pages/ResetApp.tsx`) também passa a usar essa função, em vez de duplicar a lógica.

### 2. Novo: `src/components/UpdateAvailableToast.tsx`

Componente "headless" (sem JSX visível) que:

- Escuta um `CustomEvent("igreen:update-available", { detail: { buildId } })` no `window`.
- Quando dispara, chama `toast(...)` do sonner com `id: "update-available"` (evita duplicatas), `duration: Infinity`, e os dois botões.
- Botão "Atualizar agora" → `hardReset("user-clicked-update-toast")`.

Renderizado uma única vez em `src/App.tsx` (logo ao lado do `<Toaster />` global).

### 3. Editar: `src/main.tsx`

Em `checkVersionGate()`, quando detecta `buildId !== __BUILD_ID__`:

- Continua chamando `applyUpdateWhenSafe(...)` (auto-reload silencioso atual — não muda).
- **Adicionalmente**, dispara `window.dispatchEvent(new CustomEvent("igreen:update-available", { detail: { buildId } }))` para o toast aparecer imediatamente.

O auto-reload e o toast convivem: o que acontecer primeiro (usuário clicar OU app achar janela segura) aplica a atualização.

### 4. Editar: `src/pages/ResetApp.tsx`

Trocar a lógica inline de `handleReset` por uma chamada a `hardReset("manual-reset-page")`. Mantém a UI atual.

## Notas técnicas

- **Hard-reset apaga login Supabase** (`localStorage.clear()`). É o que o usuário pediu — garantia máxima. O usuário precisará logar de novo após clicar em "Atualizar agora". O texto do botão secundário (`"Depois"`) e a descrição do toast podem mencionar isso? Sugiro a descrição: *"Atualize para receber as últimas melhorias. Você precisará entrar novamente."*
- **Anti-spam**: `toast(..., { id: "update-available" })` garante que múltiplos `checkVersionGate()` consecutivos não empilham toasts.
- **Não muda nada de SW**: os kill-switches `/sw.js` e `/sw-app.js` continuam como estão.
- **Sem novas dependências**: sonner já está instalado, `<Toaster />` já está no root.

## Fora do escopo

- Botão fixo no menu do header (usuário escolheu "só toast").
- Mudanças no fluxo de auto-reload silencioso atual.
- Soft-reset (usuário escolheu hard-reset).

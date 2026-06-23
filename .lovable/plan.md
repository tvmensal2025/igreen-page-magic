# Configuração com auto-save e abertura só por clique

## O problema observado
No painel **Central de Conversão → aba "Configurar"** (`src/components/admin/conversao/ConfigPanel.tsx`) hoje o consultor precisa clicar em **"Salvar configuração"** depois de cada ajuste. Se ele esquece, o valor digitado é perdido na próxima visita. Além disso, a sensação de "ficar abrindo toda vez" vem desse fluxo: ao reabrir a aba, o painel re-monta, busca o que está no banco e descarta o que não foi salvo.

A aba em si **já só é montada quando o usuário clica em "Configurar"** no `ViewSwitcher` (rota `/admin → Conversão`, `activeView` default = `"fila"`, `ConfigPanel` mora dentro de `<TabsContent value="config">` em `ConversaoCockpit.tsx`). Não há rota nem efeito que force `activeView="config"`. Então o ajuste é todo dentro do `ConfigPanel`: **salvar sozinho** e **não recarregar/piscar** quando o consultor volta para a aba.

## O que muda (somente UX do ConfigPanel)

1. **Auto-save com debounce de 600 ms**
   - Cada alteração em qualquer campo (Switch de ligar/desligar, horas, máximo, intervalo, janela início/fim, fim de semana) dispara um `upsert` em `reactivation_settings` automaticamente.
   - Usa um `useRef` de timer; cancela e reagenda a cada digitação para não bater no banco a cada tecla.
   - Não dispara durante o carregamento inicial nem antes do primeiro `load()` completar (flag `hydrated`).

2. **Feedback discreto, sem toast por tecla**
   - Indicador inline ao lado do título: `Salvando…` / `Salvo às HH:MM` / `Erro ao salvar` (com botão "Tentar novamente").
   - Toast somente em erro; sucesso fica no indicador para não poluir.

3. **Botão "Salvar configuração" removido**
   - Como tudo é automático, o botão sai. Fica só o estado de salvamento visível.

4. **Não recarregar do banco a cada montagem desnecessária**
   - Mantém o `load()` na primeira montagem por `consultantId`, mas guarda um cache em `useRef` por `consultantId` para que, ao alternar entre abas do `ViewSwitcher`, o estado local não pisque com loader (a aba é desmontada/remontada pelo Radix Tabs — usamos cache em escopo do módulo, `Map<consultantId, Settings>`, para reidratar instantaneamente enquanto o `load()` confirma em background).

5. **Garantir que a aba só abre por clique (verificação)**
   - Conferir que nenhum `useEffect` em `ConversaoCockpit.tsx` muda `activeView` para `"config"` sem ação do usuário. Estado inicial fica `"fila"`; o único caminho para `"config"` é o clique no `ViewSwitcher` / `Tabs`.

## Detalhes técnicos

Arquivo único alterado:

- `src/components/admin/conversao/ConfigPanel.tsx`
  - Adicionar `useRef<NodeJS.Timeout | null>` para o debounce.
  - Adicionar `useRef<boolean>` `hydrated` para suprimir auto-save antes do primeiro load.
  - Adicionar estado `saveState: "idle" | "saving" | "saved" | "error"` e `lastSavedAt: Date | null`.
  - Mover a função `save` para receber o snapshot atual e ser chamada pelo efeito de debounce que observa `s`.
  - Cache de hidratação: `const CACHE = new Map<string, Settings>()` em escopo de módulo; ao montar, se houver entrada para `consultantId`, usar imediatamente e pular o spinner; sempre disparar `load()` em background para confirmar.
  - Substituir o `<Button>Salvar configuração</Button>` por `<SaveStatus state={saveState} lastSavedAt={lastSavedAt} onRetry={...} />`.

Nenhuma mudança em banco, RLS, edge functions, schemas ou outros componentes. Nenhum impacto no `worker-portal-2` (assunto anterior já encerrado).

## Como testar depois da implementação

1. Abrir `/admin → Central de Conversão → Configurar`.
2. Mudar "Esperar quantas horas paradas" de 24 para 48 e clicar em outra aba **sem clicar em salvar**. Voltar para "Configurar": deve aparecer 48.
3. Conferir indicador `Salvo às HH:MM` aparece ~600 ms depois da última tecla.
4. Trocar o consultor (se aplicável): cache reidrata sem spinner; valor real do banco confirma em seguida.
5. Recarregar a página: configuração persistida no Supabase.

## Problema

1. Ao tentar sair do "Modo público" (ou clicar em "Personalizar agora"), o RPC `fork_flow_from_public` quebra com `column reference "t" is ambiguous`.
2. Mesmo com o toggle **Sincronizado** ligado, o consultor enxerga um fluxo que parece desalinhado do super admin — não há uma ação explícita de "puxar o que o super admin tem agora" para o flow do consultor.

## Causa raiz

### Erro SQL
O `fork_flow_from_public` (migration `20260605141030_*`) declara uma variável `t jsonb;` no `DECLARE` e depois usa `FROM jsonb_array_elements(...) t` dentro de um subselect. O Postgres confunde a variável PL/pgSQL `t` com o alias da tabela `t`, gerando `column reference "t" is ambiguous`. Resultado: o RPC falha sempre que o consultor tenta personalizar ou re-sincronizar.

### Sensação de "diferente do super admin"
Hoje:
- Quando `sync_mode='public'`, a UI lê os steps direto do `bot_flow` público (correto).
- Mas o flow do próprio consultor (`bot_flow_steps` ligado ao `bot_flow` dele) fica com a versão antiga "congelada". Se o usuário olhar pelo diagrama, pelo runtime de algum cron antigo, ou se alternar modos, vê drift.
- Não existe um botão "puxar agora a versão do super admin para dentro do meu fluxo".

## Solução

### 1. Corrigir o RPC `fork_flow_from_public`
Migration que recria a função:
- Remove o `DECLARE t jsonb;`.
- No subselect que remapeia transitions, usa um alias diferente do alias externo (ex.: `FROM jsonb_array_elements(...) AS _tr`).
- Mantém o resto da lógica idêntica (remap de `goto_step_id`, `success_goto_step_id`, fallback, posições, `sync_mode='custom'` ao final na variante de "fork").

### 2. Novo RPC `sync_flow_from_public`
Idêntico ao `fork_flow_from_public`, mas no final faz:
```sql
UPDATE bot_flows SET sync_mode='public' WHERE id = v_target_flow;
```
Ou seja: copia toda a estrutura do super admin para dentro do flow do consultor **e mantém o modo público ligado**. Garante que UI, diagrama e qualquer leitura por `consultant_id` mostrem exatamente os mesmos passos do super admin, sem perder a sincronização automática futura.

### 3. UI no `FluxoBuilder.tsx`
No bloco do toggle "Seguir modelo público" (linhas ~806-844), adicionar um botão secundário **"Sincronizar agora com o super admin"** (visível apenas quando `!isSuperAdmin && flowId`). Ao clicar:
- `confirm()` com aviso: "Vamos copiar a versão atual do super admin para o seu fluxo. Suas edições locais nos passos serão substituídas. As mídias que você subiu continuam funcionando."
- Chama `supabase.rpc("sync_flow_from_public", { _consultant_id: userId, _variant: editingVariant })`.
- Em sucesso: `toast.success("Fluxo sincronizado com o super admin")` e `reload()`.

### 4. Validação
Após aplicar a migration:
- Conferir no SQL Editor que `SELECT proname FROM pg_proc WHERE proname IN ('fork_flow_from_public','sync_flow_from_public')` retorna as duas.
- Clicar em "Personalizar agora" no toast — não deve mais dar erro.
- Clicar em "Sincronizar agora com o super admin" — os 16 passos do consultor devem ficar idênticos (mesmo `step_key`, `position`, `title`, `message_text`) aos do flow público `320bf22c-…`.

## Arquivos tocados

- `supabase/migrations/<novo>.sql` — recria `fork_flow_from_public` (sem ambiguidade do `t`) e cria `sync_flow_from_public`.
- `src/pages/FluxoBuilder.tsx` — botão "Sincronizar agora com o super admin" e handler que chama o novo RPC.

## Fora do escopo

- Não mexer no runtime do webhook (resolver já está correto, lendo do flow público).
- Não mexer em mídias (continuam por `consultant_id`).

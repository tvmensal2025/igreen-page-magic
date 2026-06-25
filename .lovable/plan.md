Plano para corrigir 100% a ambiguidade do Fluxo D sem remover nenhum passo:

1. Corrigir a causa real nos dados do Fluxo D
- Atualizar as transições do Fluxo D ativo para manter todos os caminhos, mas separar os gatilhos por contexto.
- Remover dos avisos/rotas as palavras genéricas que se repetem em vários passos sem serem erro real, como “cadastrar”, “humano”, “dúvida”, “primeiro”, “segunda”, quando elas aparecem em passos diferentes e não competem no mesmo momento.
- Preservar todos os passos existentes, inclusive:
  - `d_como_funciona`
  - `d_como_funciona_copy_in3s`
  - `d_como_funciona_copy_qwpu`
  - `d_pedir_conta`
  - `d_simular_pedir_conta`
- Corrigir também os clones antigos/inativos do Fluxo D, para que nenhum fluxo reativado volte com o mesmo problema.

2. Tornar o detector de conflito inteligente, não alarmista
- Alterar `useFlowConflicts.ts` para diferenciar:
  - conflito real: mesma frase dentro do mesmo passo apontando para destinos diferentes;
  - risco real: identificadores/títulos muito parecidos;
  - repetição aceitável: mesma palavra em passos diferentes, quando cada passo está em um momento diferente da conversa.
- O banner não deve mais acusar “8 passos” por palavras globais repetidas se isso não pode fazer o runtime pegar rota errada naquele passo.
- Quando houver conflito real, mostrar exatamente:
  - qual passo tem o problema;
  - qual palavra/frase está duplicada;
  - para quais destinos ela aponta.

3. Blindar o runtime contra erro mesmo com dado ruim
- Reforçar `matchTransition` para priorizar, nesta ordem:
  1. botão nativo/id exato;
  2. número da opção visível no passo atual;
  3. frase completa mais específica;
  4. destino explícito do passo atual;
  5. fallback seguro.
- Se duas frases empatam de verdade no mesmo passo com destinos diferentes, o bot deve registrar conflito e cair no caminho seguro configurado, em vez de escolher uma rota errada silenciosamente.

4. Super admin deve conseguir selecionar e editar todos os passos
- Detectar `is_super_admin` no `FluxoBuilder`.
- Para super admin, permitir edição direta do fluxo público/modelo sem exigir “Personalizar”.
- Garantir que filtros como “Revisar”, busca ou tipo não façam parecer que passos foram removidos: adicionar ação clara para limpar filtros e sempre manter o contador “visível/total”.
- Ao clicar em qualquer card, saída ou conflito, abrir o passo correto pelo `id`, nunca por nome, título ou palavra-chave.

5. Validar com testes e auditoria de dados
- Adicionar testes cobrindo:
  - “como funciona” vs “como funciona 2”;
  - “pedir conta 1” vs “pedir conta 2”;
  - “primeira/primeiro” e “segunda/segundo” dentro do passo de escolha;
  - repetição da palavra “cadastrar” em passos diferentes sem falso conflito;
  - empate real no mesmo passo caindo em fallback seguro.
- Rodar consulta final no Supabase para confirmar:
  - zero conflito real dentro do mesmo passo;
  - zero destino quebrado/inativo;
  - todos os passos do Fluxo D continuam existentes e selecionáveis.

Arquivos/tabelas envolvidos:
- `src/components/admin/flow-builder/useFlowConflicts.ts`
- `src/pages/FluxoBuilder.tsx`
- `src/components/admin/flow-builder/StepTimelineItem.tsx`
- `supabase/functions/_shared/flow-router.ts`
- testes do flow router/conflitos
- dados existentes em `bot_flow_steps.transitions` dos Fluxos D
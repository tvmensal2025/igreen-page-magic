## Diagnóstico

Há dois problemas separados:

1. **Controle remoto marcando/clicando errado**
   - O vídeo compartilhado pode estar vindo como tela inteira/janela/aba, mas o comando remoto hoje converte `x/y` direto para `window.innerWidth/window.innerHeight` do consultor.
   - Quando o consultor compartilha a tela inteira ou uma janela com barra do navegador, a coordenada do vídeo não bate com a coordenada real da página. Por isso aparece que marcou um ponto, mas o clique cai em outro ou não navega.
   - O clique também ainda depende de eventos sintéticos genéricos; alguns botões/links/inputs precisam do alvo interativo correto e de sequência mais fiel de `pointer/mouse/focus/key`.

2. **Variantes de fluxo travadas por ordem**
   - O botão atual “Adicionar fluxo” escolhe automaticamente a primeira variante faltante. O consultor não consegue escolher livremente A, B, C, D ou E.
   - A regra de roteamento precisa considerar apenas variantes que estão ativas **e** têm fluxo existente, para não mandar lead para variante sem fluxo configurado.

## Plano de implementação

### 1. Corrigir mapeamento do mouse no suporte remoto

- Guardar, no lado do consultor, metadados reais do compartilhamento:
  - tipo de captura (`browser`, `window`, `monitor`, quando disponível);
  - tamanho do track de vídeo;
  - `window.innerWidth/innerHeight`, `outerWidth/outerHeight`, `screenX/screenY`, `screen.width/height`, `devicePixelRatio`.
- Alterar `toViewportXY` para converter a coordenada conforme o tipo de captura:
  - **aba atual/browser tab:** mapear direto para o viewport da página;
  - **janela/tela inteira:** descontar offset da janela/viewport antes de clicar;
  - se não houver metadados confiáveis, cair no modo atual como fallback.
- Ajustar `getDisplayMedia` para preferir “esta guia/aba atual” quando o navegador suportar, reduzindo erro de coordenada.
- Mostrar aviso no banner se o usuário estiver compartilhando tela inteira/janela em vez da aba, porque esse modo é menos preciso.

### 2. Tornar o clique/navegação remoto mais fiel

- Normalizar o alvo antes de disparar eventos:
  - se clicar em `svg`, `span` ou ícone dentro de botão/link, subir para o botão/link/input/select/elemento com `role` interativo.
- Corrigir sequência de eventos:
  - `pointermove` enquanto move;
  - `pointerdown` imediato no apertar;
  - `pointerup` no soltar;
  - `click` apenas uma vez quando não for drag.
- Evitar clique duplicado depois de arrastar.
- Adicionar logs curtos de diagnóstico para comandos que falham (`no element`, coordenada fora do viewport, alvo protegido), para a próxima auditoria ter sinal real.

### 3. Melhorar drag/seleção/scroll remoto

- Enviar `mouseDown` no `pointerdown` real, não só depois que ultrapassar limite de drag.
- No `pointermove` com botão pressionado, manter `buttons=1` no lado do consultor.
- No `pointerleave`, finalizar `mouseUp` no último ponto válido.
- Manter wheel/scroll com fallback programático para containers roláveis.

### 4. Liberar criação independente das variantes A–E

- Trocar “Adicionar fluxo” por um menu/dialog com botões explícitos:
  - Criar A
  - Criar B
  - Criar C
  - Criar D
  - Criar E
- Variantes já criadas aparecem como indisponíveis para criação, mas continuam selecionáveis/editáveis.
- O consultor poderá criar qualquer letra em qualquer ordem, sem depender da próxima livre.

### 5. Criar RPC segura para garantir fluxo por variante

Criar uma migração com uma função tipo `ensure_bot_flow_variant(_consultant_id, _variant, _source_variant)`:

- Valida que a variante é A–E.
- Garante permissão: próprio consultor ou super admin.
- Se o fluxo da variante já existir, retorna o fluxo existente.
- Se não existir:
  - cria `bot_flows` para a variante escolhida;
  - clona passos de uma fonte funcional, nesta ordem:
    1. template público da mesma variante, se existir;
    2. variante fonte escolhida/atual do consultor;
    3. primeira variante existente do consultor;
    4. fluxo vazio apenas se realmente não houver fonte.
- Não coloca a variante automaticamente para receber leads sem o switch estar ativo em `consultants.active_variants`.

### 6. Garantir que o sistema obedece 100% as regras de variantes

- Atualizar `assign_flow_variant` e o trigger de inserção de clientes para usar:

```text
variantes_disponíveis = consultants.active_variants ∩ bot_flows existentes/ativos
```

- Se só uma variante disponível: todos os leads novos vão para ela.
- Se houver várias: round-robin 1 a 1 somente entre as disponíveis.
- Se `active_variants` apontar para uma letra sem fluxo, ela será ignorada em vez de quebrar o atendimento.
- O lead já existente mantém sua variante; só lead novo entra na nova regra.

### 7. Ajustar a UI do editor de fluxo

- Depois de criar uma variante específica, selecionar automaticamente essa variante.
- Atualizar a barra para deixar claro:
  - “criado/editável”;
  - “recebendo leads” via switch;
  - “pausado” continua editável, mas não recebe leads.
- Melhorar as mensagens de erro para mostrar o motivo real em vez de erro genérico.

### 8. Validação

- Testar controle remoto com:
  - compartilhar aba atual;
  - clicar em botão/link;
  - abrir dropdown/select;
  - digitar em input;
  - rolar página;
  - arrastar/selecionar.
- Testar variantes:
  - criar C antes de B;
  - criar A/B/C/D/E em qualquer ordem;
  - ativar/desativar switches;
  - confirmar que novos leads só entram nas variantes ativas com fluxo existente.

## Arquivos principais previstos

- `src/features/remote-support/screenShare.ts`
- `src/features/remote-support/actionHandler.ts`
- `src/features/remote-support/types.ts`
- `src/pages/SuperAdminRemoteSupport.tsx`
- `src/features/remote-support/ActiveSessionBanner.tsx`
- `src/components/admin/flow-builder/VariantDistributionBar.tsx`
- `src/pages/FluxoBuilder.tsx`
- nova migração Supabase para RPC/regras de distribuição
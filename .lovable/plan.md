# Integrar Fluxo B no editor unificado e remover Teste A/B

## O que muda

### 1. Remover bloco "Teste A/B — qual fluxo o lead recebe"
- `src/pages/FluxoBuilder.tsx`: remover o `<FlowAbControl />` (linhas 634–637) e o import correspondente.
- Deletar `src/components/admin/flow-builder/FlowAbControl.tsx` (não usado em outro lugar).
- Motivo: `VariantDistributionBar` já faz round-robin 1-a-1 automático entre todas as variantes com switch ligado. Bloco abaixo virou redundante e confuso.

### 2. Trazer o editor do Fluxo B pra dentro do /admin/fluxos
Quando o usuário clicar na variante **B** na barra de Distribuição, em vez de mostrar a lista de passos determinísticos, o builder mostra o **painel da IA Livre** (o que hoje está em `/admin/fluxo-b`):

- Super Prompt (textarea grande)
- Slider de temperature
- Toggle de cascata GPT-5.5
- Botão Salvar
- Painel "Testar (lead simulado)" usando `fluxo-b-ai` em `dryRun`

Implementação:
- Extrair o conteúdo de `AdminFluxoB.tsx` em um componente reutilizável `FluxoBEditor.tsx` que recebe `consultantId` como prop (sem o header/seletor de consultor, sem o link "Admin").
- Em `FluxoBuilder.tsx`, quando `editingVariant === "B"`, renderizar `<FluxoBEditor consultantId={userId} />` no lugar da grid Lista/Diagrama/Planilha (header com tabs de view fica oculto pra B já que não fazem sentido).
- `/admin/fluxo-b` continua funcionando como atalho dedicado (mantém o componente `AdminFluxoB` como wrapper com seletor de consultor + `FluxoBEditor`). Pode redirecionar pro `/admin/fluxos?variant=B` num passo futuro, mas mantém por ora.

### 3. UX da barra de Distribuição
- Atualizar o label/tooltip pra deixar explícito: "Round-robin automático: cada lead novo entra em uma variante ativa diferente, em sequência."
- Badge atual `"N ativa(s) · round-robin 1 a 1"` já comunica isso — manter.

## Fora de escopo
- Mudanças no `bot-flow.ts` dos webhooks (já roteia pra `runFluxoBAI` quando `flow_variant === "B"`).
- Migration de banco (colunas já existem).
- Renomear/remover `/admin/fluxo-b` (mantém como atalho).

## Arquivos tocados
- `src/pages/FluxoBuilder.tsx` (remover import + bloco A/B, render condicional pra variante B)
- `src/pages/AdminFluxoB.tsx` (refatorar pra usar `FluxoBEditor`)
- `src/components/admin/flow-builder/FluxoBEditor.tsx` (novo — conteúdo extraído)
- `src/components/admin/flow-builder/FlowAbControl.tsx` (deletar)

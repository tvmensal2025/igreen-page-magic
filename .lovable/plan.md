
# Manter modo desktop no celular (fim do "Mais" cortando)

## O problema

Hoje o `AppSidebar` tem 2 layouts:
- **Desktop** (`lg:`): mostra os 3 grupos completos (Visão Geral, Gestão Comercial, Recursos) com todos os itens.
- **Mobile** (< 1024px): mostra só 5 itens fixos + botão "Mais" que agrupa o resto (Conversão, Base de clientes, Financeiro, Captação, Parceiros, Rede, Agendamentos, Central de anúncios, Links, Materiais, Estúdio de áudio, Academy).

Você quer o desktop **sempre**, mesmo no celular, sem esconder nada atrás de "Mais".

## O que vou mudar

### 1. `src/components/layout/AppSidebar.tsx`
- Remover o bloco mobile condensado (linhas 249–297).
- Remover o `hidden lg:block` do wrapper dos grupos (linha 300) → grupos completos aparecem em qualquer tamanho de tela.
- Apagar as constantes `MOBILE_PRIMARY_IDS`, `MOBILE_PRIMARY_ITEMS`, `MOBILE_MORE_ITEMS`, o estado `mobileMoreOpen` e o `useEffect` relacionado.
- Manter o backdrop mobile + botão de fechar (drawer continua deslizando de fora quando aberto por hambúrguer no topbar) — isso não muda, só a **estrutura interna** vira igual ao desktop.
- Manter comportamento colapsado (72px só ícones) inalterado.

Resultado: no celular, ao abrir o menu, o usuário vê exatamente os mesmos 3 grupos + Conta que vê no desktop, com scroll natural (o `nav` já tem `overflow-y-auto`).

### 2. O que fazer com o mobile em si

Como você pediu para o app rodar sempre "modo computador" no celular, algumas telas ficam apertadas (tabelas de CRM, wizard de anúncios, kanban). Sugestões que **não** cabem neste ajuste (posso fazer em pedido separado se quiser):

1. **Zoom horizontal permitido**: hoje o viewport trava em `width=device-width, initial-scale=1`. Se quiser sensação de "desktop no celular" total, podemos setar `initial-scale=0.6, minimum-scale=0.3, maximum-scale=3` — o Chrome renderiza como se fosse tela grande e o usuário faz pinch pra aproximar. É o que apps tipo painel administrativo antigo fazem.
2. **Deixar o container do conteúdo com largura mínima** (ex.: `min-w-[1024px]`) e rolar horizontalmente — o app fica navegável com scroll lateral, sem quebrar layout.
3. **Manter só a sidebar como drawer** (do jeito que está), mas ampliar o conteúdo pra 1024px+ com scroll.

Recomendo combinar (2) + manter o viewport atual: sidebar completa quando aberta, conteúdo com `min-w-[1024px]` no `<main>`, `overflow-x-auto` no wrapper. Assim o celular vira um "computador em miniatura" sem esconder recurso nenhum.

## Arquivos afetados

- `src/components/layout/AppSidebar.tsx` (remover bloco mobile condensado).
- Opcional, se você aprovar a parte (2): `src/pages/Index.tsx` (ou o layout raiz do admin) — adicionar `min-w-[1024px]` no container do conteúdo + `overflow-x-auto` no wrapper externo.

## O que NÃO muda

- Nenhuma lógica de negócio, rotas, permissões ou tabs.
- O drawer mobile continua abrindo/fechando pelo mesmo botão no topbar.
- O modo colapsado (72px) do desktop continua funcionando igual.

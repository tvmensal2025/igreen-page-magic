## Objetivo
Reduzir a poluição visual na aba **Clientes** (`CustomerManager.tsx`) consolidando o tipo de produto, status, licenciado, distribuidora e cidade numa única linha de dropdowns compactos, com a busca acima e "Novo cliente" como única ação primária à direita.

## Estado atual (problema)
- Linha 1: título + contagem + "Novo cliente" + menu de 3 pontos
- Linha 2: busca
- Linha 3: combobox Tipo de produto (largo, sozinho)
- Linha 4: 3 selects (Licenciado / Distribuidora / Cidade)
- Linha 5: combobox Status (sozinho)

São **5 linhas** de controles. Polui e cansa.

## Estado proposto
- Linha 1 (header): ícone + "Clientes (571)" + última sync + à direita só **Novo cliente** e o menu `⋮` (sincronizar/import/export ficam dentro).
- Linha 2 (busca): input full-width, igual hoje.
- Linha 3 (barra única de filtros): grid responsivo com 5 dropdowns compactos lado a lado:
  - Tipo de produto
  - Status (com contagem ao lado do label)
  - Licenciado
  - Distribuidora
  - Cidade/UF
  
  Em desktop (≥sm): `grid-cols-5`, todos com `h-9`, mesmo estilo (`rounded-xl bg-secondary/30 border-border/50 text-xs`), ícone à esquerda no trigger.
  Em mobile: `grid-cols-2` (e o último ocupa linha inteira) ou `grid-cols-1` para evitar truncamento severo. Vou usar `grid-cols-2 sm:grid-cols-3 lg:grid-cols-5`.
- Botão "Limpar filtros" aparece como link discreto à direita da barra **apenas quando algum filtro está ativo** (≠ "all" ou busca preenchida).

## Mudanças no código
Arquivo único: `src/components/whatsapp/CustomerManager.tsx`

1. Mover o `Combobox` de Tipo de produto e o `Combobox` de Status para dentro da mesma grid dos 3 Selects existentes (linhas ~291-381), formando uma só seção "Search & Filters" com 2 linhas (busca + grid de 5).
2. Padronizar todos para `Select` ou todos para `Combobox`? Manter `Combobox` para Tipo e Status (têm busca útil) e `Select` para Licenciado/Distribuidora/Cidade. Padronizar altura `h-9`, raio `rounded-xl`, fundo `bg-secondary/30`.
3. Status: incluir contagem inline no label (`Aprovados · 42`).
4. Adicionar botão "Limpar filtros" (variant `ghost` size `sm`) condicional.
5. Remover a div separada de status (linhas 365-381) — vira coluna na grid.

## Fora de escopo
- Outras abas do admin (Parceiros, Consultores, etc.) — usuário confirmou só Clientes agora.
- Mudanças em lógica de filtro, hooks ou dados.
- Mudanças no header de ações (Novo cliente + menu) — já está bom.

## Verificação
- `tsc --noEmit` via build automático.
- Screenshot do `/admin` aba Clientes em desktop e mobile (`browser--screenshot`) para confirmar que tudo cabe sem quebrar.

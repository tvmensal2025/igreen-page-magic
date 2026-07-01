# Plano — Limpeza e redesign da Carteira iGreen

## 1. Remover o CRM Pós-Venda duplicado desta página

Hoje o bloco `PosVendaKanban` aparece em dois lugares:

- `src/pages/Admin.tsx` (linha 414) — local **oficial** do CRM Pós-Venda.
- `src/pages/WhatsAppClientsPage.tsx` (linhas 346-362) — **duplicado**, foi o que "trocou de página".

**Ação:** apagar o bloco `{/* CRM Pós-Venda (Clientes iGreen) */} … <PosVendaKanban … />` de `WhatsAppClientsPage.tsx` e remover o `import PosVendaKanban` não usado. Nada muda no Admin/CRM oficial.

Adicionar, no lugar, um botão discreto **"Abrir CRM Pós-Venda"** no cabeçalho da aba Clientes iGreen que leva ao Admin/CRM — evita a sensação de "sumiu".

## 2. Corrigir busca em Telecom e Seguros

Sintoma: ao digitar na busca, os itens somem visualmente ou os contadores continuam mostrando o total, dando impressão de que o filtro "não funcionou".

Correções em `TelecomClientesList.tsx` e `SegurosClientesList.tsx`:

- Contador do cabeçalho passa a mostrar **`filtered.length` de `data.length`** (ex: "12 de 159").
- MRR recalculado sobre `filtered` quando há busca ativa.
- Empty-state quando `filtered.length === 0 && q` → mensagem "Nenhum resultado para «termo»".
- Busca ampliada: normalizar acentos (`.normalize("NFD").replace(/\p{Diacritic}/gu, "")`) e incluir campos que faltam (Telecom: `status_label`, `fatura_status`; Seguros: `status_label`, `uf`).
- Debounce leve (150 ms) para evitar flicker em listas grandes.

## 3. Unificar visual — mesma paleta emerald, tudo em uma tela

Hoje a `CarteiraGreenPanel` mistura `bg-card` neutro com o wrapper emerald da página, e cada sub-card tem borda/estilo próprio. Padronizar todos os sub-blocos com o mesmo token emerald usado no wrapper da Carteira iGreen:

- Tokens locais (em `CarteiraGreenPanel`): `border-emerald-500/20`, `bg-gradient-to-br from-emerald-500/[0.03] to-background`, header com faixa `bg-emerald-500/5`.
- Aplicar em: `StatusCards`, `BoletosList`, `DevolutivasList`, `TelecomClientesList`, `SegurosClientesList`, `ConsultantMetricsCard`, `RedeDashboardCard`, `RotinasPanel`, `EndpointDiscoveryCard`, `PaymentIntent`.
- Cabeçalho de cada sub-card ganha: ícone circular emerald (`bg-emerald-500/10 text-emerald-600`), título em `font-heading`, contagem em badge outline emerald.
- Reagrupar layout em 3 faixas claras dentro do painel único (sem trocar de tela):
  1. **Resumo** — `ConsultantMetricsCard` + `StatusCards` + `PaymentIntent`.
  2. **Financeiro** — `BoletosList` (col-span-3) + `DevolutivasList` (col-span-2).
  3. **Produtos & Rede** — grid 2 col: `TelecomClientesList` | `SegurosClientesList`; abaixo `RedeDashboardCard` e `RotinasPanel` lado a lado; `EndpointDiscoveryCard` como accordion recolhido no final.
- Separadores discretos entre faixas (`<hr class="border-emerald-500/10" />`) com rótulo pequeno da seção.

## Detalhes técnicos

- Arquivos alterados:
  - `src/pages/WhatsAppClientsPage.tsx` — remove bloco PosVenda + import, adiciona botão "Abrir CRM Pós-Venda" apontando para `/admin?tab=posvenda` (ou rota atual do CRM em `Admin.tsx`).
  - `src/features/produtos/carteira-green/CarteiraGreenPanel.tsx` — reorganiza faixas, aplica tokens emerald e separadores.
  - `src/features/produtos/carteira-green/TelecomClientesList.tsx` e `SegurosClientesList.tsx` — busca normalizada, contador `filtered/data`, MRR sobre filtrados, empty-state.
  - Sub-cards restantes — trocar `border-border/60 bg-card` por tokens emerald definidos acima.
- Sem mudança de rotas, dados ou queries. Nenhum hook ou serviço tocado.
- Sem novas dependências.

## Fora de escopo

- Não mexer no `PosVendaKanban` do Admin.
- Não alterar schema, edge functions ou lógica de sincronização.
- Não redesenhar outras abas da página (`igreen_leads`), apenas Clientes iGreen.

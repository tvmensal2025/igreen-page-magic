# Auditoria + Separação do CRM em 2 (Leads / Clientes)

## Parte 1 — Auditoria do que foi entregue

Verifiquei o que está aplicado da rodada anterior (v1.3.0):

| Item | Status | Onde |
|---|---|---|
| Coluna "Em Espera" no Pos-Venda | OK | `PosVendaKanban.tsx`, migration `20260608031130_*` |
| Popup de aprovação de novos | OK | `PendingApprovalDialog.tsx` |
| `customer_origin` padronizado p/ `igreen_sync` | OK | edge `igreen-ingest-xlsx` |
| Colunas `pos_venda_pending_stage`, `pending_snoozed_until` | OK | migration aplicada |
| Backfill de ~890 clientes em `espera` | OK | migration |
| `recompute_pos_venda_stages` respeita `espera` | OK | migration |
| RPC `confirm_pending_classification` | OK | migration |
| Extensão v1.3.0 + ZIP | OK | `extension/igreen-sync/`, `public/*.zip` |
| `errors_detail` na sync | OK | edge function retorna lista |
| Hard lock origin (trigger `enforce_origin_immutability`) | PENDENTE | não criado ainda |
| Compartilhamento de classificação (`customer_classifier_grants`) | PENDENTE | não criado ainda |

Os 2 pendentes ficam para depois — não bloqueiam esta etapa.

## Parte 2 — Separar CRM em 2 menus distintos

Hoje a sidebar tem **CRM** (kanban de leads WhatsApp) + **Clientes** (página com abas internas "Leads/Clientes iGreen"). A aba interna confunde. Vamos virar 2 entradas separadas e bonitas na sidebar:

```text
Visão Geral
  Dashboard
  CRM Leads        ← novo nome (era "CRM") — funil até finalizar cadastro
  CRM Clientes     ← novo — Pós-Venda: Em Espera / Aprovado / Reprovado / 30/60/90/120d
  Conversão
  Clientes         ← lista/tabela tradicional (mantém)
```

### O que muda

1. **Sidebar** (`AppSidebar.tsx`):
   - Renomear `crm` → label "CRM Leads", ícone `Users` (calor de leads)
   - Adicionar novo item `crm-clientes`, label "CRM Clientes", ícone `UserCheck`
   - Manter `clientes` (lista) com ícone diferente (`Database`)
   - Paleta nova (Parte 3)

2. **Roteamento** (`Admin.tsx`):
   - Novo `activeTab === "crm-clientes"` renderiza só o `<PosVendaKanban consultantId={...} />` em tela cheia (sem as abas internas atuais)
   - `activeTab === "crm"` continua com `<CrmTabs />` (leads WhatsApp)
   - A página atual `WhatsAppClientsPage` perde as abas internas Leads/Clientes iGreen — passa a ser só a lista de clientes (modo tabela) na rota `clientes`. As funções "Bulk send/filtros" continuam, mas o seletor de origem some (cada CRM já é dedicado).
   - `TAB_META` ganha entrada `"crm-clientes": { title: "CRM Clientes", subtitle: "Pós-venda iGreen — espera, aprovados, reprovados e progressão 30/60/90/120 dias" }`

3. **Ícone pequeno "ver cliente"** no card do Pos-Venda (`KanbanDealCard.tsx` equivalente dentro do `PosVendaKanban`):
   - Botão `Info` (lucide `Eye`, 14px) no canto superior direito do card
   - Abre `CustomerEditDialog` (já existe) em modo leitura com os campos principais: nome, telefone, código iGreen, kW, distribuidora, status, andamento, devolutiva, data de cadastro, link assinatura
   - O mesmo botão entra também no card do CRM Leads (`KanbanDealCard.tsx`)

## Parte 3 — Melhorar cores

Hoje as colunas Pós-Venda usam tons fracos (`bg-slate-500/20`, etc) que somem no dark. Nova paleta semântica por estágio:

| Stage | Cor antiga | Nova (HSL semântico) |
|---|---|---|
| Finalizando | slate | `--stage-pending` âmbar suave |
| Em Espera | slate | `--stage-waiting` azul-aço com borda destacada |
| Aprovado | green vago | `--stage-approved` esmeralda 145 70% 42% |
| Reprovado | red vago | `--stage-rejected` rose 350 75% 55% |
| 30d / 60d / 90d / 120d | cinza | gradiente lime → verde-escuro indicando avanço da progressão |

Implementação:
- Adicionar tokens em `src/index.css` (`:root` e `.dark`) — todos HSL
- Adicionar no `tailwind.config.ts` em `theme.extend.colors.stage.*`
- Refatorar `PosVendaKanban.tsx` e `kanban_stages.color` (atualizar via UPDATE no banco)
- Cabeçalho de cada coluna ganha barra superior 3px na cor do stage + contador grande
- Cards: borda esquerda 3px cor do stage, fundo `bg-card`, sombra suave `shadow-md`

## Detalhes técnicos

Arquivos a editar:
- `src/components/layout/AppSidebar.tsx` — adicionar `crm-clientes` em `AdminTabId` e `NAV_GROUPS`
- `src/pages/Admin.tsx` — handler do novo tab, `TAB_META`, render do `PosVendaKanban` standalone
- `src/pages/WhatsAppClientsPage.tsx` — remover abas internas, virar apenas lista de clientes
- `src/components/whatsapp/PosVendaKanban.tsx` — botão "ver cliente" + novas cores
- `src/components/whatsapp/KanbanDealCard.tsx` — botão "ver cliente"
- `src/components/whatsapp/CustomerEditDialog.tsx` — adicionar prop `readOnly` se ainda não tiver
- `src/index.css` + `tailwind.config.ts` — tokens `--stage-*`

Migração de dados (sem schema change):
- `UPDATE kanban_stages SET color='...' WHERE stage_key IN (...)` para cada consultor, mapeando para as classes Tailwind novas (`bg-stage-approved/15 text-stage-approved border-stage-approved/30` etc).

Sem mudanças em RLS, edge functions ou crons nesta etapa.

## Validação após implementar

1. Sidebar mostra "CRM Leads" e "CRM Clientes" como itens separados, com ícones distintos
2. Click em "CRM Clientes" abre direto o Pos-Venda em tela cheia (Em Espera → 120d)
3. Click em "CRM Leads" abre o kanban de leads WhatsApp (sem mistura de iGreen)
4. Cada card tem o ícone 👁 que abre dialog com dados do cliente
5. Cores das colunas têm contraste correto no dark
6. Popup de pendências (`PendingApprovalDialog`) continua disparando ao abrir "CRM Clientes"

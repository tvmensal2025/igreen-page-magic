
## Contexto

A aba **Financeiro** já existe no `/admin` com KPIs (vence hoje / vencidos / 7d / pagos mês) + tabela de boletos com filtros e ação "Cobrar" no WhatsApp. Mas ainda existem informações financeiras espalhadas em outras telas, algumas duplicadas, e faltam recursos que o admin espera de um "centro financeiro" de verdade. Este plano organiza **o que entra** na aba Financeiro e **o que sai / redireciona** das demais páginas.

## 1. O que entra na aba Financeiro

### 1.1 Sub-abas dentro de Financeiro
Hoje é uma tela única. Passa a ter navegação interna:

```
Financeiro
 ├─ Boletos          (o que já existe)
 ├─ Recebíveis       (previsão: entrada + recorrente por mês)
 ├─ Carteira Green   (adimplência + métricas iGreen do consultor)
 └─ Extrato          (wallet_transactions + topups)
```

Cada sub-aba lazy-load; a URL guarda `?tab=financeiro&sub=boletos|recebiveis|carteira|extrato`.

### 1.2 Boletos (melhorias na tela atual)
- **KPI extra**: "Ticket médio" e "Inadimplência %" (vencidos / total emitido no mês).
- **Filtro por mês de referência** (select com últimos 6 meses) — já era mencionado no plano original mas não foi implementado.
- **Exportar CSV** dos boletos filtrados (cliente, consultor, vencimento, valor, status, link).
- **Ação em lote "Cobrar selecionados"**: checkboxes + botão que dispara mensagem WhatsApp para todos os selecionados usando o template já configurado no `reactivation_templates`/`message_templates`.
- **Régua automática opcional** (toggle): cria job diário que envia lembrete 3 dias antes / no dia / 3 dias depois do vencimento. Só liga se o admin ativar — reaproveita `scheduled_messages`. (Sem migration nova: já existe.)
- **Coluna "Última cobrança"**: lê do `customer_auto_message_log` filtrando `kind='boleto_lembrete'`.

### 1.3 Recebíveis (nova sub-aba)
Migra o bloco **"Ganhos Conexão Green"** que hoje vive em `AcompanhamentoPanel.tsx` (Produtos → Acompanhamento, linhas 292–360) — Entrada agora, Entrada a receber, Recorrente CRM/mês, Bônus carreira. Faz sentido no Financeiro; em Acompanhamento sobra só operação de venda.
- Mantém `useGreenGains` hook, só muda o local de render.
- Adiciona **projeção 12 meses** (linha simples: recorrente × 12 + entradas previstas).

### 1.4 Carteira Green (nova sub-aba)
Reúso do `CarteiraGreenPanel` já pronto (`src/features/produtos/carteira-green/`) — hoje só renderizado via legado. Mostra: adimplência da carteira do consultor logado, sync status iGreen, `ConsultantMetricsCard` (bônus, ranking, licenças).
- **Super-admin**: seletor de consultor no topo pra ver a carteira de qualquer licenciado.

### 1.5 Extrato (nova sub-aba)
Une o que hoje está solto em outros lugares:
- `wallet_transactions` (créditos, débitos, IA, envios) — hoje só aparece dentro do WhatsApp/Wallet guard.
- `wallet_manual_topup_requests` (recargas manuais aguardando aprovação) — hoje só admin do painel de wallet vê.
- Filtro por tipo (crédito / débito / IA / envio / recarga) e período.
- Botão "Aprovar recarga" para super-admin.

## 2. O que sai / muda em outras páginas

### 2.1 `AcompanhamentoPanel.tsx` (Produtos → Acompanhamento)
- **Remover**: bloco "Ganhos Conexão Green" (linhas ~292–338 do arquivo) + `StatPill` de carteira sync + cards Entrada/Recorrente/Bônus.
- **Manter**: Vendas em Andamento, CrossSell, Faturas Green (essas são operacionais, não financeiras).
- **Substituir** por um link discreto: *"Ver ganhos e recebíveis em Financeiro →"*.

### 2.2 `WhatsAppClientsPage.tsx` (rota `/whatsapp-clients`)
Hoje já é só redirect para `/admin?tab=clientes`. Atualizar comentário e redirect quando o usuário chegar com `?view=carteira` → mandar para `/admin?tab=financeiro&sub=carteira`.

### 2.3 `IGreenConnectionCard` e `EndpointDiscoveryCard`
Hoje aparecem só no **Sheet de Configurações** (Admin.tsx linhas 553–563). Isso está bom, mas adicionar um **atalho** dentro de Financeiro → Boletos ("Configurar conexão iGreen") que abre o mesmo Sheet, porque é o lugar natural onde o admin percebe que a sync não está rodando.

### 2.4 Sidebar
- Já tem "Financeiro". Adicionar **badge de contagem** no item da sidebar mostrando quantos boletos vencem hoje (query leve, cache 60s). Alerta visual sem precisar entrar na aba.

### 2.5 Página `SaudeBot` / dashboards
Nenhuma mudança — não são financeiro.

## 3. Detalhes técnicos

**Arquivos novos**
- `src/components/admin/financeiro/FinanceiroTabs.tsx` — nav interna + roteamento por `?sub=`.
- `src/components/admin/financeiro/RecebiveisPanel.tsx` — move o "Ganhos Conexão Green".
- `src/components/admin/financeiro/CarteiraGreenAdminPanel.tsx` — wrapper que injeta seletor de consultor para super-admin em cima do `CarteiraGreenPanel` existente.
- `src/components/admin/financeiro/ExtratoPanel.tsx` — lista `wallet_transactions` + `wallet_manual_topup_requests`.
- `src/components/admin/financeiro/hooks.ts` — adicionar `useBoletosMesRef`, `useUltimaCobranca(customerId)`, `useReguaCobranca(config)`, `useExtratoWallet()`.
- `src/components/admin/financeiro/csvExport.ts` — helper de export CSV.

**Arquivos editados**
- `src/components/admin/financeiro/FinanceiroPanel.tsx` — envolver em `FinanceiroTabs`; manter KPIs no topo (comuns a todas as subs) ou mover para sub "Boletos" apenas.
- `src/components/admin/financeiro/BoletosAdminTable.tsx` — adicionar checkbox multi-seleção, coluna "Última cobrança", filtro mês, botão "Exportar CSV", botão "Cobrar selecionados", toggle "Régua automática".
- `src/features/produtos/acompanhamento/AcompanhamentoPanel.tsx` — remover bloco Ganhos Conexão Green (linhas ~292–390) e trocar por link.
- `src/features/produtos/acompanhamento/greenData.ts` — expor `useGreenGains` (se já não expõe) para ser usado em `RecebiveisPanel`.
- `src/pages/Admin.tsx` — passar `initialSub` para `FinanceiroPanel` via query.
- `src/components/layout/AppSidebar.tsx` — badge de vencimentos.
- `src/pages/WhatsAppClientsPage.tsx` — respeitar `?view=carteira`.

**Sem migrations**. Todas as tabelas envolvidas (`igreen_customer_boletos`, `v_boletos_carteira`, `wallet_transactions`, `wallet_manual_topup_requests`, `scheduled_messages`, `customer_auto_message_log`, `igreen_consultant_metrics`) já existem.

**Permissões**
- Sub "Extrato" e "Recargas": só super-admin/admin.
- Sub "Recebíveis" e "Carteira": consultor vê os próprios; admin vê rede com seletor.
- Sub "Boletos": já implementado (scope `all` vs `self`).

## 4. Fora de escopo
- Integração com API bancária pra baixar boleto pago automaticamente (fica só com o sync iGreen).
- Emissão de novos boletos pelo painel (só visualização/cobrança).
- Relatório contábil formal / DRE.
- Mudanças no worker `worker-igreen-sync`.

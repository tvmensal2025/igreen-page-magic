
## Objetivo
Trazer para dentro do app tudo que o Escritório iGreen mostra em `/clientes-green`: boletos em aberto, vencidos, pagos, quem provavelmente vai pagar, devolutivas por categoria/motivo, injeção de energia e licenças expirando. Hoje o worker já captura tudo isso nas tabelas `igreen_customer_boletos`, `igreen_customer_devolutivas` e `igreen_consultant_metrics`, mas o front não exibe — vamos plugar.

## O que aparece na tela (nova aba "Carteira Green")

### 1. Status da Carteira (cards no topo)
Espelha o print do escritório:
- Com boleto gerado (carteira faturada)
- Boletos pagos (% adimplência)
- Disponível / a vencer (em aberto)
- Vencidos (% inadimplência)
- Injeção: com injeção / sem injeção / kWh compensados

### 2. Boletos por cliente (lista filtrável)
Filtros iguais ao portal: Todos · Vencidos 1‑30d · 31‑60d · +60d · Disponíveis · Pagos · Com/Sem injeção · Única/Duplo.
Cada linha: nome, cidade/UF, licenciado, vencimento, valor, status, badge de injeção, link do boleto/PDF, botão "Enviar no WhatsApp" (usa canal do consultor).

### 3. Devolutivas detalhadas
Agrupadas por categoria (documento, titularidade, conta, etc.), com motivo, campo, se é impeditiva, data e se é "própria". Botão de resolver / enviar aviso ao cliente.

### 4. Quem vai pagar (score de intenção)
Regra determinística sobre `igreen_customer_boletos`:
- **Alta**: pagou os 2 últimos meses no prazo e boleto atual em aberto ≤ vencimento.
- **Média**: histórico de pagar com 1‑10 dias de atraso.
- **Baixa**: 2+ meses sem pagar OU dias_atraso > 30.
- **Perdido provável**: vencido > 60 dias.
Ordena a lista e mostra chips coloridos + "próxima ação sugerida".

### 5. Licenças expirando & Cashback
Card lateral usando `igreen_consultant_metrics.raw_json.licencas_expirando` e `cashback_json`.

## Backend / dados
Nada novo no worker — os endpoints já existem (`/sync-boletos`, `/sync-devolutivas`, `/sync-all`, licenças, cashback). Apenas garantir:
1. Botão "Sincronizar agora" chamando `sync-igreen-customers` com `mode: 'sync_all'` (já roda em background pós fix do 504).
2. Cron diário já dispara — só exibir `last_synced_at` para o consultor saber a idade dos dados.
3. Migration leve: view `v_boletos_carteira` juntando boleto + customer (telefone, consultor) para simplificar a query da UI e permitir realtime seguro via RLS por `consultant_id`.

## Arquivos a criar/editar

**Novos (frontend)**
- `src/features/produtos/carteira-green/CarteiraGreenPanel.tsx` — layout geral com as 5 seções.
- `src/features/produtos/carteira-green/StatusCards.tsx` — os 4 cards de topo + injeção.
- `src/features/produtos/carteira-green/BoletosList.tsx` — filtros + tabela virtualizada.
- `src/features/produtos/carteira-green/DevolutivasList.tsx` — agrupamento por categoria.
- `src/features/produtos/carteira-green/PaymentIntent.tsx` — score "vai pagar".
- `src/features/produtos/carteira-green/hooks.ts` — `useBoletos`, `useDevolutivas`, `useCarteiraStats`, `usePaymentIntent` (React Query, filtro por `consultant_id`).
- `src/features/produtos/carteira-green/intent.ts` — função pura + testes.

**Editados**
- `src/features/produtos/acompanhamento/AcompanhamentoPanel.tsx` — inserir tab/entrada para "Carteira Green".
- `src/features/produtos/acompanhamento/AutomacaoIgreenCard.tsx` — botão "Sincronizar agora" e exibir `synced_at`.

**Migration**
- `create view public.v_boletos_carteira as select b.*, c.phone_whatsapp, c.name as customer_name from public.igreen_customer_boletos b left join public.customers c on c.id = b.customer_id;` + `GRANT SELECT` para `authenticated` (RLS herda via `security_invoker=on`).

## Fora do escopo (para não quebrar nada agora)
- Envio automatizado de lembrete de boleto por WhatsApp (fica no toggle `auto_wa_boleto_vencendo`, já existente, desligado por padrão).
- Alterar o worker/Tor.
- Alterar tabelas de captura — apenas leitura.

## Validação
- Query `select count(*) from igreen_customer_boletos where consultant_id = auth.uid()` retorna dados após "Sincronizar agora".
- Filtros batem com o portal iGreen no print enviado (21 clientes / 3 pagos / 16 disponível / 2 vencidos).
- Testes unitários de `intent.ts` cobrindo os 4 buckets.

# Encerrar cliente na Captação → vincular em toda a plataforma

## Objetivo E

Adicionar um botão **"Encerrar captação"** no painel de Captação. Ao clicar:

- O cliente **sai da lista de Captação** (deixa de aparecer em "Lista de leads / Conversas").
- **Continua no chat do WhatsApp** normalmente (nada é apagado, bot/humano seguem).
- É **vinculado como fechamento** em todos os módulos: CRM Kanban (estágio "fechado"), Vendas, Comissão do consultor e Financeiro/Extrato.  
E SE FOR LEAD DE CAMPANHA JA MOSTRA QUE ESTAMOS POSITIVO OU NEGATIVO, QUANDO TINVESTIU E QUANTO VVOLTOU, 

Requisito de segurança: nunca duplicar registros. Se já houver `sale`/`deal` fechado, apenas atualiza.

---

## O que muda para o consultor

Dentro do `CaptureSheet` (painel lateral do lead na Captação), abaixo do botão "Finalizar cadastro" hoje existente, aparece um segundo botão secundário:

- **"Encerrar captação e registrar fechamento"** (com ícone de troféu/check).
- Ao clicar, abre um diálogo curto perguntando:
  - Valor da conta / kWh estimado (pré-preenchido com o que já foi capturado).
  - Observação opcional (motivo do fechamento).
  - Confirmação: "Este lead sai da Captação, continua no WhatsApp e entra em Vendas/Comissão."
- Após confirmar, o card some da Captação e aparece toast: "Fechamento registrado — Vendas e Comissão atualizados."

Na lista da esquerda o lead deixa de aparecer imediatamente (mesmo filtro `capture_mode=manual` já existente).

No chat do WhatsApp o cliente continua acessível como sempre.

---

## Regras de negócio

1. **Sai da Captação**: limpar `capture_mode` (volta para `null`/`auto`) e gravar `capture_closed_at = now()`, `capture_closed_by = consultant_id`.
2. **Continua no WhatsApp**: nenhuma alteração em `bot_paused`, `origin_channel`, mensagens ou instância.
3. **CRM**: mover/atualizar `crm_deals` do cliente para o estágio "Fechado / Ganho" (usa o `kanban_stages` marcado como estágio final do consultor; se não existir deal, cria um).
4. **Vendas**: `INSERT` em `sales` com `status='closed'`, `customer_id`, `consultant_id`, `closed_at=now()`, `amount_cents` e `points_kwh` derivados do que foi capturado; se já existir venda aberta para esse cliente, faz `UPDATE` em vez de criar nova (idempotente por `customer_id`).
5. **Comissão**: usa `consultant_commission_settings` do consultor para calcular valor e grava a linha correspondente em `wallet_transactions` (tipo "commission_pending" — o fluxo de aprovação existente segue).
6. **Financeiro**: nenhuma tabela extra — o Extrato já lê `wallet_transactions` + `sales`, então a atualização acima aparece automaticamente.
7. **Idempotência**: chamadas repetidas não duplicam venda nem comissão (checa `capture_closed_at` + `sales` existente).

---

## Implementação técnica

### 1. Migração

- `ALTER TABLE public.customers ADD COLUMN capture_closed_at TIMESTAMPTZ, ADD COLUMN capture_closed_by UUID;`
- Índice parcial `WHERE capture_closed_at IS NULL` para acelerar a query da lista de Captação.
- Ajustar `CaptureLeadList.tsx` para filtrar `capture_closed_at IS NULL` além do `capture_mode='manual'`.

### 2. Nova edge function `close-capture-and-register-sale`

Arquivo: `supabase/functions/close-capture-and-register-sale/index.ts`. Passos em uma transação lógica (com rollback manual em caso de erro parcial + log em `admin_audit_log`):

1. Valida JWT do consultor, confere `customer.consultant_id`.
2. `UPDATE customers SET capture_mode=NULL, capture_closed_at=now(), capture_closed_by=:consultant_id`.
3. `UPSERT crm_deals` → estágio final (`kanban_stages` do consultor com `is_won=true`).
4. `UPSERT sales` idempotente por `(consultant_id, customer_id)` aberto → `status='closed'`, `closed_at=now()`, `amount_cents`, `points_kwh`, `capture_data` (snapshot do lead).
5. Calcula comissão via `consultant_commission_settings` e insere `wallet_transactions` (`type='commission_pending'`) se ainda não existir para esse `sale_id`.
6. Retorna `{ ok, saleId, dealId, commissionCents }`.
7. Erros parciais → status 200 com `fallback:true` + `code`, para o frontend mostrar toast claro sem quebrar.

### 3. Frontend

- `CaptureSheet.tsx`: adicionar botão + diálogo (`AlertDialog` do shadcn) chamando `supabase.functions.invoke("close-capture-and-register-sale", ...)`.
- Após sucesso: `queryClient.invalidateQueries` das chaves de Captação, CRM Kanban, Vendas e Financeiro.
- `CaptureLeadList.tsx`: acrescentar `.is("capture_closed_at", null)` no filtro.

### 4. Verificações

- `tsgo` + typecheck.
- Sanidade manual: fechar um lead de teste, conferir que sumiu da Captação, apareceu em `/admin` → Vendas + Financeiro, e chat do WhatsApp continua igual.  


---

## Fora de escopo (evita mudança de comportamento indesejada)

- Não altera o botão "Finalizar cadastro" (portal iGreen) — permanece independente.
- Não mexe em rótulos de estágios existentes no Kanban do consultor.
- Não envia nova mensagem ao cliente.
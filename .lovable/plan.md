## O que muda

Hoje, ao clicar em **"Validar novos clientes"** e confirmar a aprovação, todo cliente cai em **"Aprovado"** e só avança para 30/60/90/120 dias conforme o tempo passa (cron diário). Quem foi aprovado há muito tempo no iGreen mas só está sendo validado agora fica preso em "Aprovado" por dias até o cron mover.

A mudança permite o consultor escolher, no momento da validação, **em qual coluna o cliente deve aparecer**: Aprovado (padrão), 30, 60, 90 ou 120 dias.

## Como vai funcionar para o usuário

No diálogo "Validar novos clientes" (`PendingApprovalDialog`), o botão **"Confirmar / Aprovar"** vira um botão dividido:

- **Aprovar** (ação principal — mantém o comportamento atual: vai para "Aprovado")
- Setinha ao lado abre menu com:
  - Aprovar como **30 dias**
  - Aprovar como **60 dias**
  - Aprovar como **90 dias**
  - Aprovar como **120 dias**

Escolhendo um período, o cliente já entra direto na coluna correspondente no Kanban Pós-Venda e **não é mais mexido pelo cron automático** (fica marcado como manual).

A validação do valor da conta de luz (`ApproveBillValueDialog`) continua acontecendo antes, igual hoje — só depois do valor preenchido é que a coluna final é aplicada.

## Onde mexer (técnico)

1. **`src/components/whatsapp/PendingApprovalDialog.tsx`**
   - Estender `act(customerId, action)` para aceitar um terceiro parâmetro opcional `targetStage?: 'aprovado'|'d30'|'d60'|'d90'|'d120'`.
   - Fluxo dentro de `act` quando `action === 'approve'` e `targetStage` é informado e diferente de `'aprovado'`:
     1. Chamar normalmente `supabase.rpc('confirm_pending_classification', { _customer_id, _action: 'approve' })` (mantém o stamp de `pos_venda_approved_at` e a auditoria existente).
     2. Em seguida, `supabase.from('customers').update({ pos_venda_stage: targetStage, pos_venda_manual: true }).eq('id', customerId)` para sobrescrever a coluna.
   - Substituir o botão "Confirmar/Aprovar" atual por um **split button** (Button + DropdownMenu do shadcn já usados no projeto). Ação principal = `handleApproveClick(c)` (comportamento atual). Itens do menu chamam `handleApproveClick(c, 'd30' | 'd60' | 'd90' | 'd120')`.
   - Ajustar `handleApproveClick` para repassar `targetStage` ao `act` e ao `setBillPrompt` (guardar o `targetStage` junto do estado do prompt de valor da conta).

2. **`src/components/whatsapp/ApproveBillValueDialog.tsx`**
   - Aceitar `targetStage` como prop opcional e devolvê-lo no callback de confirmação, para que o `PosVendaKanban` aplique a mesma coluna escolhida originalmente.

3. **`src/components/whatsapp/PosVendaKanban.tsx`** (linha ~344)
   - No callback do `ApproveBillValueDialog`, se vier `targetStage`, chamar `applyMoveTo(updated, targetStage)` em vez de fixo `'aprovado'`.

## Sem mudança de banco

- O campo `pos_venda_stage` já aceita `d30/d60/d90/d120`.
- `pos_venda_manual = true` já bloqueia o cron de sobrescrever.
- A RPC `confirm_pending_classification` continua sendo chamada para preservar `pos_venda_approved_at`, auditoria e limpeza de `pos_venda_pending_stage`.

Nenhuma migration é necessária.

## Fora do escopo

- Não mexe no botão de aprovação em massa nem nas regras de reprovação.
- Não muda o cron diário nem a lógica de `computeStage`.
- Não adiciona itens novos no menu de cada card do Kanban (drag-and-drop já cobre esse caso pontual).

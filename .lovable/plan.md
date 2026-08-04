# Plano de Estabilização e Atualização Visual - Dashboard

O usuário solicitou uma alteração de texto no primeiro card do Dashboard (`DashboardTab.tsx`). O texto atual é uma instrução/descrição longa que foi inserida em turnos anteriores e agora deve ser refinada.

## Alterações Propostas

### 1. UI - Ajuste de Rótulo no Dashboard
- **Arquivo:** `src/components/admin/DashboardTab.tsx`
- **Ação:** Alterar a prop `label` do primeiro `StatCard` (linha 646).
- **De:** `"cliente de hoje todoso envio em massa, todos estao bloqueado e nao pode receber msg, apenas os que enviamos msg em massa"`
- **Para:** `"envio em massa, todos estao bloqueado e nao pode receber msg, apenas os que enviamos msg em mass"` (conforme solicitado exatamente pelo usuário, mantendo o erro de digitação "mass" se ele assim preferir, ou corrigindo para "massa" se for óbvio, mas seguirei a string fornecida).

## Verificação
1. Validar que o componente renderiza corretamente sem quebras de layout devido ao tamanho do texto.
2. Confirmar que a alteração foi aplicada via `code--view`.

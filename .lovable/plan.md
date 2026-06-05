## Objetivo

Replicar o card "Manutenção: reset geral por telefone" (que já funciona no DashboardTab) em todos os outros dashboards do app, para uso temporário enquanto validamos o fluxo. Depois você só remove um componente.

## Abordagem

1. **Extrair o card num componente reutilizável**: `src/components/admin/HardResetPhoneCard.tsx`
   - Move toda a UI + lógica (`resetPhone`, `handleHardResetPhone`, chamada `adminHardResetPhone` + verificação `adminHardResetPhoneTraceCounts`, toasts) do `DashboardTab.tsx` para esse componente.
   - Mantém visível só para admin (mesma checagem `isAdmin` já usada).
   - Pré-preenche o input com `11971254913` para agilizar testes, mas continua editável.

2. **Substituir no DashboardTab** o bloco atual pelo `<HardResetPhoneCard />`.

3. **Adicionar `<HardResetPhoneCard />` nos demais dashboards**:
   - `src/pages/Admin.tsx` (topo da página)
   - `src/pages/SaudeProducao.tsx`
   - `src/components/admin/parceiros/PartnerDashboard.tsx`
   - `src/components/admin/parceiros/ParceirosTab.tsx`
   - `src/components/admin/ads/ResultsDashboard.tsx`
   - `src/components/admin/ads/PerformanceTab.tsx`
   - `src/components/admin/ads/AdsCentralTab.tsx`

   Em cada um insere o card no topo, dentro de um wrapper, sem mexer em mais nada da UI/lógica.

4. **Remoção futura**: para apagar, basta deletar `HardResetPhoneCard.tsx` e remover os imports/uso — nenhum efeito colateral em backend (RPC `admin_hard_reset_phone` permanece intocada).

## Fora de escopo

- Sem mudanças em edge functions, RPCs ou migrações.
- Sem mudar nada do fluxo de IA / webhook.
- Sem alterar permissões (continua só admin).

## Confirmação

Posso seguir com esses 7 dashboards listados? Se quiser que eu adicione em algum outro lugar (ex.: CRM landing, página pública), me diga antes de eu ir para build.
## Melhorias na aba Financeiro

Auditei os 4 painéis (Boletos, Recebíveis, Carteira, Extrato). Deixando Recebíveis e Extrato como estão hoje, dá pra melhorar bastante em pequenas doses. Proponho **dois lotes**: quick wins agora, e um lote maior depois se você topar.

### Lote 1 — Quick wins (sem migração, sem risco)

**Boletos**

1. **Corrigir KPI de "Inadimplência %"** — hoje mistura pagos do mês com vencidos acumulados de meses anteriores, dando percentual distorcido. Passa a calcular sobre boletos emitidos no mês.
2. **Ordenação da tabela** — clicar no cabeçalho ordena por valor, vencimento, consultor, dias de atraso.
3. **Coluna "Última cobrança"** já estava prevista mas nunca chegou — ler `customer_auto_message_log` (kind `boleto_lembrete`) e mostrar "há X dias" ou "—".
4. **Template de cobrança configurável** — hoje o texto do WhatsApp está hardcoded em dois lugares (`BoletosAdminTable.tsx:115` e `:287`) e não inclui valor nem vencimento. Passa a ler de `message_templates` (kind `boleto_cobranca`) com variáveis `{{nome}}`, `{{valor}}`, `{{vencimento}}`, `{{url_boleto}}`. Se não existir template, usa fallback atual.
5. **Trocar `window.confirm()` do bulk cobrar** por um `Dialog` com preview do template e contagem.

**Extrato**
6. **Trocar `window.prompt()` de rejeitar recarga** por `Dialog` com `Textarea` (acessível, funciona em mobile).
7. **Nome do consultor legível** na lista de recargas pendentes e nas linhas de transação (hoje mostra `consultant_id.slice(0,8)…`). Reaproveita o padrão de join de `hooks.ts`.
8. **"Mostrar mais 200"** no fim da lista (hoje corta em 200 sem aviso).

**Sidebar**
9. **Badge da sidebar** passa a somar *vence hoje + vencidos* (hoje só conta hoje, vencidos ficam invisíveis).

**Carteira**
10. **Trocar `useEffect` manual por `useQuery**` no seletor de consultor do super-admin — ganha loading state, cache e retry.

### Lote 2 — Melhorias maiores (só se você aprovar)

- **Paginação real + filtros no servidor** em `useBoletosAdmin`. Hoje traz até 5.000 linhas e filtra no front — vai quebrar quando a rede crescer.
- **Gráfico de tendência** (Recharts, já instalado): barras dos últimos 6 meses de pagos × vencidos no topo da aba Boletos.
- **Régua automática de cobrança** via edge function agendada: D-3 aviso, D0 lembrete, D+5 cobrança. Usa o template do quick win #4 e liga/desliga por toggle.

### Fora de escopo

- Mudanças em Recebíveis e Extrato além dos itens 6–8 (você pediu para deixar como está).
- Integração bancária, emissão de boletos, DRE contábil.
- Alterações no worker `worker-igreen-sync`.

### Arquivos afetados (Lote 1)

- `BoletosPanel.tsx` — corrigir cálculo de inadimplência
- `BoletosAdminTable.tsx` — ordenação, coluna última cobrança, dialog de bulk, template
- `hooks.ts` — hook `useUltimaCobranca` + reaproveitar join de nomes no Extrato
- `ExtratoPanel.tsx` — dialog de rejeição, nome do consultor, "mostrar mais"
- `useVenceHojeCount.ts` → renomear para `useAlertasBoletosCount` e somar vencidos
- `CarteiraGreenAdminPanel.tsx` — trocar `useEffect` por `useQuery`
- **Novo**: `src/components/admin/financeiro/CobrarBulkDialog.tsx`, `RejeitarTopupDialog.tsx`
- **Sem migrations**.

### Pergunta antes de eu implementar

- Toca o **Lote 1 inteiro** de uma vez, ou prefere escolher um subconjunto? faca tudo
- O **Lote 2** entra depois, ou já embuto junto? faca tudo  
  
analise o codigo para implantar corretamente
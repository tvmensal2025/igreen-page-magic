## Remover o painel "Sincronizar TODOS os consultores" do dashboard

### Análise da estrutura de sync (o que o botão de cima já faz)

O botão **"Sincronizar"** no topo do dashboard chama `runIgreenSync(userId, "sync_all")`. O modo `sync_all` **já puxa 100% dos dados do consultor logado**, em duas fases:

**Fase A — síncrona (aparece em segundos):**
- Clientes / carteira / energia
- Rede de indicados (consultores abaixo)
- Métricas básicas

**Fase B — em background no worker (`EdgeRuntime.waitUntil`, marcada em `extras._background_finished_at`):**
- Boletos
- Telecom
- Seguros
- Cashback
- Devolutivas
- Enriquecimento (dados detalhados de cada cliente via portal 2)

O front espera essa fase B via `waitIgreenSyncFinished` (poll a cada 4s até 150s), e quando termina dispara um segundo toast "✅ Sincronização concluída!" com contagem de Telecom/Seguros. Se o portal iGreen estiver muito lento, o worker continua puxando em segundo plano mesmo depois do timeout do poll — os dados aparecem no próximo refresh.

**Conclusão:** o botão do topo já cobre 100% dos dados **do consultor logado**. Nada fica de fora.

### O que o `IGreenBulkSyncPanel` faz de diferente (e por que vale confirmar)

Ele dispara `source=bulk_manual` que roda `sync_all` **para TODOS os consultores da base** (com credenciais configuradas), um por um a cada 3s, em background no edge. Estado gravado em `igreen_bulk_sync_state`.

Ou seja: **não é redundância** com o botão do topo — é sync em massa da base inteira, útil pra admin popular tudo de uma vez após deploy ou quando você quer refresh geral sem ter que logar como cada consultor.

Pelo texto do usuário ("já temos o sincronizar no topo"), a decisão é remover mesmo. Isso é seguro porque:
1. O sync individual já é 100% completo.
2. Cada consultor faz seu próprio sync quando abre o dashboard (o botão do topo, ou via cron automático que a edge já dispara — código `cronMode` em `sync-igreen-customers`).
3. O componente/edge continuam existindo — dá pra reativar depois se precisar.

### Mudanças

**Arquivo:** `src/components/admin/DashboardTab.tsx`
- Remover a linha `<IGreenBulkSyncPanel />` (linha 312) e o comentário acima.
- Remover o import `import { IGreenBulkSyncPanel } from "@/components/admin/IGreenBulkSyncPanel";` (linha 25).

**Não mexer em:**
- `IGreenBulkSyncPanel.tsx` (fica no repo, sem uso — pode ser reativado depois).
- `IGreenSyncStatusBar` (esse continua — mostra "última sync por produto", útil pro consultor saber o que tá fresh).
- Edge function `sync-igreen-customers` — nada muda.
- Cron / worker — nada muda.

### Fora do escopo
- Não altero a lógica de sync.
- Não deleto o arquivo `IGreenBulkSyncPanel.tsx` (só desuso do dashboard).
- Não mexo em nenhum outro card do `DashboardTab`.

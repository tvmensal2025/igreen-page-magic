## Mover a barra de status iGreen pra Configurações e mostrar dados reais

### Estado atual

Hoje a barra fica em `DashboardTab.tsx` (linha 309) e mostra tudo com "—" porque `IGreenSyncStatusBar` lê **contagens do último `igreen_sync_runs.counts`**, que nem sempre traz todas as chaves esperadas (`processed`, `persisted`, `imported`, etc.). Resultado: aparece "Energia: — Rede: — Telecom: —" mesmo com dados salvos.

### O que vai mudar

**1. Sair do Dashboard**
- Remover `<IGreenSyncStatusBar consultantId={userId} />` e o import em `src/components/admin/DashboardTab.tsx`.

**2. Entrar em Configurações (Sheet "Dados")**
- Em `src/pages/Admin.tsx`, dentro do bloco Suspense do `SheetContent`, adicionar a barra logo abaixo do `IGreenConnectionCard`:
  ```
  {userId && <IGreenConnectionCard userId={userId} />}
  {userId && <IGreenSyncStatusBar consultantId={userId} />}
  ```
- Vai ficar visível quando o consultor abrir Configurações → aba/seção "Dados do consultor".

**3. Refatorar `IGreenSyncStatusBar` pra mostrar dados REAIS (não depender do shape do último run)**

Trocar a fonte: em vez de ler `igreen_sync_runs.counts`, contar direto nas tabelas de destino (mesmas tabelas onde o worker grava). Assim os números batem 100% com o que está no banco naquele momento.

Queries paralelas (`Promise.all`), todas com `select("id", { count: "exact", head: true }).eq("consultant_id", consultantId)`:
- **Energia:** `customers` (opcionalmente filtro `origem_igreen = true` se existir).
- **Rede:** `network_members`.
- **Telecom:** `igreen_telecom_customers`.
- **Seguros:** `igreen_seguros_customers`.
- **Boletos:** `igreen_customer_boletos`.
- **Métricas:** `igreen_consultant_metrics` — head/count; se ≥1, mostra "OK" com a data do último snapshot; se 0, mostra "—".

Manter o "Última sync" lendo `igreen_sync_runs` (última linha `finished_at`).

Manter o alerta de `identityMismatch` (igreen_id vs portal_igreen_id) — só que agora aparece dentro de Configurações, exatamente onde faz sentido resolver.

**4. Layout ajustado pra caber em Configurações (não é mais barra compacta)**

Como agora vive num sheet largo, trocar o layout de "barrinha inline" pra um card com grid 3 colunas de tiles:
```
┌─────────────────────────────────────┐
│  Última sincronização iGreen        │
│  07/07 09:50 · Sucesso              │
├─────────────────────────────────────┤
│  ⚡ Energia   👥 Rede    📞 Telecom │
│   1.204        87         432       │
│                                     │
│  🛡 Seguros   📄 Boletos 📈 Métricas│
│   58          912        OK/07/07   │
└─────────────────────────────────────┘
```
Cada tile mostra número grande + label. Se contagem `== 0` fica amber suave (avisando "nada salvo"). Se `null` (erro na query) fica cinza com "—".

Adicionar botão discreto "Atualizar contagens" no header do card que faz refetch das queries (não dispara sync, só relê o banco).

### Fora do escopo

- Não muda o sync em si (`sync-igreen-customers` continua igual).
- Não muda o botão "Sincronizar" do topo.
- Não deleta `IGreenSyncStatusBar.tsx` — refatora ele in-place.
- Não altera `IGreenConnectionCard`.

### Arquivos afetados
- `src/components/admin/DashboardTab.tsx` (remover uso + import).
- `src/pages/Admin.tsx` (adicionar no sheet Configurações, lazy import).
- `src/components/admin/IGreenSyncStatusBar.tsx` (refatorar para contagens reais + novo layout).

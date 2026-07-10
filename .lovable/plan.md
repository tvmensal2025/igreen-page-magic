## Problema

Lucineia continua aparecendo em **Captação → Em espera** mesmo depois de encerrada. Investigando o registro dela:

- `capture_closed_at = null` (nunca foi marcada como encerrada)
- `igreen_code = 1585552` (**já é cliente ativa no portal iGreen**)
- Existe `sale` com `outcome = 'won'` (venda já registrada)

Ou seja: ela virou cliente por outro caminho (sync do iGreen), mas o filtro da lista só olha `capture_closed_at IS NULL`. Além disso, o botão **"Encerrar captação"** que fica no **header do ChatView** está chamando a edge function **sem o campo obrigatório `outcome`** — a função responde 400 e nada é atualizado, mas o toast de erro passa despercebido. Há 3 leads hoje no mesmo estado (já clientes/vendidos, mas ainda listados).

## O que vamos fazer

### 1. Filtro da lista de Captação (esconder quem já não é lead)
Em `CaptureLeadList.tsx` (query principal), esconder automaticamente quem se enquadrar em qualquer um destes:
- `capture_closed_at IS NOT NULL` (já)
- `igreen_code IS NOT NULL` (já virou cliente iGreen)
- `assinatura_cliente IS NOT NULL` (já assinou)
- existe `sales` com `outcome IN ('won','lost')` para o par consultor/cliente

Sem botão manual — o sistema decide sozinho, como você pediu antes.

### 2. Backfill imediato (3 leads afetados hoje)
Rodar UPDATE marcando `capture_closed_at = now()` + `capture_mode = null` para os customers que já tinham `igreen_code` ou `sales.outcome` preenchido mas continuavam abertos. Lucineia sai da lista na hora.

### 3. Corrigir o botão "Encerrar" do header do ChatView
Hoje `ChatView.runCloseCapture` chama a edge function **sem `outcome`** → 400 silencioso. Trocar por:
- Abrir o mesmo `CloseCaptureDialog` (Ganho / Perdido, produto, origem, motivo) que já usamos no rodapé da ficha em Captação.
- Após fechar, atualizar o estado local (`capture_closed_at`) para esconder o botão.

Assim o botão do chat e o da ficha usam **o mesmo fluxo** — nunca mais um encerramento "fantasma".

### 4. Aviso quando o lead virar cliente sozinho (via iGreen sync)
Quando o worker de sync do iGreen encontrar um `customer` que ainda estava em `capture_mode='manual'` e passar a ter `igreen_code`, também setar `capture_closed_at = now()` no mesmo update. Assim não depende do filtro de UI e o histórico fica limpo.

## Detalhes técnicos

- **Arquivo:** `src/components/captacao/CaptureLeadList.tsx` — trocar `.is("capture_closed_at", null)` por filtro composto com `or()` de PostgREST, e adicionar `not.exists` via subconsulta (ou fazer um segundo passo em JS após o fetch, cruzando com `sales`).
- **Arquivo:** `src/components/whatsapp/ChatView.tsx` — substituir `runCloseCapture` direto por abertura de `<CloseCaptureDialog />` (importar do módulo captacao).
- **Migração SQL (backfill):** update pontual em `customers` para os 3 registros no estado inconsistente.
- **Worker iGreen sync:** localizar onde é feito o upsert de `igreen_code` no customer (pesquisar `igreen_code` em `worker-igreen-sync/` e `supabase/functions/`) e adicionar `capture_closed_at = now()` quando `capture_mode = 'manual'`.

## Fora de escopo

- Não mexer no chat WhatsApp da Lucineia (continua vivo).
- Não recalcular ROI/comissões existentes.
- Não mudar regras de quem pode encerrar (só o consultor dono / admin, como já é hoje).

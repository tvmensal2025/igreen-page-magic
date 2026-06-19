# Plano: Garantir que TODOS os botões finalizam no Portal 2  
ANALISE DENOVO E DEPOS APILCAR  
  
EXPLICACAO:PORTAL 1 FOI EXCLUIDO DA EMPRESA, HOJE ELES ACEIAT AEPNAS O 2 ENTAO O 1 VAI DAR ERRO, EU QUEROMANTER POR SEGURANCA SE ELES VOLTAR NO FUTURO

## Diagnóstico

A auditoria confirmou que os 4 caminhos de entrada já convergem no `dispatchPortalWorker`:


| Entrada          | Onde                                                 | Chega no Portal 2? |
| ---------------- | ---------------------------------------------------- | ------------------ |
| Cadastro Rápido  | `bot-flow.ts:5360` (state `finalizando`)             | Sim                |
| Cadastro Manual  | `finalize-capture/index.ts:197` (botão UI)           | Sim                |
| Reaquecimento    | `reactivation-send` → fluxo normal → `finalizando`   | Sim                |
| Partner Redirect | `PartnerRedirectPage` → fluxo normal → `finalizando` | Sim                |


Porém ainda existem **3 portões** que podem desviar/parar o lead antes do Portal 2. Vou removê-los/ajustá-los.

## Ajustes

### 1. Fallback em `portal-worker.ts:55` (Portal 1 quando `portal_kind` não é `'autoconexao'`)

Hoje: `kind === 'autoconexao' ? 'autoconexao' : 'digital'` → qualquer valor inesperado cai no Portal 1.
Mudar para: **sempre `'autoconexao'**` (com log de warning se vier diferente). Portal 1 fica no código mas não é mais alcançável por default.

### 2. Branches `capture_mode === 'manual'` em `bot-flow.ts` (linhas ~3446 e ~4258)

Hoje: lead com `capture_mode='manual'` pausa pra consultor revisar a conta/documento antes de seguir.
Mudar para: tratar `manual` igual a `auto` (segue automático). Mantém a coluna no schema caso queira reativar futuramente via flag, mas o fluxo padrão ignora.

### 3. Mesma correção no espelho `whapi-webhook/handlers/bot-flow.ts`

As duas funções têm o mesmo código duplicado.

## O que NÃO vou mexer (são corretos)

- `**checkDocsPresentForPortal2**` (`portal-worker.ts:278`) — bloqueia só se faltar conta/doc de verdade. Status `missing_documents` é correto, não é bug.
- `**worker_offline**` (`portal-worker.ts:269`) — quando a API do Portal 2 está fora; retry cron já cuida. Correto.
- **OCR fallback** `humano` — só aciona se o passo no admin estiver configurado pra escalar (decisão de produto, não bug). OCR HUMANO SO QUANDO FOR ENVIADO O PASSO NO MANUAL, QUANDO O CLIENTE INICIA A CONVERSA AUTOMATCIO O A CONFIRMACAO É AUTOMATICA

- Arquivos editados: `supabase/functions/_shared/portal-worker.ts`, `supabase/functions/evolution-webhook/handlers/bot-flow.ts`, `supabase/functions/whapi-webhook/handlers/bot-flow.ts`.
- Sem migração de banco (defaults já corrigidos no ajuste anterior).
- Backfill opcional: `UPDATE customers SET capture_mode='auto' WHERE capture_mode='manual'` (todos, não só últimos 30 dias) — me confirma se quer rodar.
# Diagnóstico: cadastro não foi para o portal por **duplicidade de celular**

## O que aconteceu com `482c0262…` (PAULO/BRUNO, 5511971254913)

1. Você clicou Finalizar → `finalize-capture` rodou, marcou `finalized_at=20:56:44`, enfileirou no `worker-portal-2` (job 2 e job 7).
2. Worker fez:
  - `GET /customers/check-exists?document=***8885&email=…` → `exists:false` ✅
  - `GET /bonus/distributors?uf=SP` → resolveu para `CPFL PIRATININGA` ✅
  - `GET /bonus/rules` → tier A 8% ✅
  - `POST /customers` → **HTTP 400** `error.customer.duplicatePhone` (campo `celular`) ❌
3. Worker marcou o job como `failed` (visto em `portal2_audit_traces`).
4. Bot recebeu nova msg do cliente no WhatsApp → step voltou para `aguard_conta` → no card o lead parece "perdido".

A API do iGreen valida duplicidade de **celular** no POST final, mas o `check-exists` só olha CPF/e-mail — por isso o frontend mostra "enviado" e a falha real aparece só nos traces.

## Como resolver agora (operacional, sem código)

- **Confirmar no portal iGreen** quem está usando o celular `(11) 97125-4913`. Provavelmente é uma tentativa antiga do **Bruno Manoel** que não foi excluída.
- Duas saídas:
  1. **Cancelar** o cadastro antigo no portal e reenviar (botão Finalizar novamente).
  2. Cadastrar o titular **PAULO** com **outro celular** (o do próprio titular). Editar `phone_whatsapp` no card e finalizar.

## Mudanças no código (proposta — me confirme antes de implementar)

### 1. `worker-portal-2` → repercutir falha no `customers`

Hoje o worker só grava em `portal2_audit_traces`. Adicionar (após o catch do `POST /customers`):

- Se `status=400` e `code=error.customer.duplicatePhone` (ou similar):
  - `UPDATE customers SET status='portal_rejected_duplicate', error_message='Celular já cadastrado no portal iGreen — verifique cadastro existente ou troque o número' WHERE id=…`
- Para outros 4xx/5xx finais: `status='portal_failed'`, `error_message=<msg>`.

### 2. `finalize-capture` → não derrubar status pelo bot depois

Quando `status` for um dos terminais de falha (`portal_rejected_duplicate`, `portal_failed`, `worker_offline`), o `whapi-webhook` **não** deve sobrescrever `conversation_step` automaticamente. Adicionar guard em `bot-flow.ts` / `conversational/index.ts`:

```
const PORTAL_FAILED = new Set(["portal_rejected_duplicate","portal_failed","worker_offline"]);
if (PORTAL_FAILED.has(customer.status)) return; // não mexe no step
```

### 3. UI — banner no card de captação

No `CaptureLeadCard` / `PortalStatusTracker`, quando `customer.status === 'portal_rejected_duplicate'`:

- Banner vermelho fixo: "❌ Portal rejeitou: celular já cadastrado. Cancele o cadastro anterior no iGreen ou edite o telefone e reenvie."
- Botão **Reenviar ao portal** (chama `finalize-capture` de novo) habilitado.

### 4. (opcional) `finalize-capture` → checar duplicidade **antes** de enfileirar

Adicionar uma chamada `GET /customers/check-exists?celular=…` se o portal expor; senão, manter só o tratamento pós-falha (item 1).

## Fora de escopo

- Mexer no validador de duplicidade do backend iGreen (externo).
- OCR / extração de titularidade (separado).
- worker-portal-2 também aparece com SIGTERM nos seus logs locais — isso é outro problema (container reiniciando), me avise se quiser tratar junto.

## Próximo passo imediato

Você quer que eu:

- (A) implemente só **#3** (banner no UI mostrando o erro real) — mais rápido e seguro;
- INDEPEDENTE DO ERRO VAI MOSTRARNO BANNER
- &nbsp;
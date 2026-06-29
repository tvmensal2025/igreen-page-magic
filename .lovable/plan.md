## Plano: garantir anexo de Documento + Conta de Energia no Portal iGreen (zero falha silenciosa)

O caso da Gislaine aconteceu porque o worker tratava upload como "best-effort": se falhasse, ele apenas logava aviso e seguia o cadastro como concluído. Vou tornar o anexo **obrigatório, verificado e auto-corrigido**, com falha explícita quando o portal não confirmar.

---

### 1. Upload obrigatório com retry robusto (`worker-portal-2/portal2-api-client.mjs`)

Para cada arquivo (doc frente, doc verso quando não-CNH, conta de energia):

- Tentar `uploadDocument` **até 5 vezes** com backoff exponencial (2s, 4s, 8s, 16s, 30s).
- Tratar erros transientes (HTTP 5xx, ECONNRESET, ETIMEDOUT, socket hang up) como retentáveis.
- Validar o response do upload: precisa retornar URL/ID válido — se vier vazio, conta como falha.
- Registrar cada tentativa em `uploadFailures[]` com timestamp e motivo.

### 2. Verificação real pós-upload (`verifyUpload`)

Após todos os uploads:

- Chamar `verifyUpload(idsolcontratovalidacao)` para listar o que o Portal iGreen **realmente recebeu**.
- Conferir obrigatoriamente:
  - `energy.hasUrl === true`
  - `personalDoc.hasFront === true`
  - `personalDoc.hasBack === true` quando `docType !== 'CNH'`
- Se faltar algo, chamar `reconcileUpload` (re-anexa arquivos órfãos no portal) e **reverificar**.
- Se ainda faltar após o reconcile, fazer **mais 2 tentativas completas** do(s) arquivo(s) faltante(s).

### 3. Falha explícita, sem cadastro "fantasma"

Se após todas as tentativas algum anexo continuar faltando:

- Lançar `PORTAL_ATTACHMENTS_NOT_CONFIRMED` com lista de itens faltantes.
- Worker grava no `customers`:
  - `portal2_error_kind = 'attachment_not_confirmed'`
  - `portal2_error = "Faltou: docFront, energy..."`
  - `status = 'needs_human'`
  - `portal2_idcliente = null` (para permitir nova tentativa limpa quando o operador corrigir)
- Notificação imediata ao Super Admin via `super-admin-alerts` com o telefone do lead e os itens que faltaram.
- `portal-errors.mjs` classifica como `recoverable: false` → BullMQ **não fica em loop**.

### 4. Evidência persistida (auditoria sem dúvida)

Salvar em `portal2_ocr_doc_result` e `portal2_ocr_bill_result` (campo `upload`):

```json
{
  "idsolcontratovalidacao": 519995,
  "docFront": true,
  "docBack": true,
  "energy": true,
  "verifiedAt": "2026-06-29T22:30:00Z",
  "uploadAttempts": { "docFront": 1, "docBack": 2, "energy": 1 },
  "uploadFailures": []
}
```

Pelo painel dá pra ver na hora se foi anexado de verdade — não basta ter URL no Supabase.

### 5. Pré-validação antes de abrir o cadastro

Antes de chamar `cadastrarCliente`, validar localmente que os 3 arquivos (ou 2 se CNH) existem no Supabase Storage/MinIO e são acessíveis (HEAD request com 200). Se faltar arquivo no nosso lado, **nem abre o cadastro no portal** — vai direto pra `needs_human` com motivo claro, evitando criar cliente sem anexo.

### 6. OTP (já no plano anterior, fica mantido)

- `submit-otp` e `portal-otp-watchdog` tratam 502/503/504/HTML como `worker_transient` e não queimam retries.
- Watchdog insiste até o worker voltar e digitar o código no portal.
- Só conta retry quando a iGreen rejeita o código.

### 7. Não mexer na Gislaine

Você já finalizou o cadastro dela manualmente — nenhuma alteração nos dados desse lead.

---

### Arquivos que vou editar

- `worker-portal-2/portal2-api-client.mjs` — retry+verify+reconcile obrigatórios, pré-check dos arquivos.
- `worker-portal-2/portal-errors.mjs` — `attachment_not_confirmed` como `recoverable: false`.
- `worker-portal-2/server.mjs` — persistir `upload` evidence, corrigir coluna `last_otp_dispatch_error`, marcar `needs_human` + alertar super admin.
- `supabase/functions/submit-otp/index.ts` — tratamento de `worker_transient` (já feito, validar).
- `supabase/functions/portal-otp-watchdog/index.ts` — não incrementar retry em transiente (já feito, validar).

### Garantia final

Depois disso, **só haverá `status = sucesso**` quando o Portal iGreen confirmar via `verifyUpload` que os 3 arquivos estão lá. Não vai mais existir o cenário "cliente criada sem documento" — ou anexa de verdade, ou para em `needs_human` com alerta pra você.

Posso aplicar? SIM, FACA TESTE ONDE TEM QUE SALVAR NO PORTAL2 ANALISE ONDE É ANEXADO A CONTA DE ENERGIA,, RG FRENTE, RGM VERSO, COMPROVANTE ENTRE OUTROS
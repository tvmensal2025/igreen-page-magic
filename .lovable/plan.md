## Diagnóstico revisado da Gislaine

Você está certo em cobrar: **arquivo salvo no Supabase/OCR feito não prova que o documento e a conta ficaram anexados no Portal iGreen**.

O que a nova análise mostrou:

- O banco tem as imagens/PDFs salvos e o OCR leu os dados.
- O cadastro foi criado no Portal com `idcliente 1597472` e `idsolcontratovalidacao 519995`.
- Porém a auditoria do job **não guardou o resultado do `verifyUpload**`: `result.extraction.upload = null`.
- No código atual, quando o upload/anexo falha, aparece apenas aviso e o cadastro continua mesmo assim:
  - `não anexou ... após 3 tentativas (cadastro segue...)`
  - isso é exatamente o risco que você relatou: cliente criada, mas documento/conta não anexados no portal.
- O OTP também falhou: o código `336575` foi recebido, mas `/confirm-otp` retornou `HTTP 502` em HTML pelo worker/proxy, e o watchdog chegou em `portal_retry_count = 8`; então o sistema parou em `aguardando_otp` e você teve que digitar manualmente.

## Correção que vou implementar

### 1. Anexo no Portal passa a ser obrigatório

No `worker-portal-2/portal2-api-client.mjs`:

- Depois dos uploads, chamar `verifyUpload(idsolcontratovalidacao)`.
- Validar obrigatoriamente:
  - conta de energia anexada (`energy.hasUrl`)
  - documento frente anexado (`personalDoc.hasFront`)
  - documento verso anexado quando não for CNH (`personalDoc.hasBack`)
- Se faltar qualquer um, tentar `reconcileUpload` e verificar novamente.
- Se ainda faltar, **não seguir como sucesso silencioso**: lançar erro `PORTAL_ATTACHMENTS_NOT_CONFIRMED`.

Resultado esperado: não vai mais dizer que o cadastro está ok se o Portal não confirmou conta/documento.

### 2. Salvar evidência do anexo no banco e na auditoria

Ainda no `portal2-api-client.mjs` e `worker-portal-2/server.mjs`:

- Persistir no `portal2_ocr_doc_result` / `portal2_ocr_bill_result` ou no `result.extraction.upload` um resumo claro:
  - `docFront: true/false`
  - `docBack: true/false`
  - `energy: true/false`
  - `idsolcontratovalidacao`
- Quando falhar, gravar `portal2_error_kind = attachment_not_confirmed` e `portal2_error` com o motivo.

Resultado esperado: pelo painel/logs será possível saber se foi só OCR ou se o Portal confirmou anexo real.

### 3. Corrigir OTP: 502 do worker não pode travar cliente

No `supabase/functions/submit-otp/index.ts`:

- Se `/confirm-otp` responder `502/503/504` ou HTML (`<!DOCTYPE`), tratar como instabilidade do worker, não como erro definitivo.
- Gravar `last_otp_dispatch_error`, mas retornar sucesso em modo `polling` para o watchdog continuar tentando.

No `supabase/functions/portal-otp-watchdog/index.ts`:

- Não incrementar `portal_retry_count` para 502/503/504/HTML/timeout.
- Só contar retry para erro real da iGreen, como código inválido/expirado.
- Continuar tentando quando o worker voltar.

Resultado esperado: quando a cliente digitar o OTP, o sistema vai insistir em digitar no portal automaticamente; não vai abandonar por proxy 502.

### 4. Corrigir coluna errada no worker

No `worker-portal-2/server.mjs`:

- Remover o update em `portal2_otp_last_error`, pois essa coluna não existe.
- Usar `last_otp_dispatch_error`, que existe.

Resultado esperado: erro real do OTP fica registrado e não some silenciosamente.

### 5. NAO MEXER Na Gislaine ( EU JA FINALIZEI )

&nbsp;

## Arquivos envolvidos

- `worker-portal-2/portal2-api-client.mjs`
- `worker-portal-2/server.mjs`
- `supabase/functions/submit-otp/index.ts`
- `supabase/functions/portal-otp-watchdog/index.ts`

## O que não vou assumir mais

- Não vou considerar “anexado” só porque existe URL no Supabase.
- Só vou considerar anexado quando o `verifyUpload` do Portal confirmar.
- O cadastro não deve continuar como sucesso quando conta/documento não forem confirmados no Portal.
# Portal 2 — Veredito dos Extractors (IA de validação de documento + conta)

> ## ⚠️ ATUALIZAÇÃO 2026-07-13 — correção importante
>
> Este doc (2026-05-31) mapeou o `extract-receipt` achando que era o OCR da
> conta de energia. **ERRADO**: o bundle oficial provou que `extract-receipt`
> é SÓ para **comprovante bancário de débitos em aberto** — fatura legítima
> enviada nele retorna `is_authentic=false` ("é fatura, não comprovante"),
> o que causou o bug `IA_REPROVADA_CONTA` em produção (caso José, jobs 69–72).
>
> **A fatura usa `POST /extractor/extract`** (sem `is_authentic`; gate de
> legibilidade `fz` = ≥2 de 4 campos). Fonte da verdade atualizada:
> **`worker-portal-2/PORTAL-OFICIAL.md`**. As seções abaixo permanecem como
> histórico — ler com essa correção em mente.

**Status:** ✅ Schema capturado de chamadas REAIS em 2026-05-31 (Task 1 da investigação "aviso de aprovação/reprovação").
**Como foi descoberto:** `worker-portal-2/probe-extractor.mjs` + `probe-doc-field.mjs` (scripts de sondagem; não criam cliente, só rodam OCR/validação).

> **Pergunta que originou isto:** "no portal manual, quando faz upload/digita, a IA deles diz se foi aprovado ou reprovado pra seguir com aprovação humana. Teremos esse aviso na integração via API?"
>
> **Resposta:** SIM — a API **devolve** o veredito. Hoje o worker **descarta** essa resposta (fire-and-forget). Este doc mapeia os campos pra podermos gatear o fluxo.

---

## 1) `POST /extractor/init-validation`

Abre a sessão de validação. Sem corpo.

```json
{ "success": true, "idsolcontratovalidacao": 369132 }
```

`idsolcontratovalidacao` amarra as chamadas seguintes (documento + conta) à mesma análise.

---

## 2) `POST /extractor/extract-document` (RG/CNH)

**⚠️ Campo multipart correto = `files`** (NÃO `file`). Enviar `file` retorna
`400 { "message": "Unexpected field - file" }`. O `extract-receipt` usa `file`;
o `extract-document` usa `files`. **Hoje o `portal2-api-client.mjs` envia `file`
para os dois → o extract-document SEMPRE falha em produção** (cai no `manualFallback`).

Campos: `files` (binário), `idsolcontratovalidacao` (string), opcional `pdf_password`.

### Resposta (200/201) — exemplo real (CNH):

```json
{
  "success": true,
  "data": {
    "nome": "VIVIANE APARECIDA DO CARMO",
    "cpf": "160.024.568-48",
    "data_nascimento": "16/10/1974",
    "validade": "31/08/2031",
    "tipo_documento": "CNH",
    "analfabeto": false,
    "motivo_analfabeto": null
  },
  "raw": "```json\n{ ... }\n```",
  "error": null,
  "duration_ms": 7135,
  "corrections": [],
  "idsolcontratovalidacao": 369141
}
```

### Campos de veredito / qualidade:
| Campo | Significado | Uso pro gate |
|-------|-------------|--------------|
| `success` | extração rodou | `false` ⇒ reprovado |
| `error` | mensagem de erro (null = ok) | non-null ⇒ reprovado |
| `corrections` | ajustes que a IA aplicou (array) | non-vazio ⇒ revisar |
| `data.tipo_documento` | RG / CNH detectado | conferir vs `document_type` do customer |
| `data.validade` | validade do documento | vencido ⇒ reprovar |
| `data.nome` / `data.cpf` | titular do documento | **cross-check com a conta** (ver §4) |

---

## 3) `POST /extractor/extract-receipt` (conta de energia / boleto)

Campo multipart = `file` (este aceita `file`). Campos: `file`, `idsolcontratovalidacao`, opcional `pdf_password`.

### Resposta (200/201) — exemplo real (era um BOLETO, não fatura):

```json
{
  "success": true,
  "data": {
    "nome": "BENEDITA DE JESUS GALVAO",
    "documento": null,
    "valor_pago": 301.48,
    "tipo_comprovante": "BOLETO",
    "beneficiario": "CPFL Companhia Paulista de Forca e Luz",
    "data_pagamento": "09/04/2026",
    "banco": "BANCO 001",
    "codigo_autenticacao": "…",
    "authenticity_signals_count": 3
  },
  "raw": "{ … }",
  "error": null,
  "duration_ms": 5208,
  "corrections": [],
  "matched": null,
  "debt_total": null,
  "receipt_total": null,
  "idsolcontratovalidacao": 369132,
  "is_authentic": true,
  "rejection_reason": null,
  "cross_validation": null
}
```

### Campos de veredito / qualidade (ESTE é o "aprovado/reprovado"):
| Campo | Significado | Uso pro gate |
|-------|-------------|--------------|
| `is_authentic` | **veredito de autenticidade da IA** (true/false) | `false` ⇒ **REPROVADO** → revisão humana |
| `rejection_reason` | motivo da reprovação (null quando aprovado) | non-null ⇒ mostrar pro humano |
| `authenticity_signals_count` | nº de sinais de autenticidade detectados | baixo ⇒ confiança menor |
| `cross_validation` | resultado do cruzamento doc×conta×cadastro (null no exemplo) | inspecionar quando preenchido |
| `matched` | se bateu com algo esperado (null no exemplo) | inspecionar |
| `tipo_comprovante` | `BOLETO` vs fatura | BOLETO **não tem** `consumomedio` |
| `success` / `error` | extração rodou | `success=false` ou `error` ⇒ reprovado |

---

## 4) Sinais para o gate de "aprovação humana"

Combinação que deve **pausar** o cadastro (status `pending_human_review`) em vez
de seguir pro `POST /customers`:

1. **`extract-receipt.is_authentic === false`** → conta reprovada pela IA deles. `rejection_reason` traz o motivo.
2. **`extract-receipt.success === false`** ou **`error` non-null** → falha de extração.
3. **`extract-document.success === false`** ou **`error` non-null** → documento ilegível/recusado.
4. **Divergência de titular (cross-check nosso):** `extract-document.data.nome` ≠ `extract-receipt.data.nome`.
   - No probe real isso aconteceu: documento = "VIVIANE APARECIDA DO CARMO", conta = "BENEDITA DE JESUS GALVAO". Esse é exatamente o caso que o operador humano precisa olhar.
5. **`extract-document.data.validade` vencida.**
6. **`corrections` não-vazio** ou **`authenticity_signals_count` baixo** → confiança reduzida (warning, não bloqueio rígido).

`cross_validation` e `matched` vieram `null` neste caso (boleto sem cruzamento).
Vale capturar mais amostras (fatura real + RG) pra ver esses campos preenchidos
antes de definir regra rígida em cima deles.

---

## 5) Bugs/achados desta sondagem

- **BUG CORRIGIDO (2026-05-31):** `extract-document` exige o campo multipart
  `files` (multer `.array`), mas os clients enviavam `file` → resposta
  `400 "Unexpected field - file"`. Logo, **toda** chamada de `extractDocument`
  falhava e caía no `manualFallback` — ou seja, a IA deles **nunca chegava a ler
  o documento** e o cadastro ia pro preenchimento manual mesmo com foto boa.
  Fix aplicado em `worker-portal-2/portal2-api-client.mjs` e
  `worker-portal/portal2-api-client.mjs` (param `fileField`, com `extractDocument`
  usando `'files'`). **Validado em chamada real**: agora retorna `success: true`
  com `data` extraída (nome/cpf/nascimento/validade/tipo_documento).
  `extract-receipt` continua usando `file` (correto).
- A resposta do extractor ainda **não é capturada nem persistida** no fluxo de
  cadastro (`cadastrarCliente` faz `await` e descarta o retorno). Próximo passo
  pra ter o "aviso": persistir `success`/`data`/`is_authentic`/`rejection_reason`
  e usar pra decidir auto-extração vs. manual.

## 6) Como reproduzir

```bash
cd worker-portal-2
# .env precisa de SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (lê os anexos)
node probe-extractor.mjs [customer_id]     # documento(file/files) + conta
node probe-doc-field.mjs [customer_id]     # varre nome de campo do extract-document
```

Customer de referência: `6d839c38-…` (tem CNH frente + conta, ambos JPEG inline).

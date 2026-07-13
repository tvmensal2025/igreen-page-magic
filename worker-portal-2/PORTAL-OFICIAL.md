# Portal iGreen (autoconexão) — Mapa OFICIAL da API e do fluxo

> **Fonte da verdade** do cadastro no Portal 2. Tudo aqui foi confirmado por
> engenharia reversa do bundle oficial + probes ao vivo contra a API real.
> **Antes de mudar qualquer coisa no fluxo de cadastro, leia este arquivo.**
>
> Última validação completa: **2026-07-13**
> Bundle analisado: `https://green.igreenenergy.com.br/autoconexao/assets/index-CmAOjN-p.js`
> (o hash muda a cada deploy deles — ver seção "Como revalidar" no fim)

---

## 1. Infra e autenticação

| Item | Valor |
|---|---|
| Landing | `https://green.igreenenergy.com.br/autoconexao/?id=<idconsultor>` |
| API base | `https://api-green-connection.igreenenergy.com.br` |
| Auth | HMAC-SHA256 por request (headers `x-frontend-app-id`, `x-frontend-timestamp`, `x-frontend-signature`) |
| App id / secret | constantes `APP_ID` / `SECRET` em `portal2-api-client.mjs` (extraídas do bundle) |
| Assinatura | `HMAC(secret, "METHOD\npathname\ntimestamp-ISO\nAPP_ID")` — ver `signRequest()` |
| Cloudflare | requests saem por uma page Playwright (tunnel TLS); 1ª chamada ~5s, demais 40–800ms |

## 2. Endpoints (todos confirmados ao vivo)

### Sessão de validação
| Endpoint | Uso |
|---|---|
| `POST /extractor/init-validation` | Abre sessão. Retorna `{ idsolcontratovalidacao }` — **todas** as chamadas de OCR/upload seguintes referenciam esse id. |

### OCR / validação de arquivos
| Endpoint | Serve para | Campo do arquivo | Fields extras | Retorno relevante |
|---|---|---|---|---|
| `POST /extractor/validate/upload` | Gate de qualidade de **FOTO** (`context=document\|invoice\|receipt`) | `file` | `context`, `idsolcontratovalidacao` | `{ is_valid, score, checks[] }` |
| `POST /extractor/extract-document` | OCR do **documento pessoal** (CNH/RG) | **`files`** | `idsolcontratovalidacao`, `save_target?` | `{ success, data:{nome,cpf,validade,tipo_documento,...}, raw, error }` |
| `POST /extractor/extract` | OCR da **FATURA de energia** ← passo 2 oficial | **`files`** | `concessionaria_id` (pode ser `''`), `personal_doc_name`, `file_type` (`pdf`\|`image`), `pdf_password?`, `idsolcontratovalidacao` | ver §3 |
| `POST /extractor/extract-receipt` | OCR de **COMPROVANTE BANCÁRIO** — **SÓ para débitos em aberto** | `file` | `idsolcontratovalidacao`, `invoice_context`, `debt_mes_ano`, `pdf_password?` | `{ success, is_authentic, rejection_reason, data:{nome,valor_pago,...} }` |
| `POST /contract-validation/manual-fallback` | Fila humana (até 5 dias). No oficial **só** roda quando o usuário clica "Continuar manualmente". **Nunca chamar em timeout.** | — | `idsolcontratovalidacao`, `originStep`, `lastError` | — |

### Anexos do dossiê (obrigatórios pro cadastro valer)
| Endpoint | Uso |
|---|---|
| `POST /file-upload/registration?fileType=&idsolcontratovalidacao=` | Anexo físico (params na **query string**, arquivo no campo `file`). `fileType` ∈ `personal-doc-front`, `personal-doc-back`, `energy-bill`, `energy-bill-2`, `payment-proof` (débitos), `cnpj-card`, `social-contract`, `statute`, `procuration`, `procurator-personal-doc`, `witness-doc-front/back`. Retorna `fileId`. Sem esse upload o cadastro nasce `documentos_enviados='F'` → conferência humana de dias. |
| `GET /file-upload/verify/{idsol}` | Confirma anexos: `{ personalDoc:{exists,hasFront,hasBack}, energy:{hasUrl}, receipts:[] }`. O oficial re-checa em loop e usa reconcile se falhar. |
| `POST /file-upload/reconcile/{idsol}` | Recuperação quando o verify não confirma. |

### Cliente / regras / OTP
| Endpoint | Uso |
|---|---|
| `GET /document-lookup?document=<cpf>` | `{ success, data:{name, birthDate,...} }` — prefill por CPF |
| `GET /customers/check-exists?email&document&idconsultor` | `{ exists, consultantConflict }` — email/CPF já cadastrado |
| `GET /customers/check-installation?numinstalacao&concessionaria&uf` | instalação duplicada |
| `GET /customers/check-consultant?document&idconsultor` | conflito de consultor |
| `GET /bonus/states` / `GET /bonus/distributors?uf` | cobertura (fonte das tabelas `CITY_HINT`/`UF_DEFAULT` do client) |
| `GET /bonus/rules?uf&concessionaria&consumo_medio` | regras ativas → `fornecedora`, `desconto_cliente` |
| `POST /customers` | Cria o cliente (payload em §6). Retorna `idcliente`. |
| `POST /customers/:id/terms-acceptance` | Aceite de termos |
| `POST /verification-codes/generate` `{ idcliente }` | **Dispara OTP no WhatsApp do cliente** ⚠️ |
| `POST /verification-codes/validate` `{ idcliente, code }` | Valida OTP |
| `GET /verification-codes/status/:idcliente` | Status do OTP |
| `GET /contracts/customer/:id/generated` / `/signed` | Contrato |
| `GET /consultants/:id/license` | Licença do consultor |

## 3. OCR da fatura (`/extractor/extract`) — shape e regra de legibilidade

Resposta:

```jsonc
{
  "success": true,
  "data": {
    "nome_cliente": "JOSE GONCALVES DE OLIVEIRA",
    "num_instalacao": "13290207",
    "mes_referencia": "06/2026",
    "valor_fatura": 254.31,
    "lista_consumo": [ { "consumo": 128 }, ... ],   // 12-13 meses
    "concessionaria": "CPFL PAULISTA",
    "debitos_em_aberto": [ ... ],                    // dispara o passo de comprovante
    "baixa_renda_evidencia": ..., "alta_tensao_evidencia": ...  // flags de tarifa
  },
  "detected_concessionaria_id": "cpfl",
  "name_validation": { "match": true, "corrected_name": null, "warning": null },
  "sections_to_recapture": []
}
```

**Regra `fz` de legibilidade (gate oficial, extraída do bundle):**

```js
uz = ["nome_cliente", "num_instalacao", "mes_referencia", "valor_fatura"]
dz = 2
fz(data) = count(campos de uz preenchidos) >= dz   // senão: "conta ilegível" → BLOQUEIA
```

(`uz`/`dz`/`fz` são nomes minificados — mudam a cada build deles. Pra achar de
novo: grep por `"nome_cliente","num_instalacao"` ou `useStepInvoice`.)

- `success=false` com `error` tipo `quality_validation_failed_no_concessionaria`
  = arquivo errado/ilegível (visto ao vivo mandando um RG no slot da fatura).
- **NÃO retorna `is_authentic`** — autenticidade é veredito exclusivo do
  `extract-receipt` (comprovantes).
- `name_validation.match=false` no oficial **não bloqueia**: força
  `transferir_titularidade=true` (função `vz` do bundle).
- Consumo médio no oficial = **média simples da `lista_consumo`** (um hook
  filtra meses >70 kWh só pro cálculo de bônus).
- PDFs **não passam** pelo `validate/upload` (só fotos; o endpoint responde
  500 pra PDF).

## 4. Fluxo oficial da UI (5 passos) e gates

1. **Documento** — foto/PDF CNH ou RG → `validate/upload(document)` (foto) →
   `extract-document` → usuário confirma dados. Ilegível → re-envio.
2. **Conta de luz** — `extract` → gate `fz` (≥2 campos) → prefill de endereço,
   instalação, consumo. `debitos_em_aberto` → pede **comprovante** →
   `extract-receipt` (`is_authentic` decide) → slot `payment-proof`.
3. **Dados/endereço** — ViaCEP + `check-exists`/`check-installation`.
4. **Contrato** — radio **"Forma de cobrança"**: `Boleto Único` ⇔
   `contaunica=true` (⚠️ **só preferência de cobrança** — muda o TEXTO do
   contrato `singleContract` vs `twoInvoices`; **NÃO muda anexos**).
5. **OTP** — `verification-codes/generate` → cliente digita código.

Em paralelo: `file-upload/registration` anexa `personal-doc-front/back` +
`energy-bill`; `verify` confirma; sem anexos confirmados o cadastro não vale.

## 5. Espelhamento no nosso worker

| Regra oficial | Onde espelhamos |
|---|---|
| Fatura → `/extractor/extract` | `extractInvoice()` no client; OCR do `server.mjs` |
| `fz` ≥2/4 campos senão bloqueia | `evaluateIaGate` → `IA_CONTA_ILEGIVEL`; `evaluateBill` (modo auto/manual) — `portal-errors.mjs` |
| `is_authentic` só comprovante | gate `IA_REPROVADA_CONTA` só dispara com `is_authentic===false` explícito |
| slot `energy-bill` = fatura sempre | `server.mjs` (boleto anexado é só fallback sem fatura) |
| `contaunica` = preferência de cobrança | payload `contaunica`/`transferir_titularidade`; ficha NÃO exige foto de boleto (`portalValidation.ts` front+Deno) |
| média da `lista_consumo` | `_kwhFromInvoiceResponse` (`server.mjs`) |
| `num_instalacao` do OCR | preenchido+persistido quando faltava (`server.mjs`) |
| validate só em foto | `runValidate` pula PDF (`cadastrarCliente`) |
| timeout/transporte não bloqueia | `__transport_error` → modo manual observacional, cadastro segue |
| manual-fallback só por escolha humana | **removido** dos catch de timeout |

Gates que **bloqueiam** o `POST /customers` (→ `needs_human`, classe `ia_reprovada`):
`IA_REPROVADA_CONTA` (comprovante reprovado), `IA_CONTA_ILEGIVEL` (fatura <2 campos
ou success=false), `IA_REPROVADA_DOC`, `IA_DOC_VENCIDO`, `IA_TITULAR_DIVERGENTE`.

## 6. Payload do `POST /customers` (ver `montarPayloadCadastro`)

Campos principais: `idconsultor`, `numinstalacao`, `cpf_cnpj`, `nome`, `dtnasc`
(ISO), `celular` (`(dd) 9xxxx-xxxx`), `email`, `cep` (`xxxxx-xxx`), endereço,
`concessionaria`, `fornecedora`, `consumomedio`, `desconto_cliente`,
`possui_placas`, **`contaunica`**, **`transferir_titularidade`**, `sendcontract`,
`logindistribuidora`, `senhadistribuidora`, `indcli`, `idsolcontratovalidacao`,
`orgaoexpedidor?`, PJ (`cnpj`, `razao`, ...) e procurador (`testemunha_*`).

## 7. Armadilhas históricas (não repetir!)

| Data | Erro | Sintoma | Correção |
|---|---|---|---|
| 2026-07 | Fatura mandada pro `extract-receipt` | `IA_REPROVADA_CONTA: "é uma fatura CPFL, não um comprovante"` em TODA conta legítima (caso José, jobs 69–72) | fatura → `/extractor/extract` |
| 2026-07 | Regra inventada: "boleto único exige comprovante bancário" | lead travado pedindo boleto que não existe | `contaunica` é só cobrança; slot é sempre a fatura |
| 2026-07 | Gate `is_authentic` aplicado à fatura | contas legítimas → `needs_human` | `is_authentic` só existe em comprovante |
| 2026-07 | Sem gate de legibilidade após remover `is_authentic` | conta ilegível/arquivo errado passaria pro POST | espelho da regra `fz` (`IA_CONTA_ILEGIVEL`) |
| 2026-07 | `manual-fallback` chamado em timeout | matava a validação instantânea | só o usuário aciona fallback no oficial |
| 2026-05 | `extract-document` com campo `file` | `400 Unexpected field` silencioso → todo doc caía em fallback manual | o campo é **`files`** (idem `extract`); `extract-receipt` usa `file` |
| anterior | `slice(-11)` em WhatsApp 12 dígitos | DDD errado (bug Osmar) | `formatPhone` normaliza DDI 55 |

## 8. Como revalidar quando algo mudar

```bash
# 1. Baixar o bundle atual (o hash muda a cada deploy deles)
curl -s 'https://green.igreenenergy.com.br/autoconexao/' | grep -o 'assets/index-[^"]*\.js'
curl -s 'https://green.igreenenergy.com.br/autoconexao/assets/index-XXXX.js' -o /tmp/igreen-js/index.js
# Âncoras úteis pra grep: 'uz=[' (campos fz), 'dz=' (limiar), 'extract-receipt',
# 'singleBoleto', 'contaunica', 'payment-proof', 'manual-fallback'

# 2. Probes reais (sem POST, sem OTP) — precisam de /tmp/igreen-probe.env
#    (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)
source /tmp/igreen-probe.env
node _truth-real-cadastro.mjs <customer_id> --no-post   # fluxo completo, veredito wouldPost
node _probe-gate-conta-ilegivel.mjs <customer_id>        # contraprova: doc no slot da fatura → deve BLOQUEAR

# 3. Testes unitários (gates, classificação, extração)
node --test test/
```

**Regra de ouro:** desconfiou do comportamento? NÃO chute — rode o probe ou
leia o bundle. Cada regra deste arquivo tem uma âncora verificável.

# Portal 2 — Fluxo de Cadastro Canônico (validado em produção)

> ## ⚠️ ATUALIZAÇÃO 2026-07-13 (v2) — OCR da fatura mudou de endpoint
>
> O passo 2 abaixo (`extract-receipt` para OCR da fatura) estava **errado** e
> causava `IA_REPROVADA_CONTA` em contas legítimas. Correções vigentes:
>
> - **Fatura → `POST /extractor/extract`** (shape: `nome_cliente`,
>   `num_instalacao`, `lista_consumo`, `valor_fatura`, `mes_referencia`,
>   `detected_concessionaria_id`, `name_validation`). `extract-receipt` é SÓ
>   comprovante bancário de débitos.
> - **Consumo médio**: 1) `media_consumo`, 2) **média da `lista_consumo`**,
>   3) estimativa por tarifa (inalterada).
> - **Distribuidora por OCR**: campo `concessionaria`/`detected_concessionaria_id`
>   da resposta do `extract` (não mais `beneficiario`).
> - **Gate pré-POST**: fatura ilegível (<2 de 4 campos-chave — regra `fz` do
>   oficial) bloqueia com `IA_CONTA_ILEGIVEL` → `needs_human`.
> - **`contaunica` ("Boleto Único")**: só preferência de cobrança no payload —
>   NÃO troca o anexo do slot `energy-bill` (sempre a fatura).
>
> Fonte da verdade completa: **`worker-portal-2/PORTAL-OFICIAL.md`**.

**Versão:** v2 (v1 abaixo mantida como histórico)
**Data validação:** 2026-05-29
**Trace ID oficial:** `e923a09c-abba-4ae1-a256-80e97094f686`
**Customer de referência:** `482c0262-e5e0-4716-82f1-f3f4528b2e79` (PAULO ROBERTO FIGUEIREDO / Salto-SP)
**Auditoria IA:** habilitada (10 primeiros cadastros), confirmou que o último erro era apenas duplicidade esperada

> Este documento é a **referência oficial** do payload e das decisões automáticas do worker-portal-2. Se o fluxo abaixo continuar valendo, **não precisa re-mapear**. Quando algo mudar (novo campo obrigatório, novo erro de validação), incrementar a versão e atualizar.

## 1) Resolução automática (do customer no Supabase → payload iGreen)

### Distribuidora (concessionária)
Prioridade:
1. **CEP → ViaCEP → CITY_HINT[uf][cidade]** (mais confiável, sem OCR)
2. `customers.distribuidora` digitado, normalizado por `resolveConcessionaria`
3. OCR do `bill_base64` (campo `beneficiario` da resposta `/extractor/extract-receipt`), normalizado

UFs/cidades cobertas: SP/RJ/MG/RS/PR/MS via `CITY_HINT`; demais UFs via `UF_DEFAULT`. UFs sem cobertura iGreen (DF, AM, AP, AC, RO, RR) retornam `null` com `naoAtendida=true`.

**Validado:** Salto/SP `13323-630` → `CPFL PIRATININGA` ✓

### Consumo médio (kWh)
Prioridade:
1. `customers.media_consumo`
2. OCR `consumomedio` da resposta `/extractor/extract-receipt`
3. **Estimativa pela tarifa** (R$ 1,10/kWh, clamp 100..2000) quando OCR é boleto sem consumomedio

**Validado:** R$ 1576.34 ÷ 1.10 → `1751 kWh` (cai em todas regras tier A/B/C/D) ✓

### Fornecedora + Desconto
Vem de `/bonus/rules?uf=&concessionaria=&consumo_medio=`. Critério `_pickActiveBonusRule`:
- filtra `active=true` + janela validade + faixa kwh
- prefere `desconto_padrao=true` (tier A — desconto MAIS BAIXO da região, regra de negócio do cliente)
- fallback: menor `desconto_cliente` numérico

**Validado:** SP/CPFL PIRATININGA/1751kWh → `RZK` + `8%` (tier A) ✓

### Telefone (celular)
`formatPhone()` aceita 10/11 dígitos e remove DDI 55 quando presente (12 ou 13 dígitos começando com 55).
Saída obrigatória: 14 chars no formato `(DD) 9XXXX-XXXX`.

**Validado:** `5511971254913` → `(11) 97125-4913` ✓ (backend rejeita <14 chars)

### CEP
`formatCep()` insere hífen: 8 dígitos vira `XXXXX-XXX` (9 chars).

**Validado:** `13323630` → `13323-630` ✓

## 2) Sequência de chamadas (trace canônico)

| # | Método | Path | Quando | Decisão |
|---|--------|------|--------|---------|
| 1 | POST | `/extractor/init-validation` | quando há `bill_base64` ou `document_front_base64` | retorna `idsolcontratovalidacao` |
| 2 | POST | `/extractor/extract-receipt` | OCR da fatura/boleto | extrai `consumomedio` + `beneficiario` |
| 3 | POST | `/extractor/extract-document` | OCR do RG/CNH | opcional, só com `document_front_base64` |
| 4 | GET | `/customers/check-exists?email=&document=` | sempre | rejeita se já cadastrado e assinado |
| 5 | GET | `/bonus/distributors?uf=` | só se precisar resolver concessionária | resolve nome oficial |
| 6 | GET | `/bonus/rules?uf=&concessionaria=&consumo_medio=` | descobre `fornecedora` + `desconto_cliente` | aplica `_pickActiveBonusRule` |
| 7 | POST | `/customers` | payload completo | retorna `{idcliente}` |
| 8 | POST | `/customers/{id}/terms-acceptance` | aceite | best-effort |
| 9 | POST | `/verification-codes/generate` | dispara OTP via WhatsApp da iGreen | best-effort |

## 3) Payload final do POST /customers (validado)

```json
{
  "idconsultor": 124170,
  "numinstalacao": "2095093800",
  "cpf_cnpj": "<11 dígitos>",
  "nome": "PAULO ROBERTO FIGUEIREDO",
  "dtnasc": "1960-08-01",
  "celular": "(11) 97125-4913",
  "email": "rafael.iclous@gmail.com",
  "cep": "13323-630",
  "endereco": "AV VISC DE MAUA",
  "numero": "106",
  "complemento": "",
  "bairro": "JD STA CRUZ",
  "cidade": "SALTO",
  "uf": "SP",
  "concessionaria": "CPFL PIRATININGA",
  "fornecedora": "RZK",
  "consumomedio": 1751,
  "desconto_cliente": 8,
  "possui_placas": false,
  "contaunica": false,
  "transferir_titularidade": false,
  "sendcontract": true,
  "logindistribuidora": "",
  "senhadistribuidora": "",
  "indcli": 0
}
```

**Resposta esperada (200):** `{"idcliente": <numérico>, ...}`

## 4) Erros conhecidos do POST /customers (com mensagens reais)

| HTTP | code | field | causa | tratamento |
|------|------|-------|-------|------------|
| 400 | `error.generic.validationError` | `celular` | `Too small: expected string to have >=14 characters` — DDI 55 não removido | `formatPhone` agora trata DDI ✓ |
| 400 | `error.customer.duplicatePhone` | `celular` | celular já cadastrado em outro idcliente | **esperado em re-tentativas**; cliente já existe |
| 400 | `error.customer.duplicateDocument` | `cpf_cnpj` | CPF já cadastrado | nosso `checkCustomerExists` deveria pegar antes |
| 400 | `error.generic.validationError` | `cep` | `Too small: expected string to have >=9 characters` | `formatCep` insere hífen |

## 5) Link único pós-cadastro

Padrão canônico:
```
https://digital.igreenenergy.com.br/validacao-codigo/{idcliente}?id={idconsultor}&sendcontract=true
```
Esse mesmo link serve OTP, validação facial (Idwall) e assinatura do contrato.

## 6) Auditoria IA (PORTAL2_AI_AUDIT_LIMIT)

- Worker grava trace de cada um dos primeiros N (default 10) cadastros em `portal2_audit_traces`
- Edge function `portal2-ai-audit` chama Gemini com a chave da Supabase (sem expor no container)
- IA identificou **automaticamente** os 2 bugs reais nesta sessão:
  1. `celular` com 13 chars (DDI 55) → API exige >=14
  2. `/customers/check-exists` não verifica celular, só email+document → falsos positivos
- Custo médio: ~$0.0002/lead

Pra desligar quando estiver estável: `PORTAL2_AI_AUDIT_LIMIT=0` no env do container.

## 7) Como reverificar

Em caso de regressão, executar:

```bash
# 1. Pegar trace oficial do DB
SELECT trace, input_summary, last_step
  FROM portal2_audit_traces
 WHERE is_official_reference = true
 ORDER BY official_marked_at DESC
 LIMIT 1;

# 2. Comparar payload atual com o do trace canônico (campo a campo)
# 3. Se algo mudou no backend iGreen, gerar novo trace e atualizar este doc
```

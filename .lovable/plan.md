# Análise das perguntas repetidas — Lead BRUNO (bd64e790)

## O que aconteceu na conversa (timeline real)

```
04:52  Lead: "Quero cadastrar"
04:52  Bot:  pede DOCUMENTO (RG/CNH)               ← 1ª vez
04:52  Lead: envia doc → confirma
04:53  Bot:  ask_phone_confirm → ask_phone → ask_email
04:53  Lead: digita telefone + email
04:53  Bot:  ask_cep
04:54  Lead: digita CEP
04:54  Bot:  ask_number → ask_complement
04:54  Lead: digita número, "não tem"
04:54  Bot:  finalmente pede CONTA DE LUZ          ← tarde demais
04:54  Lead: envia conta → OCR roda
04:55  Bot:  simulação + "Quero me cadastrar"
04:55  Lead: confirma
04:55  Bot:  pede DOCUMENTO de novo                ← 2ª vez (repetida)
04:56  Lead: envia doc de novo → confirma → "mesma pessoa"
04:56  Bot:  ask_finalizar → portal_submitting
05:01  Worker: 404 "Consumo médio não informado"   ← já corrigido na sessão anterior
```

## Perguntas que NÃO precisavam ter sido feitas

A conta de luz, quando enviada, já tinha via OCR: nome, CEP, endereço, número, bairro, cidade, UF, distribuidora, nº instalação e valor. Mesmo assim o bot perguntou ao cliente:

1. **Documento (2x)** — pedido antes da conta E depois da simulação. A 2ª vez é redundante: `document_front_url` já estava preenchido.
2. **CEP, número, complemento** — perguntados antes da conta. Se a conta viesse primeiro, OCR + ViaCEP teriam resolvido tudo.
3. **Telefone/Email antes da conta** — ok perguntar, mas a ordem deixa o lead com 6 perguntas antes do upload mais importante.

## Causa raiz

O fluxo `bot_flow_steps` do consultor está dispatchando `capture_documento` (passo `d_pedir_documento` / `aguardando_doc_auto`) **antes** de `aguardando_conta`. Resultado:

- O bot pede dados que viriam de graça do OCR.
- Quando a conta chega, esses campos já foram preenchidos pelo lead e o OCR não sobrescreve.
- Depois da simulação o fluxo dispara `capture_documento` outra vez sem checar `document_front_url`.

## Plano de correção

### 1. `whapi-webhook/handlers/bot-flow.ts` + `evolution-webhook/handlers/bot-flow.ts`

**1a. Guard "documento já enviado"** — no case `ask_quero_cadastrar` e em qualquer dispatch de `capture_documento`/`aguardando_doc_auto`:

```ts
if (customer.document_front_url
    && (customer.document_type?.toLowerCase().includes("cnh") || customer.document_back_url)) {
  // pular direto pra confirmar_titularidade ou ask_finalizar
  step = getNextMissingStep(merged);
}
```

**1b. Guards de "já temos via OCR"** nos cases (espelhar o padrão já existente em `ask_bill_value`):

- `ask_cep`: se `customer.cep` válido (≠ termina em 000) e `address_street/city/state` → skip.
- `ask_number`: se `customer.address_number` → skip.
- `ask_complement`: se `address_complement !== null` → skip.
- `ask_installation_number`: se `numero_instalacao` ≥ 7 dígitos → skip.
- `ask_name`: se `name_source` ∈ {ocr_conta, ocr_doc, user_confirmed} e nome ≥ 5 chars → skip.

Cada skip chama `autoResolveCepIfNeeded` e avança o `conversation_step` sem reescrever o campo.

**1c. Re-entry idempotente** — antes de enviar o prompt de qualquer `ask_*`, rodar `getNextMissingStep(customer)`. Se o step pretendido não é mais o "missing", redireciona em vez de repetir a pergunta.

### 2. Ordem do fluxo (recomendado)

Mover `aguardando_conta` para **antes** de `capture_documento` no fluxo D do consultor (tabela `bot_flow_steps`). Isso garante que o OCR rode primeiro e elimine as perguntas determinísticas de endereço/valor/instalação. Faço a migration ajustando `position` dos passos do `consultant_id = 124170` (ou de todos os fluxos ativos, conforme aprovação).

### 3. Sinalização visual no log

Adicionar `console.log("[step-skip] motivo=ocr_already_filled step=ask_cep")` em cada guard, para auditoria.

## Validação

1. Reprocessar o lead `bd64e790` (já `retry_ready`, `media_consumo=1433`).
2. Criar lead de teste em sandbox e verificar que, após enviar conta, ele só responde 4 perguntas: nome (se faltar), CPF, RG/CNH+nascimento e e-mail; nunca CEP/número/complemento/instalação/valor.
3. Confirmar que `document_front_url` preenchido faz o bot pular o segundo `aguardando_doc_auto`.

## O que NÃO está no escopo

- Mudar o prompt do OCR (já foi feito).
- Alterar lógica do worker portal-2 (já blindada com fallback de consumo).

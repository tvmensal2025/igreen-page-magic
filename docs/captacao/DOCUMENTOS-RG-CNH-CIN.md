# Documentos de identidade — RG antigo, RG novo/CIN e CNH

**Data:** 2026-07-16  
**Status:** regra de produto mapeada e aplicada no bot/validador  
**Código canônico:** `supabase/functions/_shared/document-type.ts`

---

## 1. Resumo (o que o time precisa saber)

| Tipo | Frente | Verso | Nº Registro Geral (RG) | Identidade principal |
|------|--------|-------|------------------------|----------------------|
| **CNH** | Obrigatória | Não pede | Opcional / legado | **CPF** |
| **RG antigo** | Obrigatória | **Obrigatório** | **Obrigatório** (`ask_rg` se OCR falhar) | CPF + nº RG |
| **RG novo / CIN (2026+)** | Obrigatória | **Obrigatório** | **NÃO pedir** — documento **não tem** nº RG estadual | **Só CPF** |

> **Regra de ouro 2026:** no RG novo / Carteira de Identidade Nacional (CIN) **não existe número de RG estadual impresso**. O documento traz **CPF**. O bot **não pode** ficar perguntando “Qual o seu RG?”.

---

## 2. Valores canônicos no sistema

```ts
"cnh" | "rg_novo" | "rg_antigo"
```

Helpers:

| Função | Uso |
|--------|-----|
| `normalizeDocumentType()` | Qualquer string → canônico |
| `isCNH()` | Sem verso |
| `isRgNovo()` | CIN / RG novo |
| `requiresVerso()` | Todos os RGs (não CNH) |
| `requiresRgNumber()` | **false** só em `rg_novo` |
| `portalSelectLabel()` | `"CNH"` / `"RG (Novo)"` / `"RG (Antigo)"` |

Aliases de `rg_novo`: `cin`, `rg novo`, `identidade nova`, `carteira de identidade nacional`.

---

## 3. Mapa do fluxo (WhatsApp / bot)

```
Foto frente
    → detectDocumentTypeDetailed (detect-doc-type.ts)
    → CNH?  → verso = nao_aplicavel → OCR frente → CPF obrigatório
    → RG?   → pede VERSO → OCR frente+verso
                → rg_antigo: grava nº RG se ≠ CPF; se faltar → ask_rg
                → rg_novo:   NÃO grava RG se == CPF; NÃO chama ask_rg
```

Arquivos-chave:

- Classificação: `supabase/functions/_shared/detect-doc-type.ts`
- Tipo: `supabase/functions/_shared/document-type.ts`
- OCR: `supabase/functions/_shared/ocr.ts` (já documenta CPF na frente do RG novo/CIN)
- Próximo passo: `getNextMissingStep` em `conversation-helpers.ts` — **só** `ask_rg` se `requiresRgNumber(document_type)`
- Validação portal: `validators.ts` — **não** exige campo RG para `rg_novo`
- Webhooks: `whapi-webhook/handlers/bot-flow.ts`, `evolution-webhook/handlers/bot-flow.ts`  
  (já tinham fix: não gravar `rg` quando dígitos == CPF)

---

## 4. O que o OCR lê

- Nome, CPF, RG (só se for nº real ≠ CPF), data nascimento, filiação
- RG antigo: nº RG costuma estar no **verso**
- RG novo/CIN: **CPF na frente**; campo “RG” do OCR costuma vir vazio ou repetir CPF → **descartar**

---

## 5. Bug encontrado e correção (2026-07-16)

**Problema:** `getNextMissingStep` fazia `if (!c.rg) return "ask_rg"` **sempre**, inclusive com `document_type = rg_novo`.  
Cliente com CIN/RG 2026 (só CPF) ficava em loop pedindo RG inexistente.

**Correção:**

1. `requiresRgNumber()` → `false` para `rg_novo`
2. `getNextMissingStep` só pede RG se `requiresRgNumber(document_type)`
3. `validateForPortal` / `validators.ts` não exige RG para `rg_novo`

---

## 6. Multicanal / textos

Passo documento (a7): pedir **CNH = frente** · **RG = frente e verso**.  
Não misturar “frente e verso se possível”.

E-mail (a7/passo 7): padrão fluxo D (`ask_email` / iGreen Club).

Após telefone: **9 = portal + digitar OTP** → **10 = link da facial** (facial nunca antes do OTP). Sem passos 9a/9b de transferência.

---

## 7. Riscos residuais

1. Classificador marcar **RG antigo como CNH** → pula verso (risco).
2. Classificador marcar **RG novo como antigo** → pode pedir RG à toa (ruído; aceitável vs deixar sem verso).
3. Ficha Club (`clubValidation`) ainda lista RG como required — revisar se Club também aceitar CIN só com CPF.
4. Confirmação visual às vezes mostra `RG: —` em CNH/RG novo — cosmético.

---

## 8. Checklist de aceite

- [ ] Lead com **RG antigo** sem nº no OCR → bot pergunta RG uma vez
- [ ] Lead com **RG novo/CIN** só com CPF → bot **não** pergunta RG
- [ ] Lead com **CNH** → só frente; CPF obrigatório
- [ ] Portal recebe `document_type` = `RG (Novo)` e CPF válido sem campo RG preenchido
- [ ] OCR nunca persiste `rg === cpf`

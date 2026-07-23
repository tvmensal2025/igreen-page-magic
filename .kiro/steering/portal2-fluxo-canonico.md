---
inclusion: fileMatch
fileMatchPattern:
  - "worker-portal-2/**"
  - "supabase/functions/portal2-*/**"
  - "supabase/functions/_shared/portal-worker.ts"
  - "supabase/functions/_shared/portalValidation.ts"
  - "src/lib/captacao/portalValidation.ts"
  - "docs/portal-api/**"
  - "supabase/functions/finalize-capture/**"
  - "supabase/functions/submit-otp/**"
  - "supabase/functions/worker-callback/**"
---

# Portal 2 — Fluxo de cadastro canônico

**Última validação:** 2026-05-29 · Doc: #[[file:worker-portal-2/PORTAL-OFICIAL.md]]  
Trace: `portal2_audit_traces` onde `is_official_reference = true`  
Deploy do monorepo: `tvmensal2025/igreen-page-magic` (ver `#deploy`).

## Fatos de ouro (violar = quebrar produção)

1. Fatura → `POST /extractor/extract` (`files`). **Nunca** `extract-receipt` (só comprovante; causa `IA_REPROVADA_CONTA`).
2. `is_authentic` só em comprovante. Fatura = legibilidade ≥2 de 4 campos (`evaluateIaGate` / `IA_CONTA_ILEGIVEL`).
3. `contaunica` = forma de cobrança; slot `energy-bill` **sempre** fatura (não exigir boleto bancário).
4. `name_validation.match=false` → `transferir_titularidade=true` (não bloqueia).
5. `validate/upload` só FOTO (PDF → 500).
6. `manual-fallback` só escolha humana — nunca timeout/transporte.
7. `POST /verification-codes/generate` manda OTP no WA — não disparar em teste.

## Canônico operacional
- Distribuidora: CEP → ViaCEP → CITY_HINT
- Consumo: `media_consumo` → OCR → estimativa R$÷1,10/kWh (clamp 100..2000)
- Bonus: `desconto_padrao=true` (tier A = **menor** desconto — pedido do cliente)
- Telefone: `formatPhone` tira DDI 55 → `(DD) 9XXXX-XXXX`
- CEP: `formatCep` → `XXXXX-XXX`
- Dispatch: `dispatchPortalWorker` → worker-portal-2 (Portal 1 morto)

## Cobertura
iGreen **não** atende: ENEL SP capital+GSP, EDP Vale, LIGHT RJ, DF, AM, AP, AC, RO, RR → `{naoAtendida:true}`.

## Auditoria IA
`PORTAL2_AI_AUDIT_LIMIT` (default 10); `=0` desliga.

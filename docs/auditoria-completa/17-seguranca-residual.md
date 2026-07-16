# 17 — Segurança residual (RLS / DEFINER / CORS / PII)

**Data:** 2026-07-16  
**Complementa:** `07-banco-migrations-rls.md`

---

## 1. SECURITY DEFINER

| Métrica (heurística 2026-07-16) | Valor |
|---|---|
| DEFINER com `SET search_path` na janela | ~240 |
| DEFINER sem search_path | **1** → `get_referral_partner_metrics` |

**Correção Onda 4:** `SET search_path = public` na function (migration `20260716130000_onda4_security_perf.sql`).

---

## 2. Policies `USING(true)`

~65 ocorrências em migrations. Maioria:

- `service_role` full access (esperado)
- Catálogos públicos / tour / municípios (baixo risco)
- **Problema:** `daily_reheat_queue` e `daily_reheat_runs` legíveis por qualquer `authenticated` (vazamento de `customer_id` / ops)

**Correção Onda 4:**

- queue → `consultant_id = auth.uid()` OR admin  
- runs → só admin  

`automation_toggles` / `daily_reheat_settings` com SELECT amplo: só flags booleanas (aceitável; manage já é admin).

---

## 3. CORS

- Helper seguro: `_shared/cors.ts` (`buildCors` + allowlist).  
- ~104 EFs ainda usam `Access-Control-Allow-Origin: *` (legado).  
- **Plano:** migrar senders/admin EFs para `buildCors` gradualmente — sem big-bang (quebra previews/landings se errar).

Não alterado em massa nesta onda (risco UI).

---

## 4. PII em sessionStorage

| Local | Antes | Depois (Onda 4) |
|---|---|---|
| `Admin.tsx` customers_cache | JSON completo (phone, CPF, e-mail, endereço) | Campos de UI sem PII sensível |
| `NetworkPanel.tsx` | phone + data_nascimento | nullificados no cache |

Outros usos (subtab voz, solar snapshot id, flags UI) — baixo risco.

---

## 5. Webhooks / crons (resumo)

Ver Ondas 2–3: Evolution enforce com secret; Whapi + crons em grace até flags `ENFORCE_*`.

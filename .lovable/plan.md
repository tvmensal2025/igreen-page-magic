# Plano: Fechar 100% dos ajustes pendentes

Objetivo: aplicar as 4 mudanças já feitas (mas não deployadas) e validar em produção. **Sem segurança/LGPD** — você decidiu não fazer agora.

## Escopo

4 arquivos modificados nesta sessão, todos já testados localmente (149/149 testes verdes, build OK).

| Arquivo | Status |
|---|---|
| `_shared/gemini.ts` | ✅ editado, ❌ não deployado |
| `ai-agent-router/index.ts` | ✅ editado, ❌ não deployado |
| `evolution-webhook/index.ts` | ✅ editado, ❌ não deployado |
| `migrations/20260522180100_flow_reliability_v2_rollout.sql` | ✅ escrita, ❌ não aplicada |

---

## Fase 1 — Aplicar migração (DB)

**Passo 1.1** — Backup leve antes:
- `SELECT id, flow_reliability_v2 FROM consultants` (snapshot do estado atual)
- Salvar resultado pra rollback rápido

**Passo 1.2** — Aplicar migração `20260522180100_flow_reliability_v2_rollout.sql` via tool de migração:
- Liga `flow_reliability_v2='on'` em todos consultores
- Seed do bucket de quota Gemini
- Trigger pra novos consultores já nascerem com `v2='on'`

**Passo 1.3** — Validar:
- `SELECT COUNT(*) FROM consultants WHERE flow_reliability_v2='on'` → deve bater com total
- `SELECT * FROM gemini_quota_bucket LIMIT 1` → bucket existe

**Rollback (se algo der errado):**
```sql
UPDATE consultants SET flow_reliability_v2='off';
```

---

## Fase 2 — Deploy das 3 edge functions

Deployar em ordem (a primeira é dependência das outras duas):

**Passo 2.1** — Deploy `_shared/gemini.ts` via deploy de `ai-agent-router` (shared é puxado junto)

**Passo 2.2** — Deploy `ai-agent-router` (catch de `GeminiQuotaExhausted`)

**Passo 2.3** — Deploy `evolution-webhook` (bloco 6.0 SIM/OK)

**Validar cada uma:**
- Checar logs imediatamente após deploy (procurar por boot errors)
- Se erro → rollback automático do Supabase pega versão anterior

---

## Fase 3 — Smoke test pós-deploy (15 min)

**Teste 3.1 — Quota Gemini funcionando:**
- Logs de `ai-agent-router` nos próximos 10 min → procurar por `consume_gemini_token` sem erro
- Se quota for atingida, deve aparecer audit row, não exception silenciosa

**Teste 3.2 — SIM/OK em evolution:**
- Pedir pra Nilma (ou consultor de teste) responder "SIM" num lead em modo Captação Game/Pro via Evolution
- Verificar `bill_data_confirmed_at` populou
- Verificar bot ficou calado depois (não disparou próximo step automático)

**Teste 3.3 — Timing de mídia (fixes anteriores):**
- Acompanhar 1-2 conversas com áudio → texto → vídeo
- Confirmar que não sobrepõe (áudio de 18s não deve ser cortado por texto chegando)

---

## Fase 4 — Encerramento

**Passo 4.1** — Atualizar `docs/archive/KIRO_AUDIT.md`:
- Mover seção "Mudanças pendentes nesta sessão" → "Mudanças aplicadas em [data]"
- Marcar itens da Onda 2 (quota Gemini) e Onda 3 (SIM/OK evolution) como ✅

**Passo 4.2** — Resposta final ao usuário com:
- Confirmação de cada fase
- Links pros logs de cada função
- O que ficou de fora intencionalmente (hardening de segurança, LGPD)

---

## Não está no escopo (decisão sua)

- HMAC em webhooks
- Bucket privado + signed URLs
- Criptografia de credenciais portal
- `REVOKE EXECUTE` em RPCs
- View `SECURITY DEFINER` → INVOKER
- Property-based testing
- LGPD formal (DSR, retenção)
- 20 conversas E2E em staging
- Lighthouse mobile

Se quiser fazer **um** desses depois, é spec separada.

---

## Critério de "100% fechado"

✅ Migração aplicada e validada por SELECT
✅ 3 edge functions deployadas, logs sem erro de boot
✅ SIM/OK em Evolution confirmado funcionando em 1 lead real
✅ Quota Gemini visível como audit log (não exception)
✅ `KIRO_AUDIT.md` atualizado

**Tempo estimado:** 30-45 min total. Rollback trivial em qualquer fase.

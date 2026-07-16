# 10 — Achados P0 e P1

**Data:** 2026-07-16  
**Regra:** todo achado com evidência. Correções **não** aplicadas nesta auditoria.

---

## AUD-001 — `reactivation-send` pode contatar lead com `do_not_contact`

**Prioridade:** P0  
**Situação:** Confirmado  
**Domínio:** WhatsApp / DNC / Opt-out  
**Arquivo:** `supabase/functions/reactivation-send/index.ts`  
**Função:** handler principal (envio single/batch)  
**Linhas:** ~165–250 (single), ~300–410 (batch)  

### Evidência

- Importa `canSendProactive` (`proactive-send-guard.ts`), que só valida telefone do consultor vs instância — **sem** `do_not_contact`.
- `select` de customers **não** inclui nem filtra `do_not_contact`.
- Não importa `assertCanContact` nem `checkCustomerCanSend`.
- Em contraste, `reactivation-cron` filtra `.eq("do_not_contact", false)`.

### Caminho de execução

UI/API reativação → `reactivation-send` → Evolution/Whapi send → mensagem ao telefone do customer DNC.

### Impacto

Violação de opt-out / LGPD; contato indevido após “nunca mais contatar”; risco reputacional e jurídico.

### Como reproduzir com segurança

Em ambiente de staging/dryRun: marcar customer de teste com `do_not_contact=true`; chamar `reactivation-send` com `dry_run` se existir ou instância de teste; observar se passa da guarda.

### Correção recomendada

Antes de qualquer send: `assertCanContact` (fail-closed) + filtrar batch por `do_not_contact=false`. Alinhar com `reactivation-cron`.

### Arquivos possivelmente afetados

- `supabase/functions/reactivation-send/index.ts`
- `_shared/contact-suppression.ts`
- UI que dispara reativação

### Testes necessários

Unit/Deno: customer DNC → status skipped; batch misto → só não-DNC enviados; regressão cron.

### Risco de regressão

Baixo — apenas bloqueia envios indevidos.

---

## AUD-002 — Envio manual no front falha aberto se a checagem DNC der erro

**Prioridade:** P1  
**Situação:** Confirmado  
**Domínio:** WhatsApp / DNC / Frontend  
**Arquivo:** `src/services/messageSender.ts`  
**Função:** pipeline de envio unificado  
**Linhas:** ~162–179  

### Evidência

No `catch` da query `do_not_contact`, comentário explícito: se a checagem falhar, **segue** o envio.  
Backend `assertCanContact` falha fechado em erro de lookup com `customerId`.

### Caminho de execução

Chat → `sendWhatsAppMessage` → falha rede/RLS no select DNC → envio Evolution/Whapi mesmo assim.

### Impacto

Opt-out contornado em condição de erro (não no caminho feliz).

### Como reproduzir com segurança

Mockar falha no `from("customers").select("do_not_contact")` em teste unitário do messageSender.

### Correção recomendada

Fail-closed: em erro de checagem, retornar `failed` com mensagem clara (ou retry limitado). Opcional: chamar EF que já usa `assertCanContact`.

### Arquivos possivelmente afetados

- `src/services/messageSender.ts`
- testes de messageSender

### Testes necessários

Unit: erro de select → não envia.

### Risco de regressão

Médio — pode bloquear envios legítimos se a query DNC estiver quebrada; monitorar.

---

## AUD-003 — Super Admin UI autoriza role `admin`, não só `super_admin`

**Prioridade:** P1  
**Situação:** Confirmado  
**Domínio:** Segurança / Autorização / Frontend  
**Arquivo:** `src/pages/SuperAdmin.tsx`  
**Função:** efeito de gate L101–109  
**Linhas:** 83, 101–109  

### Evidência

```83:109:src/pages/SuperAdmin.tsx
  const { isAdmin, loading: roleLoading } = useUserRole(userId);
  // ...
    if (!isAdmin) {
      // toast acesso negado
      navigate("/admin", { replace: true });
```

`useUserRole` define `isAdmin = has_role(admin) OR is_super_admin`, e expõe `isSuperAdmin` **não usado** aqui.

### Caminho de execução

Login com role admin → `/super-admin` → UI carrega consultores/financeiro/ads plataforma.

### Impacto

Expansão de privilégio na interface. Dados sensíveis de toda a rede podem ser visíveis se RLS permitir `has_role(admin)` (ex.: “Admins read all customers”).

### Como reproduzir com segurança

Usuário de teste só com `admin` (sem `is_super_admin`) acessar `/super-admin`.

### Correção recomendada

Gate com `isSuperAdmin` (e RPC `is_super_admin`). Revisar se role `admin` deveria existir separado.

### Arquivos possivelmente afetados

- `src/pages/SuperAdmin.tsx`
- `src/pages/SuperAdminRemoteSupport.tsx` (verificar mesmo padrão)
- policies que usam `has_role(...,'admin')`

### Testes necessários

E2E: admin comum redirecionado; super_admin ok.

### Risco de regressão

Baixo se apenas super_admins já usam o painel na prática.

---

## AUD-004 — `facebook-campaign-healthcheck` cron path sem autenticação

**Prioridade:** P1  
**Situação:** Confirmado  
**Domínio:** Meta Ads / Edge Function / Financeiro  
**Arquivo:** `supabase/functions/facebook-campaign-healthcheck/index.ts`  
**Função:** `Deno.serve` handler  
**Linhas:** 16–56  

### Evidência

- `verify_jwt = false` no config.
- Se body tem `campaign_id` → exige `authConsultant`.
- Se **não** tem (modo cron) → varre até 50 campanhas e tenta reativar **sem** checar CRON_SECRET / service secret.

### Caminho de execução

Attacker POST na URL pública da EF → reativação de campanhas Meta elegíveis → gasto publicitário.

### Impacto

Custo financeiro; campanhas reativadas sem autorização; bypass da intenção de “só cron interno”.

### Como reproduzir com segurança

Não executar contra produção. Em projeto staging: POST vazio e observar se processa sem auth (dry observando logs).

### Correção recomendada

Exigir `CRON_SECRET` / `x-service-secret` no modo varredura; manter authConsultant no modo single.

### Arquivos possivelmente afetados

- `facebook-campaign-healthcheck/index.ts`
- migrations pg_cron que chamam a função
- funções irmãs: `facebook-auto-pause`, `facebook-campaign-status`, etc.

### Testes necessários

Sem secret → 401; com secret → 200; com campaign_id sem JWT → 401.

### Risco de regressão

Médio — cron precisa enviar o novo header.

---

## AUD-005 — `assertCanContact` quase não usado nos senders automáticos

**Prioridade:** P1  
**Situação:** Confirmado (cobertura); impacto parcial porque vários crons filtram DNC ad hoc  
**Domínio:** DNC / Arquitetura  
**Arquivo:** `_shared/contact-suppression.ts`  
**Função:** `assertCanContact`  
**Linhas:** 38+  

### Evidência

Grep: imports apenas em `manual-step-send` e `start-customer-attendance`.  
Outros canais reimplementam filtros `.eq("do_not_contact", false)` ou usam `checkCustomerCanSend` — inconsistente; gaps como AUD-001.

### Impacto

Novos senders esquecem o gate; comportamento divergente (voice_dnc só em assertCanContact).

### Correção recomendada

Tornar `assertCanContact` obrigatório em todo outbound (helper único + lint/teste de import).

### Risco de regressão

Médio — unificação pode mudar edge cases de matching de telefone.

---

## AUD-006 — Monólitos duplicados Evolution/Whapi `bot-flow.ts`

**Prioridade:** P1  
**Situação:** Confirmado (duplicação); impacto funcional = Muito provável  
**Domínio:** WhatsApp / Manutenção  
**Arquivos:**  
- `supabase/functions/evolution-webhook/handlers/bot-flow.ts` (~6290 linhas)  
- `supabase/functions/whapi-webhook/handlers/bot-flow.ts` (~6590 linhas)  

### Evidência

Dois arquivos enormes com mesmo papel; inventário AST e fotografia.

### Impacto

Correção de DNC/idempotência/fromMe aplicada só em um provedor; comportamento divergente por consultor (Evolution vs Whapi).

### Correção recomendada

Extrair núcleo para `_shared` (já há engine v3 parcial); diff dos dois arquivos; unificar gates.

### Risco de regressão

Alto — unificação exige testes E2E dryRun extensivos.

---

## AUD-007 — Webhooks WhatsApp em modo GRACE: secret não bloqueia

**Prioridade:** P1  
**Situação:** Confirmado  
**Domínio:** Segurança / WhatsApp / Webhook  
**Arquivo:** `supabase/functions/evolution-webhook/index.ts`, `whapi-webhook/index.ts`, `_shared/webhook-auth.ts`  
**Função:** `Deno.serve` + `verifyWebhookOrigin`  
**Linhas:** evolution ~115–124; whapi ~68–80; webhook-auth.ts completo  

### Evidência

`verifyWebhookOrigin` pode retornar `ok: false` (secret configurado + token ausente/errado), mas ambos os webhooks **apenas logam** e continuam o processamento. Comentários no código justificam (evitar engolir inbound se o provedor não manda header).

### Caminho de execução

Attacker POST → URL pública EF (`verify_jwt=false`) → grace ignora mismatch → parse/bot/DB com service_role.

### Impacto

Injeção de mensagens falsas, disparo de bot, poluição de CRM, possível custo de IA/envio se gates outbound falharem abertos em algum caminho.

### Como reproduzir com segurança

Staging: configurar secret; POST sem header; observar warn + processamento (não 401).

### Correção recomendada

1. Atualizar URL Whapi/Evolution com `?secret=`  
2. Trocar grace por enforce (401) com feature flag / % rollout  
3. Manter fail-open só se env vazio (já no helper)

### Arquivos possivelmente afetados

- `evolution-webhook/index.ts`, `whapi-webhook/index.ts`
- `_shared/webhook-auth.ts`
- docs de ops / URL do provedor

### Testes necessários

Unit: secret set + mismatch → 401; secret unset → 200 path; Deno CI.

### Risco de regressão

Alto se enforce sem atualizar provedor (inbound para). Mitigar com flag e monitoramento.

---

## AUD-008 — Workers com `WORKER_SECRET` default `change-me`

**Prioridade:** P1  
**Situação:** Confirmado (código); impacto em produção = Necessita verificação de env  
**Domínio:** Workers / Segurança  
**Arquivo:** `worker-portal-2/server.mjs`, `worker-club/server.mjs`  
**Função:** bootstrap + `authRequired`  
**Linhas:** ~30–70  

### Evidência

```js
const SECRET = process.env.WORKER_SECRET || 'change-me';
```

Auth é `Authorization: Bearer ${SECRET}` com comparação direta.

### Caminho de execução

Se deploy sem env → Bearer `change-me` aceito → `/submit-lead` / OTP.

### Impacto

Cadastro indevido no Portal 2 / Club; abuso de fila Playwright; custo e dados.

### Como reproduzir com segurança

Local: subir worker sem `.env` e chamar health/submit com Bearer change-me.

### Correção recomendada

Falhar boot se secret ausente ou igual a `change-me`; secrets distintos por worker; timing-safe compare.

### Risco de regressão

Baixo se produção já tem secret forte — só endurece misconfig.

---

## Próximos candidatos P1 (ainda não formalizados)

- Policies `USING(true)` amplas em tabelas auxiliares
- 71 SECURITY DEFINER sem search_path (heurística)
- CORS `*` em caller-auth
- sessionStorage com PII de customers

---

## AUD-009 — Crons de envio sem auth no handler

**Prioridade:** P1  
**Situação:** Confirmado  
**Domínio:** Agendamentos / Segurança  
**Evidência:** ver `11-agendamentos-e-crons.md`  
**EFs:** `reactivation-cron`, `bulk-scheduler`, `bot-followup-checker`, `cadence-tick`, `send-scheduled-messages`, `outbound-media-flush-cron`, `rodizio-metrics-broadcast`  

Handlers sem `x-service-secret` / internal secret; várias com `verify_jwt=false`. Mitigações: automation gate + DNC + bot_global. Risco: tick forçado via URL.

**Correção:** padrão `voice-dialer-cron` / `process-followups` (secret fail-closed) + headers no pg_cron.

---

## AUD-010 — `outbound-media-flush-cron` sem schedule no repo

**Prioridade:** P2  
**Situação:** Confirmado  
**Domínio:** Agendamentos  
Sem `cron.schedule` nas migrations; só comentários. Confirmar job real em produção.

---

## AUD-011 — `solar-design-public` por `snapshotId` sem token

**Prioridade:** P1  
**Situação:** Confirmado  
**Arquivo:** `supabase/functions/solar-design-public/index.ts`  
UUID do snapshot basta para ler métricas/painéis/endereço parcial. Exigir `public_token`.

---

## AUD-012 — `solar-hd-probe` diagnóstico público

**Prioridade:** P1  
**Situação:** Confirmado  
**Arquivo:** `supabase/functions/solar-hd-probe/index.ts`  
`verify_jwt=false`, sem rate limit, usa Google Solar API (custo). Comentário pede remoção pós-validação.

---

## AUD-013 — (reservado) duplicidade de schedules Meta / sync

Ver `14-meta-ads.md` — confirmar job único ativo no banco (`fb-sync-metrics` vs `6h`).

---

## AUD-014 — Alinhamento secret cron voz vs settings

**Prioridade:** P2  
**Domínio:** Voz  
Churn de migrations de secret; risco ops (401 silencioso ou misconfig). Ver `12-voz-e-discador.md`.

---

## AUD-015 — `get_referral_partner_metrics` SECURITY DEFINER sem search_path

**Prioridade:** P1 → **corrigido Onda 4**  
**Arquivo:** migration `20260526140000_referral_partners.sql` → fix `20260716130000_onda4_security_perf.sql`

---

## AUD-016 — `daily_reheat_queue` / `runs` legíveis por qualquer authenticated

**Prioridade:** P1 → **corrigido Onda 4**  
Queue: só dono (`consultant_id`) ou admin. Runs: só admin.

---

## AUD-017 — sessionStorage com PII de customers / rede

**Prioridade:** P1 → **corrigido Onda 4**  
`Admin.tsx` e `NetworkPanel.tsx` não persistem mais telefone/CPF/e-mail/nascimento no cache.

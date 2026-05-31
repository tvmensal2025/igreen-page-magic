# Implementation Plan

## Overview

Plano de implementação da **Fase 1** (segurança + LGPD) derivado diretamente dos 10 workstreams do `design.md` e da seção **Rollout & Rollback**. Cada workstream do design vira um grupo de tarefas de topo. A implementação é **incremental** (cada tarefa constrói sobre as anteriores) e segue a regra do Requisito 11: nenhuma mudança de banco/RLS/bucket/webhook/grants é aplicada automaticamente — toda tarefa de DB produz **uma migração focada** (Req 11.3), com sub-tarefa de **backup do estado atual ANTES** e **plano de rollback documentado**, e as operações destrutivas exigem **aprovação humana explícita** (Req 11.1, 11.6).

Linguagem de implementação: **TypeScript** (helpers `_shared/*.ts` e Edge Functions em Deno; frontend `.tsx`; worker `.mjs`). Testes de propriedade: **fast-check + Vitest**, mínimo **100 iterações**, cada teste anotado com a tag `Feature: security-hardening-lgpd, Property N`.

### Ordenação de ondas (wave ordering) — reflete a ordem de rollout do design

Aplicar do **menor blast-radius para o maior**, validando cada workstream isoladamente antes do próximo (cada um em sua própria migração/deploy). A tarefa 1 é **bloqueante**: nada começa antes da reconciliação da árvore git.

```
Pré-condição (Tarefa 1, BLOQUEANTE)
  → Req 9  (senha vazada — config)
  → Req 10 (PII em logs — só logs)
  → Req 6  (WITH CHECK customers — 1 migração)
  → Req 5  (kill switch Evolution — código localizado)
  → Req 2  (origem webhook — grace-period → validar 2 canais → enforce)
  → Req 3/4 (IDOR + CAPI — resolveCaller)
  → Req 8  (SECURITY DEFINER — view + REVOKE)
  → Req 7  (credenciais portal — encrypt/backfill/readers; drop plaintext separado e posterior)
  → Req 1  (docs privados — bucket/policies/função/frontend/backfill)
  → Validação final
```

O `## Task Dependency Graph` ao final formaliza essa ordem em ondas paralelizáveis, garantindo que tarefas que tocam o mesmo arquivo (ex.: `evolution-webhook/index.ts` em Req 10, Req 5 e Req 2) caiam em ondas distintas.

## Tasks

- [ ] 1. Pré-condição BLOQUEANTE — reconciliar árvore git e criar branch de remediação
  - **Nenhuma outra tarefa pode iniciar antes desta.** Registra a pré-condição do Requisito 11.7.
  - [ ] 1.1 Reconciliar a árvore de trabalho git suja (commit, stash ou descarte consciente)
    - Inspecionar `git status`/`git diff`, decidir e executar commit/stash/descarte das alterações não commitadas, deixando a árvore limpa.
    - Documentar a decisão de reconciliação (o que foi commitado/stashed/descartado) para rastreabilidade.
    - _Requirements: 11.7_
  - [ ] 1.2 Criar branch dedicado de remediação a partir da árvore limpa
    - Criar e fazer checkout de um branch dedicado (ex.: `security-hardening-lgpd-phase1`) onde todas as migrações e deploys desta fase serão isolados.
    - _Requirements: 11.7, 11.3_

- [ ] 2. Req 9 — Habilitar proteção contra senhas vazadas no Auth (menor blast-radius, config)
  - [ ] 2.1 Preparar e aplicar (gated) a configuração `auth_leaked_password_protection`
    - Habilitar a verificação HaveIBeenPwned no Supabase Auth via Management API/config; é mudança de configuração de baixo risco, preparada para aprovação humana e revertível desabilitando a flag.
    - _Requirements: 9.1, 9.2, 9.3_
  - [ ]* 2.2 Escrever smoke test que confirma rejeição de senha vazada conhecida
    - Teste de integração que tenta definir uma senha sabidamente comprometida e verifica a rejeição.
    - _Requirements: 9.2, 9.3_

- [ ] 3. Req 10 — Mascaramento de PII em logs (só altera logs; sem schema)
  - [ ] 3.1 Implementar helper `supabase/functions/_shared/pii-redaction.ts`
    - Funções puras e determinísticas: `maskPhone`, `maskCpf`, `maskOtp`, `redactPayload` (walk recursivo mascarando chaves sensíveis: phone, telefone, cpf, otp, code, password, token).
    - _Requirements: 10.1, 10.2, 10.4_
  - [ ]* 3.2 Escrever teste de propriedade — redação remove toda PII dos logs
    - **Property 15: Redação remove toda PII dos logs** — fast-check + Vitest, ≥100 iterações, tag `Feature: security-hardening-lgpd, Property 15`. Espera-se que dirija um PBT.
    - _Properties: 15_
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_
  - [ ]* 3.3 Escrever teste de propriedade — idempotência da redação
    - **Property 16: Idempotência da redação** (`redactPayload(redactPayload(x)) === redactPayload(x)`) — fast-check + Vitest, ≥100 iterações, tag `Feature: security-hardening-lgpd, Property 16`. Espera-se que dirija um PBT.
    - _Properties: 16_
    - _Requirements: 10.1, 10.4_
  - [ ] 3.4 Aplicar redação nos logs de `evolution-webhook/index.ts` e `whapi-webhook/index.ts`
    - Substituir `JSON.stringify(body).substring(...)` por `JSON.stringify(redactPayload(body)).substring(...)`; aplicar `maskOtp` em qualquer log de OTP. Consistente nos dois canais.
    - _Requirements: 10.1, 10.2, 10.5_
  - [ ] 3.5 Aplicar `maskPhone`/`maskCpf`/redação de credenciais nos logs de `sync-igreen-customers/index.ts`
    - Mascarar CPF, telefone e credenciais antes de gravar no log, preservando identificadores internos não sensíveis.
    - _Requirements: 10.3, 10.4_
  - [ ]* 3.6 Escrever unit tests dos call-sites de log
    - Verificar que cada `console.log` de payload/OTP/credencial passa pelo redator nos webhooks e na sincronização.
    - _Requirements: 10.1, 10.5_

- [ ] 4. Req 6 — UPDATE de `customers` com WITH CHECK (anti-reatribuição de lead)
  - [ ] 4.1 Backup das definições de policy atuais de `customers` (ANTES da mudança)
    - Exportar de `pg_policy` as definições das policies de `customers` (em especial `Owner update customers`) para arquivo de backup versionado.
    - _Requirements: 6.5, 11.1_
  - [ ] 4.2 Produzir migração focada DROP/CREATE de `Owner update customers` com `WITH CHECK`
    - Migração única e focada que recria a policy mantendo `USING (consultant_id = auth.uid())` e adicionando `WITH CHECK (consultant_id = auth.uid())`. **Não auto-aplicar** — entregar a migração para revisão/aprovação humana (Req 11.3).
    - _Requirements: 6.1, 6.2, 11.3_
  - [ ] 4.3 Documentar plano de rollback do workstream 6
    - Plano: recriar `Owner update customers` sem `WITH CHECK` a partir do backup de 4.1.
    - _Requirements: 6.5, 11.2_
  - [ ]* 4.4 (Defesa em profundidade, opcional) endurecer `roles` PUBLIC→`authenticated`
    - Migração separada e opcional endurecendo `Assigned consultant select/update customers` e `managers can read customers` de PUBLIC para `TO authenticated`, somente após confirmar que `anon` retorna 0 linhas. Rollback trivial. **Não auto-aplicar.**
    - _Requirements: 6.4_
  - [ ]* 4.5 Escrever teste de propriedade — UPDATE não pode alterar `consultant_id`
    - **Property 12: UPDATE não pode alterar consultant_id** — fast-check + Vitest gerando combinações (consultor dono, valores de `consultant_id`) executadas contra branch de teste com `set request.jwt.claims`; ≥100 iterações, tag `Feature: security-hardening-lgpd, Property 12`. Espera-se que dirija um PBT.
    - _Properties: 12_
    - _Requirements: 6.1, 6.2, 6.3_

- [ ] 5. Req 5 — Kill switch global honrado no canal Evolution
  - [ ] 5.1 Adicionar `isBotGloballyEnabled` (fail-open) no topo de `evolution-webhook/index.ts`
    - Reusar `_shared/bot/global-flag.ts`, espelhando o `whapi-webhook`: com `bot_global_enabled = false`, retornar sucesso neutro sem outbound; em erro de leitura, fail-open (bot habilitado).
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_
  - [ ]* 5.2 Escrever teste de propriedade — kill switch global silencia o Evolution
    - **Property 10: Kill switch global silencia o Evolution** — fast-check + Vitest, ≥100 iterações, tag `Feature: security-hardening-lgpd, Property 10`. Espera-se que dirija um PBT.
    - _Properties: 10_
    - _Requirements: 5.1, 5.2, 5.3_
  - [ ]* 5.3 Escrever teste de propriedade — leitura do kill switch falha em fail-open
    - **Property 11: Leitura do kill switch falha em fail-open** — fast-check + Vitest, ≥100 iterações, tag `Feature: security-hardening-lgpd, Property 11`. Espera-se que dirija um PBT.
    - _Properties: 11_
    - _Requirements: 5.4, 5.5_

- [ ] 6. Checkpoint — workstreams de baixo risco aplicados
  - Garantir que todos os testes passam; perguntar ao usuário se surgirem dúvidas.

- [ ] 7. Req 2 — Validação de origem dos webhooks (grace-period → validar 2 canais → enforce)
  - [ ] 7.1 Implementar helper `supabase/functions/_shared/webhook-origin.ts`
    - `verifyWebhookOrigin(req, {channel, secretEnvVar, headerNames, enforce})`: comparação em tempo constante do header com o segredo, opção HMAC-SHA256 do corpo; nunca loga o segredo. **Modo grace-period:** com `enforce=false`, sempre `{ok:true}` + log estruturado `webhook_origin_unverified`.
    - _Requirements: 2.1, 2.2, 2.5_
  - [ ] 7.2 Produzir migração focada da flag `app_settings.webhook_origin_enforced` (default `false`)
    - Migração única (linha `id='global'`, padrão de `bot_global_enabled`). **Não auto-aplicar** (Req 11.3). Backup: registrar config atual dos webhooks nos provedores Evolution/Whapi antes do rollout.
    - _Requirements: 2.1, 2.2, 11.3_
  - [ ] 7.3 Registrar segredos de ambiente `EVOLUTION_WEBHOOK_SECRET` e `WHAPI_WEBHOOK_SECRET`
    - Armazenar como segredos de ambiente, sem expor em código-fonte nem logs.
    - _Requirements: 2.5_
  - [ ] 7.4 (a) Integrar `verifyWebhookOrigin` em `evolution-webhook/index.ts` e `whapi-webhook/index.ts` em modo log-only
    - Deploy com `enforce=false` (grace-period): valida e emite log de origem não verificada, mas **não** rejeita ainda — evita derrubar tráfego legítimo.
    - _Requirements: 2.1, 2.2, 2.4_
  - [ ]* 7.5 Escrever teste de propriedade — webhook sem origem válida não produz efeito colateral
    - **Property 4: Webhook sem origem válida não produz efeito colateral** — fast-check + Vitest, ≥100 iterações, tag `Feature: security-hardening-lgpd, Property 4`. Espera-se que dirija um PBT.
    - _Properties: 4_
    - _Requirements: 2.1, 2.2, 2.3_
  - [ ]* 7.6 Escrever teste de propriedade — origem válida preserva comportamento funcional
    - **Property 5: Origem válida preserva comportamento funcional** — fast-check + Vitest, ≥100 iterações, tag `Feature: security-hardening-lgpd, Property 5`. Espera-se que dirija um PBT.
    - _Properties: 5_
    - _Requirements: 2.4_
  - [ ] 7.7 (b) Escrever teste de integração de dois canais validando supressão de duplicatas
    - Harness automatizado que exercita Evolution e Whapi com origem válida e confirma supressão de duplicatas usando as métricas de log do grace-period, como pré-requisito ao enforce.
    - _Requirements: 2.6, 11.5_
  - [ ] 7.8 (c) Virar `enforce=true` somente após validação (gated)
    - Setar `app_settings.webhook_origin_enforced = true` após 7.7 confirmar ambos os canais. Operação gated, exige aprovação humana; rollback = voltar a `false` (log-only) sem redeploy.
    - _Requirements: 2.3, 2.6, 11.5_

- [ ] 8. Req 3/4 — Autenticação e posse em Edge Functions service_role (IDOR) + CAPI
  - [ ] 8.1 Implementar helper `supabase/functions/_shared/caller-auth.ts`
    - `resolveCaller` (modo `service` via `x-service-secret` em tempo constante; modo `jwt` via `anonClient.auth.getUser` + `has_role` admin; senão 401) e `assertOwnership` (admin ok; `consultant_id`/`customer_id` divergente → 403; ausente/malformado/inexistente → 400; modo `service` dispensa posse).
    - _Requirements: 3.1, 3.2, 3.5, 3.7, 3.8_
  - [ ] 8.2 Registrar segredo de ambiente `SERVICE_SHARED_SECRET`
    - Segredo de ambiente, nunca em código-fonte nem logs.
    - _Requirements: 3.8_
  - [ ] 8.3 Integrar `resolveCaller` + `assertOwnership` em `capture-extract/index.ts`
    - Autenticar e verificar posse antes de qualquer leitura/gravação/efeito colateral.
    - _Requirements: 3.1, 3.2, 3.3, 3.4_
  - [ ] 8.4 Integrar `resolveCaller` + `assertOwnership` em `ai-agent-router/index.ts`
    - Aceitar modo `service` para a chamada interna webhook→router (dispensa posse); modo `jwt` exige posse. Validar a invocação interna primeiro.
    - _Requirements: 3.1, 3.5, 3.6_
  - [ ] 8.5 Integrar `resolveCaller` + `assertOwnership` em `ai-sales-agent/index.ts`
    - _Requirements: 3.1, 3.2, 3.3, 3.4_
  - [ ] 8.6 Integrar `resolveCaller` + autorização por consultor em `facebook-capi/index.ts`
    - Autenticar e autorizar o consultor **antes** de enviar ao Meta e antes de gravar em `facebook_capi_events`; preservar dedup por `event_id`.
    - _Requirements: 4.1, 4.2, 4.3, 4.4_
  - [ ] 8.7 Integrar `resolveCaller` + `assertOwnership` em `upload-documents-minio/index.ts` (camada de auth)
    - Apenas a guarda de autenticação/posse aqui; a gravação em bucket privado é tratada no workstream Req 1 (tarefa 12.4) para isolar o conflito de arquivo.
    - _Requirements: 3.1, 3.2, 3.3, 3.4_
  - [ ]* 8.8 Escrever teste de propriedade — autenticação obrigatória nas cinco funções
    - **Property 6: Autenticação obrigatória nas cinco Edge Functions** — fast-check + Vitest, ≥100 iterações, tag `Feature: security-hardening-lgpd, Property 6`. Espera-se que dirija um PBT.
    - _Properties: 6_
    - _Requirements: 3.1, 3.3, 4.1, 4.3_
  - [ ]* 8.9 Escrever teste de propriedade — verificação de posse impede acesso cruzado (IDOR)
    - **Property 7: Verificação de posse impede acesso cruzado (IDOR)** — fast-check + Vitest, ≥100 iterações, tag `Feature: security-hardening-lgpd, Property 7`. Espera-se que dirija um PBT.
    - _Properties: 7_
    - _Requirements: 3.2, 3.4, 4.2_
  - [ ]* 8.10 Escrever teste de propriedade — segredo de serviço dispensa posse mas exige validade
    - **Property 8: Segredo de serviço dispensa posse mas exige validade** — fast-check + Vitest, ≥100 iterações, tag `Feature: security-hardening-lgpd, Property 8`. Espera-se que dirija um PBT.
    - _Properties: 8_
    - _Requirements: 3.5, 3.6_
  - [ ]* 8.11 Escrever teste de propriedade — identificadores ausentes/malformados rejeitados com 400
    - **Property 9: Identificadores ausentes/malformados são rejeitados com 400** — fast-check + Vitest, ≥100 iterações, tag `Feature: security-hardening-lgpd, Property 9`. Espera-se que dirija um PBT.
    - _Properties: 9_
    - _Requirements: 3.7_

- [ ] 9. Checkpoint — borda autenticada e validada
  - Garantir que todos os testes passam; perguntar ao usuário se surgirem dúvidas.

- [ ] 10. Req 8 — Redução de exposição de SECURITY DEFINER
  - [ ] 10.1 Backup dos grants atuais e da definição da view (ANTES da mudança)
    - Exportar grants de `information_schema.role_routine_grants` e a definição de `v_bot_engine_health` para backup versionado.
    - _Requirements: 8.6, 11.1_
  - [ ] 10.2 Escrever a query de enumeração e produzir a classificação allowlist/denylist
    - Rodar a query read-only sobre `pg_proc` (66 funções `SECURITY DEFINER`) e gerar um artefato versionado classificando manter (allowlist) vs. revogar (denylist: gatilhos e auxiliares internas), revisado por humano.
    - _Requirements: 8.2, 8.3, 8.4_
  - [ ] 10.3 Produzir migração focada — `ALTER VIEW v_bot_engine_health SET (security_invoker = on)`
    - Migração única apenas da view (separada dos grants). **Não auto-aplicar** (Req 11.3).
    - _Requirements: 8.1, 8.5, 11.3_
  - [ ] 10.4 Produzir migração focada SEPARADA de `REVOKE EXECUTE` (DESTRUTIVA — gated)
    - Migração focada que revoga `EXECUTE` de `anon`/`authenticated` nas funções da denylist. **Operação destrutiva/de difícil reversão: produzir a migração para revisão e exigir aprovação humana explícita; NÃO auto-aplicar** (Req 11.6). Não misturar com a migração da view.
    - _Requirements: 8.2, 8.3, 8.5, 11.3, 11.6_
  - [ ] 10.5 Documentar plano de rollback do workstream 8
    - Plano: re-GRANT a partir do backup de 10.1 e `ALTER VIEW ... SET (security_invoker = off)`.
    - _Requirements: 8.6, 11.2_
  - [ ]* 10.6 Escrever teste de integração — anon/authenticated não executam funções de gatilho via `/rpc/`
    - Confirmar que a denylist não é chamável por `anon`/`authenticated` e que a view virou invoker.
    - _Requirements: 8.5_

- [ ] 11. Req 7 — Credenciais do portal protegidas (sem texto puro)
  - [ ] 11.1 Backup das colunas `igreen_portal_email`/`igreen_portal_password` de `consultants` (ANTES da mudança)
    - Dump versionado das colunas atuais antes de qualquer migração.
    - _Requirements: 7.6, 11.1_
  - [ ] 11.2 Registrar segredo de ambiente `PORTAL_CRED_ENC_KEY`
    - Segredo de ambiente (ou reuso de chave de cofre/pgsodium), nunca em código-fonte nem logs.
    - _Requirements: 7.1_
  - [ ] 11.3 Implementar criptografia das credenciais reusando `_shared/fb-crypto.ts`
    - `encrypt`/`decrypt` AES-GCM no mesmo formato de `facebook_connections.access_token_encrypted`.
    - _Requirements: 7.1, 7.4_
  - [ ] 11.4 (encrypt) Produzir migração focada adicionando coluna `igreen_portal_password_encrypted`
    - Migração única adicionando a coluna `text` (ciphertext base64). **Não auto-aplicar** (Req 11.3). Manter a coluna plaintext durante a janela de transição.
    - _Requirements: 7.1, 11.3_
  - [ ] 11.5 (backfill) Criptografar valores existentes para a nova coluna (gated)
    - Script/migração de backfill que criptografa as senhas atuais para `igreen_portal_password_encrypted`. Exige aprovação humana; não toca outras colunas.
    - _Requirements: 7.1, 7.6_
  - [ ] 11.6 (migrate readers) Migrar readers para a via protegida
    - `sync-igreen-customers/index.ts` e `worker-portal/playwright-automation.mjs` passam a descriptografar da coluna criptografada; em falha de recuperação, logar sem expor o valor e interromper a operação dependente.
    - _Requirements: 7.3, 7.4, 7.5_
  - [ ] 11.7 Tornar o campo de senha "write-only" no frontend
    - `src/components/admin/DadosTab.tsx`, `src/hooks/useAdminAuth.ts` e `src/hooks/useConsultantForm.ts` param de carregar/hidratar/echoar `igreen_portal_password`; campo fica em branco e só grava se preenchido.
    - _Requirements: 7.2_
  - [ ]* 11.8 Escrever teste de propriedade — round-trip de criptografia de credenciais
    - **Property 13: Round-trip de criptografia de credenciais** (`decrypt(encrypt(s)) === s` e ciphertext nunca contém o claro) — fast-check + Vitest, ≥100 iterações, tag `Feature: security-hardening-lgpd, Property 13`. Espera-se que dirija um PBT.
    - _Properties: 13_
    - _Requirements: 7.1, 7.4_
  - [ ]* 11.9 Escrever teste de propriedade — falha ao recuperar credencial não vaza valor e interrompe operação
    - **Property 14: Falha ao recuperar credencial não vaza valor e interrompe operação** — fast-check + Vitest, ≥100 iterações, tag `Feature: security-hardening-lgpd, Property 14`. Espera-se que dirija um PBT.
    - _Properties: 14_
    - _Requirements: 7.5_
  - [ ] 11.10 (TAREFA POSTERIOR SEPARADA, GATED) Drop da coluna plaintext `igreen_portal_password` (DESTRUTIVA)
    - Migração focada separada e posterior que remove a coluna plaintext, **somente após** confirmar que todos os readers (11.6) usam a coluna criptografada. **Operação destrutiva: produzir a migração para revisão e exigir aprovação humana explícita; NÃO auto-aplicar** (Req 11.6).
    - _Requirements: 7.1, 11.6_

- [ ] 12. Req 1 — Armazenamento privado de documentos pessoais (maior blast-radius)
  - [ ] 12.1 Backup do inventário de objetos e das policies de `storage.objects`/`storage.buckets` (ANTES da mudança)
    - Exportar inventário de objetos e definições de policies/bucket para backup versionado.
    - _Requirements: 1.6, 11.1_
  - [ ] 12.2 (bucket + policies) Produzir migração focada do bucket privado `customer-documents`
    - Migração única criando bucket `public=false` e policies de `storage.objects` por posse (prefixo `captacao/{consultant_id}/{customer_id}/...` validado contra `auth.uid()`/`has_role admin`), **sem** policy ampla de leitura/listagem por `anon`. **Não auto-aplicar** (Req 11.3); reconfiguração de bucket é gated (Req 1.6).
    - _Requirements: 1.1, 1.3, 11.3_
  - [ ] 12.3 (nova Edge Function) Implementar `document-signed-url`
    - `verify_jwt = true` em `config.toml`; fluxo `resolveCaller` → `assertOwnership({customerId})` → `getAdminClient().storage.from("customer-documents").createSignedUrl(path, 300)`. Posse falha → 403 sem URL; falha de assinatura → loga id interno não sensível, 5xx, não expõe path, nega conteúdo.
    - _Requirements: 1.2, 1.5, 1.7_
  - [ ] 12.4 Modificar `upload-documents-minio/index.ts` para gravar no bucket privado
    - Gravar em `customer-documents` em vez do bucket público; em falha de upload, retornar erro, não persistir URL pública e preservar o estado anterior do registro.
    - _Requirements: 1.1, 1.8_
  - [ ] 12.5 (frontend repoint) Atualizar `src/components/captacao/CaptureDocumentTiles.tsx`
    - Upload para o bucket privado (via Edge Function autenticada) e exibição via `document-signed-url` em vez de `getPublicUrl`.
    - _Requirements: 1.1, 1.2_
  - [ ] 12.6 (backfill copy-then-repoint) Copiar documentos legados preservando URLs existentes
    - Copiar os objetos legados para o bucket privado e repontar referências; **a cópia é não-destrutiva e preserva as URLs legadas** (originais mantidas). Gated, exige aprovação humana.
    - _Requirements: 1.4_
  - [ ] 12.7 (TAREFA GATED, DESTRUTIVA) Remover policies SELECT amplas / restringir acesso público legado
    - Produzir a migração/plano que remove as policies amplas de leitura/listagem e torna o acesso restrito, executada **somente após** 12.6 validar a cópia. **Operação de difícil reversão: produzir para revisão e exigir aprovação humana explícita; NÃO auto-aplicar** (Req 1.6, 11.6).
    - _Requirements: 1.3, 1.6, 11.6_
  - [ ]* 12.8 Escrever teste de propriedade — documentos privados nunca legíveis por anon
    - **Property 1: Documentos privados nunca legíveis por anon** — fast-check + Vitest, ≥100 iterações, tag `Feature: security-hardening-lgpd, Property 1`. Espera-se que dirija um PBT.
    - _Properties: 1_
    - _Requirements: 1.1, 1.3_
  - [ ]* 12.9 Escrever teste de propriedade — URL assinada só para chamador autorizado e expira em ≤300s
    - **Property 2: URL assinada só é emitida para chamador autorizado e expira em ≤300s** — fast-check + Vitest, ≥100 iterações, tag `Feature: security-hardening-lgpd, Property 2`. Espera-se que dirija um PBT.
    - _Properties: 2_
    - _Requirements: 1.2, 1.7_
  - [ ]* 12.10 Escrever teste de propriedade — falha de assinatura nunca vaza o path interno
    - **Property 3: Falha de assinatura nunca vaza o path interno** — fast-check + Vitest, ≥100 iterações, tag `Feature: security-hardening-lgpd, Property 3`. Espera-se que dirija um PBT.
    - _Properties: 3_
    - _Requirements: 1.5_

- [ ] 13. Checkpoint — workstreams de alto risco aplicados e gated
  - Garantir que todos os testes passam; perguntar ao usuário se surgirem dúvidas.

- [ ] 14. Validação final
  - [ ] 14.1 Re-executar os Supabase security advisors e confirmar limpeza
    - Confirmar que o advisor não reporta mais `v_bot_engine_health` como SECURITY DEFINER e que a proteção contra senha vazada (leaked-password) está habilitada.
    - _Requirements: 8.5, 9.3_
  - [ ] 14.2 Escrever teste de integração — `anon` não consegue ler `customer-documents`
    - Confirmar que a role `anon` lê 0 objetos (sem conteúdo, sem enumeração) do bucket privado.
    - _Requirements: 1.1, 1.3_
  - [ ] 14.3 Escrever verificação automatizada — nenhuma linha de log contém CPF/OTP completos
    - Varredura de logs/testes confirmando ausência de CPF e OTP em texto claro nos dois canais e na sincronização.
    - _Requirements: 10.1, 10.2_

## Notes

- Tarefas marcadas com `*` são opcionais (testes de unidade/propriedade/integração e a defesa em profundidade 4.4) e podem ser puladas para um MVP mais rápido; tarefas de implementação central nunca são opcionais.
- A **Tarefa 1 é bloqueante**: nenhuma migração/deploy inicia antes da árvore git limpa em branch dedicado (Req 11.7).
- Toda tarefa de DB produz **uma migração focada** e **não é auto-aplicada** (Req 11.3); cada workstream tem sub-tarefa de **backup ANTES** e **plano de rollback** (Req 11.1, 11.2).
- Operações **destrutivas/de difícil reversão** (10.4 `REVOKE EXECUTE`, 11.10 drop da coluna plaintext, 12.7 tornar acesso restrito/remover policies amplas) são entregues como migração/plano **para revisão** e exigem **aprovação humana explícita** (Req 11.6).
- Req 2 segue o rollout em três passos: (a) helper em grace-period/log-only (7.4), (b) validação em **ambos** os canais com supressão de duplicatas (7.7), (c) `enforce=true` só após validação (7.8) — Req 2.6/11.5.
- Cada teste de propriedade implementa uma única propriedade do design, com fast-check + Vitest, ≥100 iterações e a tag `Feature: security-hardening-lgpd, Property N`.
- Escopo restrito a Segurança/LGPD (Fase 1). Trabalho das Fases 2–6 (flow-engine, captação, UX, desempenho) **não** está incluído aqui.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["2.1", "3.1", "4.1", "7.1", "8.1", "10.1", "11.1", "12.1"] },
    { "id": 3, "tasks": ["2.2", "3.2", "3.3", "4.2", "7.2", "7.3", "8.2", "10.2", "11.2", "11.3", "12.2"] },
    { "id": 4, "tasks": ["3.4", "4.3", "4.4", "4.5", "8.3", "8.4", "8.5", "8.6", "8.7", "10.3", "10.4", "11.4", "12.3"] },
    { "id": 5, "tasks": ["3.5", "5.1", "8.8", "8.9", "8.10", "8.11", "10.5", "10.6", "11.5", "12.4"] },
    { "id": 6, "tasks": ["3.6", "5.2", "5.3", "7.4", "11.6", "12.5", "12.6"] },
    { "id": 7, "tasks": ["7.5", "7.6", "7.7", "11.7", "11.8", "11.9", "12.7", "12.8", "12.9", "12.10"] },
    { "id": 8, "tasks": ["7.8", "11.10"] },
    { "id": 9, "tasks": ["14.1", "14.2", "14.3"] }
  ]
}
```

# Hardening Cérebro Meta Ads — ordem, alertas e cuidados

Use este comando ao implementar, revisar ou continuar o hardening do Cérebro / Meta Ads.
Responda em **pt-BR**. Não invente autonomia nova. Não faça deploy sem pedido explícito.

Texto opcional após o comando = fase ou arquivo alvo (ex.: `/cerebro-ads-hardening lote 1` ou `P0.3 QA`).

---

## Veredito operacional (obrigatório)

- **GO** para hardening em lotes pequenos e revisáveis.
- **NO-GO** ativar sementes, challengers, escalas automáticas novas ou autonomia ampliada.
- **NO-GO** deploy enquanto o CI do **mesmo SHA** não estiver 100% verde.
- **NO-GO** promoção direta `shadow → full` (só um degrau: `disabled → shadow → limited → full`).
- Estado alvo pós-hardening: **`disabled` + kill switch conservador + whitelist vazia**.
- Contabilidade de gasto real continua em **todos** os modos; o modo controla só decisões automáticas, não o reconhecimento de gasto já ocorrido.

---

## Ordem de execução (não pular)

1. **Contenção imediata** — QA fail-closed; `fbCreate` sem retry cego; auth Ads fail-closed; gate temporário nos mutadores (sem POST automático se modo não explícito).
2. **CI / deploy seguro** (em paralelo) — Deno handlers Ads, lint/typecheck/test/build, docs drift com `rg` garantido; deploy manual com allowlist, SHA explícito, Environment com aprovação; sem default `all`.
3. **Helpers puros** — `canonical-json`, `safe-image-fetch`, `ad-automation-policy`, erros Graph tipados, CBO/ABO.
4. **Cobrança idempotente** — observação única + débito + checkpoint na mesma transação/RPC; reconcile autenticado.
5. **Saga de publicação humana** — `client_request_id`, lease, IDs Meta por estágio, `reconciliation_required` (não recriar).
6. **CAPI outbox** — reservar antes de enviar; `event_id` estável; nunca `ok: true` com erro Meta.
7. **Autonomia controlada** — policy + ledger + caps/cooldown; mutadores um a um; defaults inertes.
8. **Legado / regra dura** — neutralizar protocolo `2026-####` no WA; preservar atribuição UUID forte; Whapi intocado.
9. **Rollout** — só após auditoria read-only de staging (RLS, crons, secrets, `ENFORCE_CRON_AUTH`); código em `disabled` → observar → um degrau.

---

## Alertas críticos (ler antes de editar)

### Segurança / exploração
- `ad-creative-qa` **não pode** falhar aberto (`approved: true` + HTTP 200). Erro = `approved: false`.
- Fetch de URL arbitrária no servidor = risco de **SSRF**. Exigir `safe-image-fetch` (HTTPS, allowlist de storage, bloquear privados/metadata, revalidar redirect, timeout, limite de bytes, MIME + magic bytes). Fail-closed.
- Auth por “presença de `apikey`” **não** é autenticação. Cron Ads exige segredo interno verificável, fail-closed.
- `assertCronAuth` com grace/`ENFORCE_CRON_AUTH` off **não** serve para Ads. Usar variante estrita.
- `verify_jwt=false` só é aceitável com auth interna estrita no handler. CORS: `buildCors(req)`, nunca `*` em endpoint sensível.

### Graph / duplicação Meta
- `fbFetch` genérico **não** pode retentar POST de criação (Campaign/AdSet/Creative/Ad). Timeout após create na Meta + retry = objeto duplicado.
- Separar: `fbRead` (retry ok) · `fbWriteIdempotent` · `fbCreate` (sem retry cego). Ambíguo → `reconciliation_required`, não reenviar create.
- Compensação **não** apaga objetos Meta cegamente.

### Dinheiro / carteira
- Débito + checkpoint fora da mesma transação = débito duplicado em crash/retry/cron concorrente.
- Unificar observação idempotente + débito + checkpoint (RPC/transação). Lock na linha do checkpoint.
- Reconciliação: auth estrita + chave única de ajuste + auditoria. Nunca debitar duas vezes a mesma observação.
- Cobrança de gasto já ocorrido **não** depende do modo do Cérebro.

### CAPI
- Enviar antes de reservar `event_id`/outbox é proibido.
- `crypto.randomUUID()` sem âncora de domínio é frágil; preferir `event_name:customer_id` (ou equivalente estável).
- `fbRes.error` **nunca** pode virar `ok: true`.
- Retry sempre reutiliza o mesmo `event_id`. Estados: pending → processing → sent | retry | dead.

### Autonomia / policy
- `DEFAULT_BRAIN_CONFIG.autopilot = true` e `o.autopilot !== false` **não** podem virar `full`. Legacy → **`disabled`** até promoção explícita.
- Única porta para efeito automático na Meta: `ad-automation-policy.ts`. Nenhum handler reimplementa a decisão.
- Em `limited`: pause waste + escala ≤ **10%**. Seed/challenger/targeting automático = **não** nesta etapa.
- Em `shadow`: zero Graph writes reais (só simulação/evidência).
- `full` continua whitelist-only e com caps — nunca “sem freio”.
- Constraint de banco com step 15–30% **não** autoriza >10% em limited; policy clampa no centro.
- Healthcheck recovery ≠ diagnóstico. Reativação só `full` + whitelist. Ledger impede pause×reativação concorrentes.

### Publicação / front
- Front **não** deve incentivar novo clique cego em timeout. Reutilizar `client_request_id` do mesmo clique.
- Publicação só com QA vinculado ao **hash** do asset aprovado.
- Preservar no wizard: imagem, vídeo, raio/`custom_locations`, duração/`end_time_utc`, `initial_message`, rodízio, templates, CBO.

### Atribuição / WhatsApp (regra dura do projeto)
- Campanha = **UUID** (`facebook_campaigns.id` → `source_campaign_id`). Ordem: AD ID/URL → `fb_campaign_id` → `ctwa_clid` → UUID interno.
- **Proibido** atribuir campanha por cidade, keyword ou texto aproximado.
- Protocolo `2026-####` só banco/admin — **nunca** appendar na mensagem WA.
- Whapi é canal primário; não “consertar” Evolution por `needs_reconnect`.

---

## Cuidados de processo (obrigatórios)

1. **Working tree sujo / concorrente** — não misturar com PRs de referral/parceiros (`referral-partner-assignment`, migrations de assignment, webhooks). Branch/PR separado só Ads hardening.
2. **Não apagar** migrations, flags, guardas, edges “mortas” nem mutadores feios (`facebook-cpl-correction`). Gate `skipped`/`disabled`; consertar, não deletar.
3. **Migrations só aditivas** — defaults inertes; whitelist vazia; sem ativar cron; sem Vault/secret; sem URL de prod; sem promoção automática; RLS/grants revisados; rollback documentado antes de prod.
4. **Auth strict Ads quebra crons** se headers/Vault/`ENFORCE_CRON_AUTH` não estiverem prontos. Checklist de secrets **antes** do merge em produção.
5. **Lote 7 (mutadores) grande demais** — um mutador por PR (`auto-pause`, depois `rotator`, etc.).
6. **QA fail-closed temporário ≠ `safe-image-fetch`**. A linha do catch fecha sangramento; SSRF só fecha com o helper.
7. **Não criar** CLI promote/rollback/panic antes de existir, versionar e testar o script real.
8. **E2E com efeito Meta** começa em `dryRun` / sandbox.
9. **types.ts** — regenerar só após migrations finais; não editar à mão; preservar mudanças concorrentes no working tree.
10. **Não deployar** de working tree local sujo nem de SHA com CI vermelho.
11. Confirmar path/tree: workspace pode diferir de clones (`SISTEMA-IGREEN` vs `ultra-cursor`); trabalhar só no repo certo no **mesmo SHA** acordado.
12. Antes de prod: revalidar docs oficiais atuais (Graph retry/erros, dedupe CAPI, auth Edge/cron Supabase, GitHub Environments).

---

## Matriz rápida — o que pode / não pode

| Ação | disabled | shadow | limited | full |
|---|---|---|---|---|
| Ler / diagnosticar / rankear | Sim | Sim | Sim | Sim |
| Persistir decisão/evidência | Sim | Sim | Sim | Sim |
| POST automático Meta | Não | Não | Só allowlist | Só allowlist |
| Pause por waste | Não | Simulação | Sim | Sim |
| Escala automática | Não | Simulação | Máx. 10% | Limite config |
| Reativação automática | Não | Não | Não | Whitelist |
| Targeting automático | Não | Não | Não | Negado por default |
| Seed / challenger auto | Não | Não | Não | Não nesta etapa |
| Cobrança gasto ocorrido | Sim | Sim | Sim | Sim |
| Operação manual autenticada | Fora da matriz (JWT + ownership + idempotência + auditoria) |||

---

## Checklist antes de qualquer PR deste tema

- [ ] Escopo = só hardening Ads; nada de referral/WA paralelo no mesmo PR
- [ ] Nenhum mutador novo ligado; defaults inertes
- [ ] `autopilot` legado não promoveu ninguém para `full`
- [ ] Create Graph sem retry cego
- [ ] QA / imagem fail-closed (e SSRF tratado se o lote incluir fetch)
- [ ] Cron Ads com auth estrita (ou ainda atrás de gate explícito documentado)
- [ ] Débito/métricas: se mexeu, há chave idempotente + teste de concorrência
- [ ] CAPI: se mexeu, outbox antes do send; erro Meta ≠ sucesso
- [ ] Protocolo não aparece em mensagem WA
- [ ] Atribuição UUID forte preservada
- [ ] Testes do lote passando; CI do SHA verde antes de pedir deploy
- [ ] Diff revisável; sem `--no-verify`; sem force push

---

## Como executar neste chat

1. Classificar o pedido na fase 1–9 acima (ou usar o texto após o comando).
2. Carregar só os arquivos daquela fase; não “aproveitar” para ligar autonomia.
3. Preferir helper canônico novo/existente; não reimplementar policy/auth/fetch em cada handler.
4. Mostrar plano curto → implementar → validar com o critério da fase.
5. Se algo exigir secret/cron/prod: **parar e pedir confirmação explícita** antes.

Se o usuário pedir “fazer tudo” ou “ligar full”: recusar o atalho, lembrar a ordem e propor o próximo lote seguro.

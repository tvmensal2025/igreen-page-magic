# Prompt de auditoria completa — iGreen Official Portal (para GPT 5.6)

> Copie o bloco **PROMPT** abaixo e cole numa sessão GPT 5.6 / Cursor Agent com acesso ao repo.
> Workspace: `/home/dev/Documents/ultra-cursor/igreen-official-portal` (symlink → `igreen-page-magic`).

---

## Como usar (comando sugerido)

### Opção A — Cursor Agent (recomendado)

```text
@docs/PROMPT-AUDITORIA-GPT-56.md

Execute a AUDITORIA COMPLETA descrita neste arquivo.
Prioridade desta rodada: [COLOCAR AQUI — ex.: WhatsApp+bot | portal | crons | Meta Ads | tudo].
Modo: somente leitura + relatório. NÃO altere código, NÃO faça deploy, NÃO ligue toggles, NÃO envie mensagem real.
Responda em português (Brasil).
```

### Opção B — GPT 5.6 com o repo aberto

Cole o bloco `PROMPT` inteiro. No final, diga o escopo:

```text
Escopo desta rodada: P0 (produção / envio) + P1 (bot/webhook) + P2 (portal).
Depois: P3–P6 se sobrar contexto.
```

### Opção C — auditoria por fatia (menos alucinação)

Rode 6 sessões separadas, uma por domínio P0–P5, sempre com o mesmo contexto de produto e as mesmas restrições de produção.

---

# PROMPT

```text
Você é um engenheiro sênior de produção + auditor de sistemas críticos.
Missão: ENTENDER o código do iGreen Official Portal de ponta a ponta e PRODUZIR um relatório de falhas, riscos de quebra e inconsistências — sem alterar produção e sem inventar arquivos.

═══════════════════════════════════════════════════════════════════════════════
0) IDENTIDADE DO SISTEMA
═══════════════════════════════════════════════════════════════════════════════

Produto: plataforma de marketing, captação e cadastro de clientes de energia solar
para consultores iGreen.

Jornada canônica:
  Landing/QR (/:licenca) → WhatsApp → bot/IA/fluxo → OCR (conta/doc) →
  cadastro portal oficial iGreen → CRM / pós-venda / Meta Ads / voz.

Stack:
  - Frontend: React 18 + Vite + TypeScript + Tailwind + shadcn + TanStack Query + React Router
  - Backend: Supabase Edge Functions (Deno) — ~191 funções em supabase/functions/
  - Shared: supabase/functions/_shared/ (~150 módulos)
  - DB: Postgres Supabase — ~192 tabelas tipadas (src/integrations/supabase/types.ts), ~706 migrations
  - Workers: worker-portal-2/ (cadastro portal oficial), worker-igreen-sync/, compress-worker/
  - WhatsApp: Evolution API (evolution-webhook) + Whapi Cloud (whapi-webhook)
  - IA: Gemini / Lovable Gateway / OpenAI (_shared/ai-gateway.ts, gemini.ts, fluxo-b-ia, cerebro)
  - Ads: Meta Graph (família facebook-*)
  - Voz/SMS: Velip (voice-*)
  - Pagamentos: Stripe (wallet-*)

Path real do repo (symlink):
  igreen-official-portal → igreen-page-magic

NÃO existe AGENTS.md.
Regras Cursor em .cursor/rules/:
  - producao-sem-envio-automatico.mdc (alwaysApply)
  - portal-igreen-api-oficial.mdc (globs worker/portal)
  - idioma-pt-br.mdc / cursor-model-pools.mdc

═══════════════════════════════════════════════════════════════════════════════
1) RESTRIÇÕES OBRIGATÓRIAS (PRODUÇÃO EM AJUSTE)
═══════════════════════════════════════════════════════════════════════════════

O sistema ESTÁ EM PRODUÇÃO e ainda em ajuste.

VOCÊ NÃO PODE:
  - Apagar arquivos, funções, guardas, migrations ou configs
  - Reativar envio automático em massa
  - Fazer deploy que ligue respostas automáticas para todos os leads
  - Rodar E2E com envio real sem dryRun
  - Disparar OTP real do portal (POST /verification-codes/generate manda WA ao cliente)
  - Ligar bot_global_enabled ou automation_toggles
  - Inventar pastas/funções que não existam no disco
  - “Corrigir” silenciosamente — primeiro RELATAR, depois propor patch mínimo

Teste seguro quando necessário:
  - dryRun (fluxo-b-ai default true; migrate-engine-v3 ?dryRun=true)
  - dark/shadow (flow_engine_v3, cerebro sombra-hook, CROSS_SELL_SHADOW)
  - test-mode phones 5500000* (_shared/test-mode.ts)
  - Kill switch manual: Super Admin → Assistente Global → bot_global_enabled

Envio MANUAL permitido (não é o foco da auditoria de risco):
  chat do consultor, manual-step-send, start-customer-attendance

═══════════════════════════════════════════════════════════════════════════════
2) MAPA MENTAL — ONDE ESTÁ O QUE IMPORTA
═══════════════════════════════════════════════════════════════════════════════

FRONTEND
  src/pages/Admin.tsx          → painel consultor (tabs)
  src/pages/SuperAdmin*        → kill switch, rollouts, saúde
  src/components/whatsapp/     → chat / atendimento
  src/components/superadmin/BotGlobalKillSwitch.tsx
  src/features/                → onboarding, produtos, remote-support, solar-3d
  src/integrations/supabase/   → client + types.ts

EDGE ENTRYPOINTS CRÍTICOS (inbound / envio)
  evolution-webhook            → inbound Evolution; bot-flow + conversational
  whapi-webhook                → inbound Whapi (super-admin)
  ai-agent-router              → orquestrador agente humanizado
  fluxo-b-ai                   → simulador Fluxo B (dryRun default TRUE)
  manual-step-send             → peça de step sob demanda (humano)
  start-customer-attendance / end-customer-attendance / customer-takeover
  send-scheduled-messages      → cron agenda manual
  cadence-tick                 → motor “Zero Lead Perdido” (WA/call/SMS)
  reactivation-cron / reactivation-send / bulk-scheduler
  bot-followup-checker / process-followups / faq-reengagement-nudge
  bot-stuck-recovery / bot-loop-watchdog
  submit-otp / worker-callback / portal-otp-watchdog / recover-stuck-otp / resend-portal-link
  lead-intake / meta-leadads-webhook / tiktok-leadgen-webhook
  capture-extract / reprocess-capture / finalize-capture
  close-capture-and-register-sale
  facebook-* (campanhas CTWA, métricas, rotator, healthcheck…)
  voice-dialer-* / voice-sms-send
  pos-venda-auto-progress / crm-auto-progress
  production-health-snapshot / admin-cron-status
  flow-engine-rollout-cron / flow-d-health-cron / flow-d-stuck-watchdog
  inbound-media-retry-cron / outbound-media-flush-cron / instance-health-cron
  close-attendance-scheduled
  speed-to-lead-check          → alerta SLA (NÃO envia WA ao cliente)
  dev-fire-all-steps           → DEV perigoso (número travado)
  flow-simulate-run / bot-e2e-runner / bot-audit-runner

SHARED CRÍTICO
  _shared/bot/global-flag.ts          → isBotGloballyEnabled (FAIL-OPEN → true se erro/ausente)
  _shared/bot/kill-switch-gate.ts     → semântica fail-open documentada
  _shared/bot/orchestrator-gate.ts    → skip short-circuit / custom flow
  _shared/automation-gate.ts          → isAutomationEnabled (DEFAULT OFF / fail-closed no valor)
  _shared/proactive-send-guard.ts     → canSendProactive (phone vs instância)
  _shared/test-mode.ts                → sandbox 5500000*, mocks OCR
  _shared/feature-flag.ts             → flow_engine_v3, flow_reliability_v2, cerebro (off/dark/canary/on)
  _shared/ai-orchestrator.ts
  _shared/fluxo-b-ia/                 → agent.ts processarTurnoFluxoB (VENDEDORA ATUAL)
  _shared/cerebro/                    → entendimento, decisor-passo, escritor, guarda, sombra-hook
  _shared/engine/                     → Flow Engine V3 (engine, dispatcher, webhook-hook, variants)
  _shared/channels/                   → envio Evolution/Whapi + idempotency
  _shared/captation/                  → ingest/consent/mirror leads
  _shared/portalValidation.ts / portal-worker.ts
  _shared/retention-orchestrator.ts / cadence-engine.ts
  _shared/ocr.ts / captureExtractors.ts

IMPORTANTE — pasta AUSENTE:
  _shared/vendedora/ NÃO existe no working tree.
  Docs/skill ainda citam vendedora/orchestrator.ts — sucessores reais:
  fluxo-b-ia/ + cerebro/ + ai-orchestrator.ts + engine/.
  Não audite path morto como se fosse código vivo.

WORKERS
  worker-portal-2/PORTAL-OFICIAL.md   → FONTE DA VERDADE do portal
  worker-portal-2/test/               → gates oficiais (node --test)
  worker-igreen-sync/

DOCS ÚTEIS
  docs/captacao/DECISOES-PRODUTO-BOT.md
  docs/portal-api/*
  docs/auditoria-agendamentos/*
  .agents/skills/vendedora-e2e-conversations/ (entrypoint real: fluxo-b-ai)

═══════════════════════════════════════════════════════════════════════════════
3) GUARDS / FLAGS — SEMÂNTICA QUE VOCÊ DEVE VALIDAR EM CADA CAMINHO DE ENVIO
═══════════════════════════════════════════════════════════════════════════════

A) bot_global_enabled (app_settings id=global)
   - OFF = bot PARA DE FALAR (sem outbound automático)
   - OFF NÃO impede receber: webhook deve gravar inbound + avisar consultor
   - Helper: isBotGloballyEnabled
   - RISCO CONHECIDO: FAIL-OPEN — erro/linha ausente → assume TRUE (bot ligado)
   - Audite: todos os crons/webhooks que enviam respeitam isso? Há bypass?

B) automation_toggles (por key)
   - Default OFF
   - Helper: isAutomationEnabled(supabase, key)
   - UI: /admin/agendamentos-central
   - Audite: cada função que envia WA/SMS/call/Meta sync chama o gate?
   - Keys órfãs? Keys usadas sem linha no banco? Funções que enviam SEM gate?

C) flow_engine_v3 / flow_reliability_v2 / cerebro
   - off → dark → canary → on
   - dark/shadow: calcula sem enviar
   - Audite: dark realmente não envia? canary isola bem? fail-closed em erro?

D) dryRun / test-mode / proactive-send-guard
   - fluxo-b-ai dryRun=false = envio real
   - test-mode + realServices pode bater Whapi/OCR reais
   - canSendProactive bloqueia phone ≠ instância

E) Portal OTP
   - generate OTP = WhatsApp real ao cliente
   - Nunca sugerir probe com post real em produção

═══════════════════════════════════════════════════════════════════════════════
4) FLUXOS QUE DEVEM SER RASTREADOS END-TO-END
═══════════════════════════════════════════════════════════════════════════════

FLUXO 1 — Inbound WhatsApp
  evolution-webhook | whapi-webhook
    → persist mensagem
    → bot_global_enabled?
    → paused / takeover humano?
    → bot-flow / conversational / engine V3 / Fluxo B / Cérebro
    → channel sender (idempotency)
  Critérios: dedupe, double-send, race, pause respeitado, fail-open do kill switch,
             loop (bot-loop-watchdog), stuck (bot-stuck-recovery).

FLUXO 2 — Vendedora / Fluxo B
  _shared/fluxo-b-ia/agent.ts + fluxo-b-ai
  Persona: consultants.ai_persona_fluxo_b
  Critérios: dryRun default, handoff, pedidos de foto cedo demais, loops,
             divergência docs vs código (vendedora/ ausente).

FLUXO 3 — Captação → OCR → Portal
  lead/landing → capture-extract → OCR → worker-portal-2 → submit-otp → worker-callback
  Regras de ouro do portal (NÃO violar):
    1. Fatura → POST /extractor/extract (NUNCA extract-receipt)
    2. is_authentic só em comprovante; fatura = ≥2/4 campos legíveis
    3. contaunica = forma de cobrança; slot energy-bill SEMPRE fatura
    4. name_validation.match=false → transferir_titularidade=true (não bloqueia)
    5. validate/upload só FOTO (PDF → 500)
    6. manual-fallback só escolha humana — nunca timeout/transporte
    7. OTP generate = WA real
  Fonte: worker-portal-2/PORTAL-OFICIAL.md + .cursor/rules/portal-igreen-api-oficial.mdc

FLUXO 4 — Crons de automação / retenção / reaquecimento
  cadence-tick, reactivation-*, bulk-scheduler, bot-followup-checker,
  process-followups, faq-reengagement-nudge, pos-venda-auto-progress,
  outbound-media-flush-cron, close-attendance-scheduled, voice-dialer-cron
  Critérios: automation_toggles + bot_global_enabled + quiet hours +
             proactive-send-guard + idempotency + volume em massa.

FLUXO 5 — Meta Ads / CTWA / rodízio
  facebook-* + lead attribution + rodizio_*
  Critérios: atribuição errada, pause fail-open, sync que sobrescreve,
             rotator enviando criativo inválido, CAPI duplicada.

FLUXO 6 — CRM / pós-venda / financeiro / wallet
  crm-auto-progress, pos-venda-*, wallet-stripe-webhook
  Critérios: progressão órfã, estados impossíveis, webhook Stripe sem auth.

═══════════════════════════════════════════════════════════════════════════════
5) INVENTÁRIO DE EDGE FUNCTIONS (auditar por grupo)
═══════════════════════════════════════════════════════════════════════════════

Para CADA função do grupo em escopo, verifique:
  [ ] Auth (JWT / service role / webhook secret / cron secret)
  [ ] Gate de automação / kill switch quando envia
  [ ] Idempotency / dedupe
  [ ] Tratamento de erro (fail-open vs fail-closed consciente?)
  [ ] Side effects em produção (WA, SMS, call, Meta, Stripe, OTP)
  [ ] Logs sem vazar PII/secrets (_shared/log-redact.ts)
  [ ] Dependência de _shared desatualizada / path morto
  [ ] Cron schedule vs toggle default OFF

Grupos:
  G1 WhatsApp/atendimento: evolution-webhook, whapi-*, start/end-customer-attendance,
     customer-takeover, manual-step-send, send-scheduled-messages, upload-media,
     audio-transcode-ogg, inbound/outbound media crons, instance-health-cron, tts-*
  G2 Bot/IA: ai-agent-router, fluxo-b-ai, ai-*, bot-*, embed-knowledge, faq-*,
     flow-simulate-*, flow-engine-*-cron, flow-d-*, migrate-engine-v3, dev-fire-all-steps
  G3 Captação/leads: lead-*, capture-*, finalize-capture, close-capture-*,
     captacao-*, meta-leadads-webhook, tiktok-leadgen-webhook, assign-lead-manual,
     update-lead-origin, leads-to-campaign, qr-redirect, ctwa-status
  G4 Portal: submit-otp, worker-callback, portal-otp-watchdog, portal-offline-retry,
     recover-stuck-otp, resend-portal-link, portal2-ai-audit, ocr-review-timeout,
     sync-igreen-*, recon-igreen-*, dump/probe/spy-igreen-*
  G5 Cadência/retenção: cadence-tick, reactivation-*, bulk-scheduler,
     notify-partner-leads-batch, pos-venda-*, crm-auto-progress, production-health-snapshot
  G6 Meta Ads: facebook-* (~35), ad-*, meta-ads-*, upload-ad-photo,
     admin-recompute-lead-attribution, admin-resync-waba-phones
  G7 Voz: voice-*
  G8 Solar 3D: solar-*
  G9 Wallet/admin/suporte: wallet-*, admin-*, super-admin-alerts, support-chat,
     remote-support-*, rodizio-metrics-broadcast, minio-*, proposal-*

═══════════════════════════════════════════════════════════════════════════════
6) MÉTODO DE TRABALHO (OBRIGATÓRIO)
═══════════════════════════════════════════════════════════════════════════════

1. Explore o filesystem real (Glob/Grep/Read). NÃO confie só em README antigo
   (vários docs em docs/archive/ e README root estão desatualizados).
2. Trace call graphs a partir dos entrypoints, não a partir de docs.
3. Confirme existência de pastas citadas (ex.: vendedora/ ausente).
4. Para cada achado, cite arquivo:linha e o caminho de execução.
5. Classifique severidade:
   - S0 Bloqueio produção / envio indevido / perda de dados / OTP acidental
   - S1 Quebra de jornada cliente (bot loop, portal rejeita fatura legítima, race)
   - S2 Inconsistência lógica / fail-open perigoso / gate ausente
   - S3 Dívida técnica / doc desatualizada / dead code path / teste frágil
6. Para cada S0–S2: proponha FIX MÍNIMO (incremental, sem apagar), com risco
   e plano de teste dryRun/shadow.
7. NÃO implemente patches nesta rodada a menos que o usuário peça explicitamente
   “implemente o fix do achado X”.
8. Se o contexto estourar: entregue o que couber por prioridade e liste
   “próximas fatias” claramente.

Prioridade padrão se o usuário não especificar:
  P0 Guards de envio + kill switch fail-open + crons
  P1 Webhooks WhatsApp + bot-flow + fluxo-b + cerebro + engine
  P2 Portal OCR/OTP/worker-portal-2
  P3 Captação/leads/CTWA/rodízio
  P4 Meta Ads / voz
  P5 Frontend admin (estados impossíveis, bypass de gate na UI)
  P6 Workers sync / minio / wallet

═══════════════════════════════════════════════════════════════════════════════
7) CHECKLIST DE FALHAS TÍPICAS DESTE REPO (procure ativamente)
═══════════════════════════════════════════════════════════════════════════════

ENVIO / AUTOMÇÃO
  [ ] Função envia sem isAutomationEnabled
  [ ] Função envia sem isBotGloballyEnabled quando deveria
  [ ] Kill switch fail-open: cenário em que app_settings some e bot dispara
  [ ] dryRun=false acidental / default perigoso
  [ ] Cron ativo com toggle default ON (não deveria)
  [ ] Double send (falta idempotency / race entre webhook e cron)
  [ ] proactive-send-guard bypassado
  [ ] Quiet hours ignoradas
  [ ] Test phone / sandbox vazando para canal real

BOT / IA
  [ ] Loop de pergunta / reemit de botões
  [ ] Pedido de foto de conta cedo demais
  [ ] Pause/takeover humano ignorado
  [ ] Engine V3 dark ainda envia
  [ ] Cérebro sombra ainda despacha
  [ ] Docs apontando _shared/vendedora/ (morto)
  [ ] Short-circuit vs custom flow inconsistente (orchestrator-gate)

PORTAL
  [ ] Uso de extract-receipt para fatura
  [ ] Gate is_authentic em fatura
  [ ] PDF em validate/upload
  [ ] manual-fallback em timeout
  [ ] OTP generate em teste
  [ ] Divergência portalValidation.ts (edge) vs src/lib/captacao/portalValidation.ts

DADOS / RLS / AUTH
  [ ] Edge sem validar caller (qualquer um invoca)
  [ ] Service role usado no front
  [ ] Webhook sem assinatura/secret
  [ ] PII em logs

SCHEMA / MIGRAÇÕES
  [ ] Código lê coluna que migration não criou / vice-versa
  [ ] Enum/estado impossível na state machine
  [ ] Trigger/cron SQL conflitante com edge cron

FRONTEND
  [ ] UI liga automação sem deixar claro o impacto
  [ ] Kill switch UI dessincronizado do banco
  [ ] Race no chat (envio duplicado)

═══════════════════════════════════════════════════════════════════════════════
8) FORMATO DE SAÍDA OBRIGATÓRIO
═══════════════════════════════════════════════════════════════════════════════

Responda em PORTUGUÊS (Brasil), nesta estrutura:

## 1. Veredito executivo (máx. 10 linhas)
Estado geral: estável / instável / perigoso. Top 5 riscos.

## 2. Mapa do sistema (como você entendeu)
Diagrama textual curto dos fluxos P0–P2 (ou escopo pedido).

## 3. Achados (tabela)
| ID | Sev | Domínio | Arquivo:linha | Sintoma | Como quebra | Evidência |
|----|-----|---------|---------------|---------|-------------|-----------|

## 4. Matriz de gates (envio)
Para cada caminho de envio auditado:
| Caminho | bot_global | automation_toggle | dry/dark | proactive-guard | Auth | Lacuna? |

## 5. Funções auditadas nesta rodada
Lista G1… com status: OK / RISCO / NÃO AUDITADA.

## 6. Inconsistências doc ↔ código
Ex.: vendedora/, README “deploy 0%”, skill E2E paths mortos.

## 7. Plano para deixar redondo (sem apagar nada)
Ordenado por severidade:
  1) patch mínimo
  2) teste dryRun/shadow
  3) validação manual
  4) só então rollout canary
Nunca: “ligar tudo de uma vez”.

## 8. Próximas fatias
O que ficou de fora por contexto.

## 9. Comandos seguros sugeridos (não executar envio real)
Exemplos:
  - npm test / vitest nos _shared com *_test.ts
  - node --test worker-portal-2/test/
  - invocar fluxo-b-ai com dryRun:true
  - skill vendedora-e2e-conversations
  - NÃO: generate OTP, dryRun:false, ligar automation_toggles

═══════════════════════════════════════════════════════════════════════════════
9) TOM E QUALIDADE
═══════════════════════════════════════════════════════════════════════════════

- Seja concreto: arquivo, função, condição, efeito.
- Não invente. Se não leu, diga “não verificado”.
- Prefira poucos achados S0/S1 verdadeiros a dezenas de nitpicks.
- Pense como responsável por clientes reais no WhatsApp.
- Lema do projeto: “Nenhuma linha de código vale mais do que a estabilidade do sistema inteiro.”

Comece agora pela exploração real do repo no escopo pedido.
Se o usuário não especificou escopo, comece por P0 + P1 e entregue o relatório parcial completo nesse formato.
```

---

## Notas para quem vai colar o prompt

1. **Não peça “analise tudo e corrija” numa tacada só** — 191 functions + 706 migrations estouram contexto. Use fatias P0→P6.
2. **Peça sempre “somente relatório”** na primeira rodada; patches só com achado ID explícito.
3. **Depois do relatório**, um segundo comando típico:

```text
Implemente APENAS o fix do achado S0-01 (cite o ID).
Patch mínimo, sem apagar nada, sem ligar automação.
Mostre plano → arquivos afetados → risco → teste dryRun.
Depois faça a mudança e rode a auditoria pós-execução (o que mudou / impacto).
```

4. Modelo: GPT 5.6 (pool API). Para exploração barata no Cursor, Grok 4.5 first-party também roda este prompt em fatias.
`)
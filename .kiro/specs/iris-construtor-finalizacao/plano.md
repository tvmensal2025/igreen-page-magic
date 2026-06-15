# Plano de finalização — Iris construtora + Config de IA do Superadmin

Documento de planejamento. Nada aqui é aplicado automaticamente: cada parte é
revisada e executada sob demanda. As partes que tocam edge functions exigem
**deploy via GitHub Actions** (ver `.kiro/steering/deploy.md`) e algumas encostam
no Cérebro — então só seguem com OK explícito.

## Contexto

Nas últimas iterações construímos:
- **Estúdio da Iris** (3 colunas): trilha de passos · edição · celular com preview
  e cliente fictício (João Silva). Determinístico, com testes.
- **Painel de IA no Superadmin** (Parte A): perfil, provedor, KB-only e áudio —
  o frontend salva em `settings`, mas o backend ainda **não lê** essas chaves.

Estado atual validado: `tsc` 0 erros, `vite build` ok, 53 testes passando.
Cobertura do fluxo D = 100% (conta, documento, e-mail, telefone, finalizar).

## Visão geral das partes

| Parte | Escopo | Toca backend? | Precisa deploy? | Risco |
|-------|--------|---------------|------------------|-------|
| 1 | Commit do frontend do fluxo | Não | Não | Baixo |
| 2 | Mídia por tipo no modal (media_order) | Não (só grava jsonb) | Não | Baixo |
| 3 | Ligar settings de IA no backend | Sim | Sim | Médio |
| 4 | KB-only agressivo + fallback "nunca erro" | Sim (orquestrador) | Sim | Alto |
| 5 | Transcrição de áudio sob flag | Sim (webhook) | Sim | Médio |

Ordem recomendada: 1 → 2 → 3 → 5 → 4 (deixa o que encosta no Cérebro por último).

---

## Parte 1 — Commit do frontend do fluxo (pronto, seguro)

**O quê:** versionar o que já está feito e validado.

Arquivos:
- `src/components/admin/flow-builder/GuidedStepDialog.tsx`
- `src/components/admin/flow-builder/ConversationPreview.tsx` (novo)
- `src/components/admin/flow-builder/flowTypes.ts`
- `src/pages/FluxoBuilder.tsx`
- `src/components/superadmin/AIControlPanel.tsx`
- testes: `flowCoverage.test.ts`, `guidedCaptureCatalog.test.ts`, `simulatedClientReply.test.ts`

Cuidados:
- **NÃO commitar** `.kiro/settings/mcp.json` (token GitHub em texto puro — ver steering).
  Rodar `git reset .kiro/settings/mcp.json` antes do commit.
- Separar do trabalho de produtos/proposta que está no working tree (não é desta sessão).
- Migration `add_capture_name_to_step_type_check` já foi aplicada no banco via MCP;
  garantir que o arquivo SQL correspondente está versionado em `supabase/migrations/`.

Aceite: `npx tsc --noEmit` e `npx vite build` exit 0; testes do flow-builder verdes.

---

## Parte 2 — Mídia por tipo no modal (selecionar e ordenar)

**Problema:** hoje o botão de mídia é só on/off e o preview mostra os 3 tipos
fixos. O consultor quer escolher quais (só áudio, só imagem, texto+vídeo) e a
ordem (sequência 1·2·3·4), tudo num passo.

**Base que já existe:** `bot_flow_steps.media_order` (jsonb, lista de kinds) é lido
pelo runtime (`manual-step-send`, `evolution-webhook`, `conversational`) com
ordem `["audio","image","video","text","document"]` e precedência
`consultants.flow_step_media_order` > `media_order` do passo > default.

**Implementação (frontend only):**
1. No `GuidedStepDialog`, trocar o toggle único por chips: **Texto · Áudio · Imagem · Vídeo**.
2. Clicar adiciona à sequência numerada (1·2·3) na ordem do clique; permitir remover/reordenar.
3. Gravar a sequência em `seed.media_order` (array de kinds em minúsculas).
4. "Texto" = o `message_text` que ele digita; áudio/imagem/vídeo abrem o upload
   depois de salvar (caminho A, via `slot_key` + `StepMediaPanel`).
5. `ConversationPreview` passa a renderizar **só os tipos escolhidos**, na ordem.

Aceite:
- Selecionar só áudio → preview mostra só o chip de áudio.
- Selecionar texto+vídeo nessa ordem → `media_order = ["text","video"]`.
- Teste novo travando o mapeamento chips → `media_order`.

Risco: baixo (grava num campo jsonb já suportado pelo runtime).

---

## Parte 3 — Ligar as settings de IA no backend (Parte A vira real)

**Problema:** o painel do Superadmin salva 4 chaves em `settings`
(`ai_profile_global`, `ai_provider_global`, `ai_kb_only_mode`, `ai_audio_transcribe`)
mas o backend não as lê. Hoje `ai-config.ts` lê `consultants.ai_profile`.

**Implementação (edge function — precisa deploy):**
1. Em `supabase/functions/_shared/ai-config.ts`:
   - Criar `getGlobalAiSettings(supabase)` que lê as chaves de `settings` com
     cache de 60s (igual ao cache de `ai_profile` que já existe).
   - `resolveProfile`: precedência **global do Superadmin > consultor > default**.
     (Decidir com o usuário: global vence o consultor? Recomendo sim, é o pedido.)
   - `resolveProvider`: mesma lógica para `ai_provider_global`.
2. Manter fallback seguro: se a leitura de `settings` falhar, usa o
   comportamento atual (`consultants.ai_profile` / default `balanced`/`google`).

Aceite:
- Mudar perfil no painel → próxima resposta usa o modelo do novo perfil
  (verificável no log `modelChain`).
- Falha de leitura de `settings` não quebra o bot (cai no default).

Risco: médio. É leitura adicional; não muda a lógica de decisão, só a origem do perfil.

---

## Parte 4 — KB-only agressivo + fallback "nunca dar erro"

**Pedido do usuário:** "boas respostas que já temos gravadas e nunca dê erro."

**Estado atual:** já existe `ai_kb_only_mode` (true no banco), o `ai-faq-answerer`
prioriza respostas gravadas, e há handoff quando a IA não sabe. Esta parte deixa
isso mais rígido e seguro.

**Implementação (orquestrador — ENCOSTA NO CÉREBRO, fazer por último):**
1. Quando `ai_kb_only_mode = true`:
   - Tentar **só** FAQ/respostas gravadas + RAG sobre conhecimento.
   - Se não houver match com confiança → **não** chamar LLM livre; usar resposta
     segura padronizada + reapresentar o passo (reentry), ou handoff.
2. "Nunca dar erro": em qualquer exceção da IA (quota, timeout, 429), enviar uma
   resposta de cortesia determinística + reentry, nunca silêncio nem erro cru.
   (Boa parte já existe em `respondAndReentry`; aqui garantimos cobertura total.)
3. Respeitar cooldown e limite de dúvidas por passo (já existem).

Aceite:
- Com KB-only ligado e pergunta sem match → resposta segura + volta ao passo,
  sem chamar LLM livre.
- Simular falha de IA → cliente recebe cortesia + reentry, nunca erro.

Risco: ALTO — mexe no caminho quente do orquestrador. Só com o Cérebro liberado
e testes de regressão. Recomendo rollout por feature flag (dark → canary → on).

---

## Parte 5 — Transcrição de áudio sob flag

**Pedido:** "mesmo que o usuário mande áudio, conseguimos entender."

**Base existente:** `ai-transcribe-media` + `ensureAudioTranscript` já transcrevem
áudio para texto e o fluxo trata como mensagem normal.

**Implementação (webhook — precisa deploy):**
1. Antes de transcrever, checar `ai_audio_transcribe` (global, via Parte 3).
2. Se a transcrição falhar/estiver desligada: responder pedindo gentilmente para
   escrever ("Não consegui ouvir seu áudio agora, pode me escrever?") e reapresentar
   o passo — sem travar.

Aceite:
- Áudio com flag ligada → transcreve e segue o fluxo.
- Falha de transcrição → pede para escrever + reentry, nunca erro.

Risco: médio.

---

## Riscos de comportamento já auditados (não precisam de ação)

Confirmado por leitura de código nesta sessão:
- **"Voltar ao passo"**: `resolveStepReentry` tem 3 camadas de fallback (mapa
  legado → por tipo → por conteúdo). Nenhum passo ativo do fluxo D fica sem
  reentry. Único passo "message" sem `?`/botão (`d_simular_valor`) usa o próprio
  texto como reentry. OK.
- **Nome vazio**: `render-vars.ts` + `firstNameVoc` tratam `{{nome}}` ausente
  (sem vírgula órfã, limpa asteriscos/espaços). Bug de produção já corrigido. OK.
- **Frases que confundem**: `NON_NAME_RESPONSES` impede tratar "não quero",
  "golpe", etc. como nome. OK.

## Checklist final de publicação (quando tudo estiver pronto)

- [ ] `npx tsc --noEmit` exit 0
- [ ] `npx vite build` exit 0
- [ ] Testes do flow-builder verdes
- [ ] Migrations versionadas em `supabase/migrations/`
- [ ] `.kiro/settings/mcp.json` fora do commit + token revogado no GitHub
- [ ] Deploy das edge functions via workflow (Partes 3, 4, 5)
- [ ] Confirmar no Supabase (`list_edge_functions`) `updated_at` recente
- [ ] Advisors de segurança sem novos ERROS

---

## STATUS DE EXECUÇÃO (2026-06-15)

| Parte | Status | Observação |
|-------|--------|------------|
| 1 | Pronto (frontend) | tsc 0, build ok, 57 testes. Falta o **commit** (sem mcp.json). |
| 2 | **Feito** | Chips de tipo (texto/áudio/imagem/vídeo) com ordem numerada → `media_order`. Preview reflete só os tipos escolhidos. Teste `mediaOrder.test.ts`. |
| 3 | **Feito** | `getGlobalAiSettings` + precedência global>consultor>default em `ai-config.ts` (profile e provider). `deno check` ok. |
| 4 | **Feito (conservador)** | `isKbOnlyMode` em `ai-decisions.ts`; gate no `respondAndReentry` de evolution e whapi: KB-only ligado → não chama LLM livre, cai no fallback seguro + reentry. `deno check` ok. |
| 5 | **Feito** | Flag `ai_audio_transcribe` checada antes da transcrição inbound no evolution e whapi. `deno check` ok. |

### Arquivos alterados nesta execução (backend — exigem DEPLOY)
- `supabase/functions/_shared/ai-config.ts` (Parte 3)
- `supabase/functions/_shared/ai-decisions.ts` (Parte 4 — helper isKbOnlyMode)
- `supabase/functions/evolution-webhook/index.ts` (Parte 5)
- `supabase/functions/evolution-webhook/handlers/bot-flow.ts` (Parte 4)
- `supabase/functions/whapi-webhook/index.ts` (Parte 5)
- `supabase/functions/whapi-webhook/handlers/bot-flow.ts` (Parte 4)
- `supabase/migrations/20260615120000_add_capture_name_to_step_type_check.sql` (já aplicada via MCP; versionada agora)

### Arquivos alterados (frontend — só build, sem deploy de função)
- `GuidedStepDialog.tsx`, `ConversationPreview.tsx`, `flowTypes.ts`, `useFlowStepsCrud.ts`,
  `FluxoBuilder.tsx`, `AIControlPanel.tsx` + testes.

### O QUE FALTA PRA "ESTAR NO AR" (ação do usuário)
1. **Commitar** (frontend + edge functions + migration), **sem** `.kiro/settings/mcp.json`
   (`git reset .kiro/settings/mcp.json` antes). Token do GitHub ainda a revogar.
2. **Push** para `origin main` (rebase se necessário).
3. **Disparar o deploy** das edge functions (workflow `deploy-edge-functions.yml`,
   `function_name=all` porque `_shared/` mudou) — ver `.kiro/steering/deploy.md`.
4. Confirmar no Supabase (`list_edge_functions`) `updated_at` recente.
5. Validar no painel do Superadmin: mudar perfil/provedor/KB-only/áudio e ver efeito
   (até 60s de cache).

### Recomendação de rollout da Parte 4 (KB-only)
Como mexe no caminho quente, recomendo: deixar `ai_kb_only_mode=true` (já é o default
no banco) e observar 24–48h os logs `[respondAndReentry] source=...` — se a taxa de
`fallback` subir demais (FAQ não cobre), reforçar a base de FAQ antes de manter ligado.

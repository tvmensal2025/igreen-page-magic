# Plano: Fluxo D (botões) + Fluxo B (IA livre)

## Objetivo
Reduzir o produto a duas estratégias de atendimento:
- **Fluxo D** — atual, máquina de estados com botões. Inalterado.
- **Fluxo B (NOVO)** — IA conduz do "oi" até o fechamento. Usa FAQ + base de conhecimento. Quando detecta intenção de fechar, pede foto da conta de luz, dispara OCR e finaliza no Portal2.

Toggle de roteamento: **distribuição igualitária round-robin** entre todas as variants ativas do consultor. 2 ativas = 50/50; se um dia surgir uma 3ª, vira 33/33/33.

---

## Etapa 1 — Limpeza de fluxos (migration de dados)

Hoje existem 12 `bot_flows` (variants A, B, C, D, E, F, G) e 133 `bot_flow_steps`, vários órfãos de consultores já apagados.

Manter apenas:
- `Fluxo Whapi (botões)` — variant D, Rafael — **referência do D**
- `Fluxo Padrão (B - sem audio)` — variant B, Rafael — **será reaproveitado como shell do novo B IA** (mas os `bot_flow_steps` dele serão apagados porque o novo B não usa steps)

Apagar:
- Todos os `bot_flows` com `variant IN ('A','C','E','F','G')`
- Todos os `bot_flows` de consultores que não existem mais (953f…, 81fe…, f08b…)
- `bot_flow_steps`, `bot_step_transitions`, `bot_flow_qa*` órfãos
- `flow_variants` (legado A/B do rollout antigo) e `flow_router_rules` (3 regras de roteamento por palavra-chave que não fazem mais sentido)
- `rollout_config` zerado / desativado

## Etapa 2 — Novo roteador igualitário

Substituir o rollout canary 5% por um roteador determinístico:
- Função SQL `pick_flow_variant(consultant_id, customer_phone)` que lista as variants ativas do consultor e usa `hash(phone) mod N` para escolher uma — garante distribuição igualitária estável (mesmo lead sempre cai na mesma).
- Webhook do WhatsApp (`whapi-webhook`) chama essa função no primeiro turno do lead novo e grava `customer.flow_variant`.
- Turnos seguintes apenas leem `customer.flow_variant` e despacham para o handler correto.

## Etapa 3 — Reconstrução do Fluxo B (IA livre)

Substituir o conteúdo de `supabase/functions/_shared/cerebro/` (que hoje mistura lógica de máquina de estado) por uma engine de IA pura específica para B:

**Novo módulo** `supabase/functions/_shared/fluxo-b/`:
- `agent.ts` — loop principal com AI SDK (`streamText` + `tool` + `stopWhen(stepCountIs(50))`), modelo `google/gemini-3-flash-preview` via Lovable AI Gateway.
- `prompt.ts` — system prompt da vendedora iGreen (persona, regras, objetivo de fechar com foto da conta).
- `tools.ts` — tools que o modelo pode chamar:
  - `buscar_conhecimento(query)` → RAG em `ai_knowledge_sections` (27 entries, embeddings já existentes via `embed-knowledge`).
  - `registrar_dados_lead(nome?, cidade?, conta_media?)` → grava em `customers`.
  - `solicitar_foto_conta()` → marca `customer.aguardando_foto=true` e envia mensagem pedindo a foto.
  - `processar_foto_conta(media_id)` → chama OCR existente, extrai dados, devolve para o modelo.
  - `finalizar_cadastro(payload)` → chama Portal2 (fluxo já existente) e envia link de confirmação.
  - `transferir_humano(motivo)` → marca handoff e pinga consultor.

**Edge function** `fluxo-b-ai/index.ts` reescrita como entrypoint real (não mais wrapper do cérebro), recebendo turnos do `whapi-webhook` e devolvendo as mensagens a enviar.

**Memória de conversa**: usa `conversations` + `bot_messages` já existentes; cada turno reenvia o histórico completo para o modelo.

## Etapa 4 — Painel do Fluxo B (frontend)

`FluxoBEditor` deixa de ser editor de steps e vira **Painel de IA**:
- Aba **Persona**: textarea da persona/regras (salvo em `ai_agent_config` do consultor).
- Aba **Conhecimento**: lista das 27 seções de `ai_knowledge_sections`, com botão de re-embed.
- Aba **Fechamento**: regras (quando pedir foto, modelo do link Portal2, mensagem pós-cadastro).
- Aba **Simulador**: chat de teste que chama `fluxo-b-ai` com `dryRun=true`.

## Etapa 5 — Toggle de variants no painel do consultor

Na tela de configuração do consultor, lista checkbox simples:
- ☑ Fluxo D (botões)
- ☑ Fluxo B (IA livre)

Marcar/desmarcar liga/desliga `bot_flows.is_active`. O roteador da Etapa 2 lê isso em tempo real.

## Etapa 6 — Fluxo D intocado
Nenhuma mudança em `_shared/cerebro` específico do D, em `flow-d-health-cron`, `flow-d-stuck-watchdog` nem nos steps existentes do "Fluxo Whapi (botões)".

---

## Detalhes técnicos

**Tabelas alteradas**
- `customers`: adicionar `aguardando_foto boolean default false` e (se ainda não existir) `flow_variant text`.
- Nenhuma RLS nova (reaproveita as existentes do `customers`).

**Tabelas limpas (DELETE, não DROP)**
- `bot_flows`, `bot_flow_steps`, `bot_step_transitions`, `bot_flow_qa`, `bot_flow_qa_media`, `bot_flow_qa_triggers`, `flow_variants`, `flow_router_rules`.

**Edge functions**
- Reescrever: `fluxo-b-ai`.
- Novas: nenhuma (reaproveita `embed-knowledge`, OCR existente, Portal2 existente).
- Apagar candidatas (a confirmar caso a caso na execução): `flow-engine-rollout-cron`, `flow-engine-v3-rollout-cron`, `flow-spreadsheet-review`, `flow-from-template`, `flow-step-suggest`, `flow-ai-rewrite` — só fazem sentido no mundo multi-variant que vai sumir. Confirmo antes de remover.

**Modelo / custo**
- `google/gemini-3-flash-preview` (default Lovable AI).
- Tools curtas, schemas minúsculos para evitar "too many states" do Gemini.
- `stopWhen(stepCountIs(50))` no loop de tools.

**Regras de segurança a manter**
- Cliente nunca vem da extensão pelo Fluxo B (regra atual mantida): leads do WhatsApp → CRM → Fluxo B/D; extensão → pós-venda com "Aguardando autorização".

---

## Ordem de execução
1. Migration: schema (`aguardando_foto`, função `pick_flow_variant`).
2. Migration de dados: wipe dos flows extras.
3. Reescrever `_shared/fluxo-b/*` + `fluxo-b-ai/index.ts`.
4. Atualizar `whapi-webhook` para usar `pick_flow_variant` e despachar B vs D.
5. Refazer `FluxoBEditor` no frontend.
6. Adicionar checkbox de variants no painel do consultor.
7. Testar end-to-end: lead novo → 50% cai em D, 50% em B → no B, IA conversa → pede foto → OCR → Portal2.

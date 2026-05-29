## Diagnóstico

Analisei a última conversa do **5511971254913 (BRUNO MANOEL DOS SANTOS)** — consultor `0c2711ad` (Rafael), step atual `aguardando_conta`, flow custom ativo (variante D).

### O que aconteceu nos logs
1. Lead clicou "Como funciona" → bot mandou áudio + vídeo + texto (`d_como_funciona`)
2. Lead: **"Vai vir 2 boleto?"** → `[ai-faq] handoff sugerido` → fluxo default → mandou `d_duvidas` (botões "simular/outra/humano") **sem responder a pergunta**
3. Lead: **"Estou perguntando se vai vir 2 boleto ou apenas 1?"** → mesma coisa → bot foi para `d_pedir_conta` ("me manda foto da conta") **ignorando a pergunta**
4. Lead: **"E se eu não pagar?"** → aí sim `[midflow-qa] hit=false → respondAndReentry (IA + reentry)` respondeu via IA

### Causa raiz

Existem **dois motores** de bot e cada um liga a IA de um jeito diferente:

| Motor | Arquivo | Usa orquestrador GPT-5.5? |
|---|---|---|
| Legado `runBotFlow` | `bot-flow.ts` linhas 1081 e 1903 | ✅ Sim — `runOrchestrator` com persona, memória, RAG |
| Custom `runConversationalFlow` | `conversational/index.ts` linha 1484 | ❌ Não — só `answerFaqWithAI` simples (sem persona, sem memória, sem cascata de modelos) |

Como Rafael tem flow custom ativo (`bot_flows.is_active=true`), todo lead dele cai no `runConversationalFlow` — que **não tem o orquestrador**. Quando o `answerFaqWithAI` decide `shouldHandoff` (caso comum para perguntas livres), o fluxo simplesmente **devolve o lead pro passo default sem responder** — exatamente o que o usuário viu.

O `respondAndReentry` (que respondeu "E se eu não pagar?") só roda no motor legado, não no conversational.

## Plano

### 1. Migrar `conversational/index.ts` para usar `runOrchestrator`
Substituir o bloco `if (cls.intent === "tem_duvida" && !hasCapture)` (linhas 1476–1516) por chamada a `runOrchestrator` do `_shared/ai-orchestrator.ts`, igual ao bot-flow.ts faz:

- Injeta `customer.conversation_summary` (memória persistente)
- Injeta `consultants.ai_persona`
- Usa cascata GPT-5.5 → 5.4 → 5-mini com fallback automático
- Loga em `ai_decisions` e `ai_costs`
- Honra `shouldHandoff` mas, quando confidence ≥ 0.6 e action="answer", **responde** em vez de só "deixar fluxo default tratar"

### 2. Adicionar fallback "respondAndReentry-like" no conversational
Quando o orquestrador retorna reply válido mas não casa transition, emitir a resposta da IA e **reentrar no passo atual** (em vez de pular para `d_pedir_conta`). Espelha o comportamento do `respondAndReentry` do bot-flow.ts.

### 3. Fire-and-forget de `maybeUpdateSummary`
Depois do orquestrador, chamar `_shared/ai-summary.ts → maybeUpdateSummary` pra atualizar `customers.conversation_summary` a cada ~6 turnos — assim a memória persistente passa a funcionar nos flows custom também.

### 4. Métricas
Adicionar 2 logs estruturados (`[conversational-orch] hit/miss/handoff`) pra `SaudeBot` mostrar a diferença antes/depois.

## Detalhes técnicos

- **Arquivos editados**: apenas `supabase/functions/whapi-webhook/handlers/conversational/index.ts`
- **Sem migration** — `ai_costs`, `ai_decisions`, `consultants.ai_persona`, `customers.conversation_summary` já existem
- **Sem novos segredos** — `LOVABLE_API_KEY` já configurado
- **Rollback**: kill switch via `consultants.ai_persona = NULL` faz o orchestrator cair no modo "sem persona"; remoção do bloco volta ao comportamento atual
- **Custo estimado**: +1.5-1.8× no consultor Rafael (≈15-25% dos turnos chamam GPT-5.5, resto fica em Gemini Flash via triage)

## Não está no escopo
- Tocar no motor legado (`bot-flow.ts`) — já está correto
- Mudar regras de captação (OCR, cadastro, OTP)
- Mexer no `worker-portal-2` / cobertura CPFL (assunto separado das últimas mensagens)

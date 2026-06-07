## Skill: `vendedora-e2e-conversations`

Roda 20 conversas simuladas end-to-end (do "oi" até `portal_submitting` ou handoff) contra a edge function `fluxo-b-ai` em modo `dryRun`, e devolve transcrições + relatório de diagnóstico. Reusável sempre que mexer na vendedora V2.

### O que a skill faz, em ordem

1. Recebe args: `--consultant-id <uuid>` (default `81fe673d-253e-46bc-993a-85c286ae54b5`), `--out <dir>` (default `/mnt/documents/vendedora-runs/<timestamp>/`), `--only scripted|persona|all` (default `all`), `--max-turns 25`.
2. Carrega 10 **scripts determinísticos** (lead "fala" turnos pré-definidos) cobrindo:
  - happy path curto / happy path longo
  - objeção "golpe", "boleto", "fidelidade", "obra/aluguel", "prazo"
  - lead pede foto antes da hora (testa trava anti-foto-cedo)
  - lead repete a mesma dúvida 3× (testa anti-loop / variantes)
  - lead muda de ideia ("não quero mais")
  - lead manda nome/valor juntos no primeiro turno
  - lead manda mídia direto (conta) sem confirmar interesse
3. Carrega 10 **personas LLM** — cada um é um system prompt curto ("você é um cliente cético", "aposentado desconfiado", "jovem apressado", "reclamão que já foi enganado", etc.) chamado via Lovable AI Gateway (`google/gemini-3-flash-preview`) com histórico da conversa, devolvendo a próxima fala como cliente.
4. Loop por conversa: até `max-turns` ou até a vendedora retornar `shouldHandoff` ou `conversationStepUpdate === "portal_submitting"`:
  - chama `POST {SUPABASE_URL}/functions/v1/fluxo-b-ai` com `{ consultantId, inboundText, dryRun: true, history, customerState }`
  - acumula `history` (front-end faz isso porque dryRun não persiste)
  - propaga `customerState` (name, electricity_bill_value, conversation_step, fluxo_b_state, conversation_summary) entre turnos lendo do `dryRunLog`
  - registra: turno, lead msg, bot reply, etapa antes/depois, modelo usado, latência
5. Escreve por conversa: `<out>/conv-NN-<slug>.md` com a transcrição em markdown + bloco JSON de debug ao final.
6. Escreve `<out>/REPORT.md` com:
  - tabela: conversa | perfil | turnos | etapa final | handoff? | latência total | modelos usados
  - contagem de problemas detectados (loops, repetições, foto pedida antes da consideração, crash)
  - top 5 turnos com maior latência
  - lista de conversas que não chegaram a `portal_submitting`
7. Stdout enxuto: barra de progresso (`[3/20] persona-cetico ... ✓ 14 turnos, 38s`) + path final do REPORT.

### Estrutura de arquivos

```
.agents/skills/vendedora-e2e-conversations/
├── SKILL.md
├── references/
│   ├── scripted-scenarios.md   # os 10 roteiros + critério de sucesso de cada
│   └── personas.md             # os 10 system prompts dos personas LLM
└── scripts/
    └── run.ts                  # CLI (bun/deno-compatível, usa fetch + LOVABLE_API_KEY)
```

### SKILL.md (esqueleto)

- `name: vendedora-e2e-conversations`
- `description: Roda 20 conversas simuladas (10 scripts + 10 personas LLM) contra a vendedora Fluxo B V2 via edge function dryRun e gera relatório de transcrições + diagnóstico. Usar antes/depois de mexer em vendedora/, fluxo-b-ai, templates, state-machine ou extractors.`
- Corpo: como invocar (`bun /tmp/run.ts --consultant-id ... --out ...`), pré-requisitos (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `LOVABLE_API_KEY` no env), o que o relatório indica, ponteiros para as references.

### Detalhes técnicos

- HTTP: `fetch(SUPABASE_URL + "/functions/v1/fluxo-b-ai", { headers: { apikey, Authorization: Bearer anon } })`.
- `customerState` é o jeito do tester manter estado entre turnos (já suportado pelo `index.ts` do edge — linha 111). A skill faz mesma coisa: a cada turno lê o último update do `dryRunLog` e mescla no próximo `customerState`.
- Persona LLM chama `https://ai.gateway.lovable.dev/v1/chat/completions` com `model: google/gemini-3-flash-preview`, `temperature: 0.9`. Falha de persona vira "ok, entendi" pra não travar o loop.
- Detecção de problemas no REPORT (heurísticas):
  - **loop**: mesma resposta do bot 2× seguidas (hash exato).
  - **repetição**: mesma resposta do bot em 3 turnos da janela de 5.
  - **foto cedo**: bot pede foto/conta antes de `interesse_confirmado` virar true.
  - **crash**: status HTTP != 200 ou `error` no body.

### Custos / latência esperada

- 10 scripts × ~12 turnos × ~6s/turno via cascade = ~12 min.
- 10 personas × 12 turnos × (6s vendedora + ~1.5s persona LLM) = ~15 min.
- Total ~25-30 min sequencial. Skill roda 3 conversas em paralelo (`Promise.all` em chunks) → ~10 min.
- Custo LLM persona: ~200 chamadas Gemini Flash, dezenas de centavos.

### Validação após apply

1. `skills--apply_draft .agents/skills/vendedora-e2e-conversations`
2. Rodar uma vez: `bun /tmp/run.ts --only scripted --max-turns 6` (smoke test rápido, ~2 min).
3. Conferir que `/mnt/documents/vendedora-runs/<ts>/REPORT.md` foi gerado e que pelo menos 1 conversa chegou a `portal_submitting`.

### Fora de escopo

- Não persiste no banco (dryRun).
- Não testa nudge (continua no caminho legacy).
- Não mede custo USD via `ai_costs` (só latência local).
- Não substitui testes unitários — é teste de comportamento end-to-end.

Posso aplicar? sim serao simulados reais para testar e entender o fluxo
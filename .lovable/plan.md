# Análise + melhoria do Fluxo B (IA livre)

## Diagnóstico

### 1. "2 fluxos juntos" — o que está acontecendo

Olhando o pipeline:

- `whapi-webhook/handlers/bot-flow.ts:614-648` — Quando `flow_variant === "B"` e é texto, chama `runFluxoBAI` e **retorna imediatamente** (`return { reply: "", updates: {} }`). Não há disparo paralelo do fluxo A/D, o caminho é exclusivo.
- `_shared/fluxo-b-ai.ts:243` — `reply = (chosen.text || "").trim() || buildProfessionalFallback()`. Só usa o fallback quando o modelo devolveu vazio. Sem duplicação.

Conclusão: **não há dois fluxos disparando**. O que o usuário percebe como "2 fluxos juntos" é a **própria IA gerando duas mensagens em um único turno** — porque o super prompt atual permite respostas de "2 a 4 linhas" e ainda traz a estrutura de abertura em 3 linhas. O modelo cola: (a) saudação/recapitulação + (b) próxima pergunta, parecendo duas mensagens emendadas. Há também a "Abertura" em 3 partes que o modelo às vezes repete mesmo quando já existe histórico.

Causa raiz no prompt:
- Bloco `# Abertura` exige saudação + gancho + pedido de nome **em 3 linhas**. Modelos fracos replicam esse padrão fora da abertura, gerando o efeito "duas mensagens".
- `# Tom` permite "2 a 4 linhas" sem regra de "uma pergunta por turno".
- Não há instrução explícita "1 mensagem = 1 pergunta concreta".

### 2. "Não tem negrito"

O prompt diz literalmente **"Sem markdown"**. Resultado: o modelo não usa `*texto*`, que é o padrão de **negrito do WhatsApp**. O usuário quer destaque visual nos números importantes (valor da conta, economia estimada, percentual). É só liberar e instruir o formato WhatsApp (não Markdown padrão).

WhatsApp suporta: `*negrito*`, `_itálico_`, `~tachado~`, ```` ``` ```` `monoespaçado```` ``` ````. Vamos liberar apenas `*negrito*` para evitar visual carregado.

## Mudanças

### A. `supabase/functions/_shared/fluxo-b-prompt.ts` — reescrever `DEFAULT_PROMPT`

Reorganizar regras com foco em três coisas:

1. **1 mensagem = 1 pergunta**. Máximo 3 linhas. Nunca empilhar saudação + recapitulação + pergunta nova no mesmo turno (essa era a fonte do "2 fluxos juntos").
2. **Abertura** vira opção curta: 2 linhas no máximo, gancho de valor + pergunta do nome. E é proibido repetir o padrão de abertura quando já há histórico (deduzido por `# Memória da conversa` presente).
3. **Liberar negrito WhatsApp** com regra clara:
   - Use `*texto*` (negrito WhatsApp) para **destacar valores e percentuais críticos**: valor da conta, economia mensal/anual, percentual (ex.: `economia de *até 20%*`, `R$ *350,00*`).
   - Nunca use `**texto**` (Markdown), só `*texto*`.
   - Sem itálico, sem tachado, sem listas markdown. Só negrito pontual.
4. Reforçar tom profissional e remover gatilhos que fazem o modelo "explicar antes de perguntar".

### B. Pequeno ajuste em `fluxo-b-ai.ts` — sanitizar saída

Após receber `chosen.text`, aplicar uma normalização leve antes de devolver:

- Trocar `**texto**` → `*texto*` (caso o modelo escape em Markdown).
- Cortar linhas em branco duplicadas (`\n{3,}` → `\n\n`).
- Se a resposta tiver mais de **4 linhas não-vazias**, manter apenas as 4 primeiras + a última pergunta detectada (heurística simples para impedir "2 mensagens em 1").
- Limite duro: **600 caracteres** por resposta; trunca preservando última frase.

Isso garante que mesmo se o modelo errar, o usuário nunca veja duas mensagens emendadas.

### C. Atualizar a persona salva do Rafael (consultor atual)

A persona personalizada do Rafael em `ai_persona_fluxo_b` foi gravada na rodada anterior com o tom antigo (sem negrito, "2 a 4 linhas"). Vou regravar com o novo template — mantendo o nome dele como representante.

## Arquivos tocados

- `supabase/functions/_shared/fluxo-b-prompt.ts` — novo `DEFAULT_PROMPT`.
- `supabase/functions/_shared/fluxo-b-ai.ts` — função `sanitizeReply()` aplicada antes do `return`.
- `update` em `public.consultants` (somente Rafael) reescrevendo `ai_persona_fluxo_b` para o novo template.

Sem migration de schema, sem mexer em variantes A/C/D, sem mexer no roteamento do webhook.

## Validação

- Abrir `/admin/fluxos` (variante B) no tester:
  - "oi" → deve responder em até 3 linhas, com negrito no número (`*até 20%*`), e **só uma pergunta**.
  - Depois de informar nome → próxima resposta pergunta valor da conta em 1-2 linhas, com `*R$*` se citar valor.
  - Nunca repetir o gancho de abertura após o primeiro turno.

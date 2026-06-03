## Problemas encontrados na auditoria

**1. Tom errado — "amigão" em vez de vendedor**
- `supabase/functions/_shared/fluxo-b-prompt.ts` (DEFAULT_PROMPT, linhas 12-26): define tom "próximo, sem formalidade", mensagens curtíssimas (1-3 linhas). Para venda consultiva da iGreen isso soa amador.
- `supabase/functions/_shared/fluxo-b-ai.ts` linha 173: fallback final é literalmente **"Pode me contar um pouquinho mais?"** — frase que você citou. Aparece sempre que o modelo devolve vazio.

**2. Bot "reseta" depois de pouco tempo**
- `fluxo-b-ai.ts` só carrega **últimos 16 turnos** (linha 67) como histórico bruto.
- A memória de longo prazo (`customers.conversation_summary`) **nunca é atualizada no Fluxo B**: a função `maybeUpdateSummary` só roda em `conversational/index.ts` (dúvidas) e em `bot-flow.ts:2092` (fluxos A/D). Fluxo B passa direto.
- Resultado: depois de ~16 mensagens o lead some do contexto e o bot age como conversa nova.
- Não há nenhum gatilho automático que zere `conversation_summary` por inatividade — então o problema é só ele nunca ter sido **escrito**. O comando "resetar" continua sendo manual (botão admin / migration), exatamente como você quer.

## O que vou fazer

### A. Reescrever a persona padrão do Fluxo B (vendedor profissional)
Arquivo: `supabase/functions/_shared/fluxo-b-prompt.ts`

- Trocar `DEFAULT_PROMPT` por uma persona de **consultor(a) de vendas iGreen Energy**:
  - Tom cordial mas **profissional**, postura de quem está conduzindo um cadastro comercial — não "amigo".
  - Nunca usar diminutivos infantilizados ("pouquinho", "rapidinho", "tudo bem aí?").
  - Sempre direcionar para o próximo passo do funil (nome → valor → conta → documento).
  - Confirmar dados explicitamente antes de seguir; nunca inventar economia ou prazos.
  - Mensagens objetivas (2-4 linhas), zero markdown, emojis só quando necessário (✅ confirmação, 📄 pedido de doc).
  - Bloco explícito **"O que NUNCA fazer"**: não tratar como amigo, não pedir "me conta mais" genérico, não repetir pergunta já respondida (usar memória), não prometer obra/instalação, não inventar valor.

### B. Fallback de resposta vazia
Arquivo: `supabase/functions/_shared/fluxo-b-ai.ts` linha 171-173

- Trocar `"Pode me contar um pouquinho mais?"` por um fallback que reavança o funil de forma profissional, escolhido em função do estado conhecido do lead:
  - Sem nome → "Para começarmos seu cadastro, qual seu nome completo?"
  - Sem valor → "Pra calcular sua economia, qual o valor médio da sua conta de luz?"
  - Caso geral → "Vamos continuar seu cadastro: me confirma [próxima informação]?"
- Se `shouldHandoff`, manter mensagem de transferência atual.

### C. Memória permanente no Fluxo B
Arquivo: `supabase/functions/_shared/fluxo-b-ai.ts`

1. **Aumentar janela bruta** de 16 → 40 turnos (linha 67) — sem custo relevante e cobre conversas longas.
2. **Disparar `maybeUpdateSummary` em background** após cada resposta do Fluxo B (mesmo padrão do `conversational/index.ts:1584-1601`):
   - Contar inbounds do cliente, chamar `maybeUpdateSummary` com `inboundTurnCount` (resumo roda a cada 6 turnos, como no fluxo A).
   - `previousSummary` = `customer.conversation_summary` atual → o resumo é **incremental** (nunca "esquece" o que já sabia).
   - Fire-and-forget, não bloqueia resposta.
3. **Reler customer antes de montar contexto** quando `input.customer` foi passado pelo webhook: garantir que `conversation_summary` mais recente entra no prompt mesmo quando o webhook passou o customer cacheado.
4. **Injetar dados estruturados já conhecidos** no system prompt ("Estado atual" já existe — ampliar com cidade/estado, distribuidora, sales_phase quando presentes) para que mesmo sem summary o bot reconheça o lead.

### D. Garantir que reset continue manual
- Não tocar em nenhum trigger / migration que zere `conversation_summary`.
- Documentar no topo de `fluxo-b-ai.ts` que a memória só é apagada pelos resets administrativos existentes (botão admin / migrations de manutenção).

## Validação
1. `tsc` / build (automático).
2. Chamar `POST /functions/v1/fluxo-b-ai` com `dryRun: true` simulando 3 mensagens sequenciais → verificar que:
   - Resposta não contém "pouquinho", "tudo bem aí", "me conta mais".
   - Tom é profissional e direciona para o próximo passo.
3. Logs do edge `fluxo-b-ai` mostrando `maybeUpdateSummary` rodando a cada 6 inbounds.
4. Conferir num lead real (após deploy) que `customers.conversation_summary` é preenchido depois de ~6 mensagens.

## Arquivos alterados
- `supabase/functions/_shared/fluxo-b-prompt.ts` (persona + fallback guidelines)
- `supabase/functions/_shared/fluxo-b-ai.ts` (janela 40, summary background, fallback inteligente, reload customer)

Nenhuma migration de banco. Nenhuma mudança de UI.
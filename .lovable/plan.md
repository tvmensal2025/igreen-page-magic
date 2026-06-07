## Problema (raiz)

No `orchestrator.ts` (linha 163), todas as etapas determinísticas (`nome`, `valor`, `foto_conta`, `doc`, `email`) usam **somente** `fallbackPorEtapa(...)` — o conteúdo da mensagem do lead é descartado. Resultado observado nas 10 conversas:

| Conv | Etapa | Lead perguntou | Bot respondeu |
|---|---|---|---|
| 04 | nome | "tem fidelidade?" / "tem fidelidade mesmo?" | "qual o seu nome?" (3x) |
| 05 | foto_conta | "ah na verdade não quero" / "tchau" | "me manda a foto da conta" (2x) |
| 06 | nome | "vai vir boleto?" / "vão chegar dois boletos?" | "qual o seu nome?" (2x) |
| 07 | nome | "tem fidelidade?" / "posso cancelar?" | "qual o seu nome?" (2x) |
| 08 | nome | "moro de aluguel, dá?" / "e se eu mudar de casa?" | "qual o seu nome?" (2x) |
| 09 | nome/email | "quando começa a vir o desconto?" | template fixo |
| 10 | nome | "posso já mandar a foto?" | "qual o seu nome?" |

E na etapa rica `simulacao` (conv-03) o LLM responde com a mesma frase de economia para perguntas diferentes ("quanto economizo?" vs "demora quanto pra começar?") — anti-repetição não cobre tema novo.

## Solução

Introduzir uma camada de **"responder dúvida + reancorar pergunta da etapa"** que roda **antes** do fallback determinístico em toda etapa mecânica, e expandir o banco de respostas pra cobrir as objeções/dúvidas reais que aparecem nas conversas.

### 1. Novo detector: `leadFezPergunta(inbound, etapaEsperava)`
Em `extractors.ts`. Determinístico, sem LLM:
- Tem `?` OU começa com interrogativo (`como`, `quanto`, `quando`, `qual`, `tem`, `vai`, `vão`, `posso`, `e se`, `dá pra`, `precisa`)
- E **não** é uma resposta válida à etapa (ex: na etapa `nome` não é um nome reconhecível; na etapa `valor` não é um número; etc.)
- Retorna `{ pergunta: true, tipo: "fidelidade"|"boleto"|"prazo"|"mudanca"|"aluguel"|"cancelamento"|"como_funciona"|"foto_antes"|"desistencia"|"outro" }`

### 2. Novo template: `respostaPerguntaCurta(tipo, nome, etapa, valor?)`
Em `templates.ts`. Devolve **1 frase respondendo a dúvida + 1 frase reancorando a pergunta da etapa**:

- `fidelidade` → "Sem fidelidade, *Ana* — cancela quando quiser, sem multa. {ask_etapa}"
- `boleto` → "Vem *só 1 boleto*, da iGreen, já com o desconto aplicado. {ask_etapa}"
- `prazo` → "Em média *30 a 60 dias* após o cadastro o desconto começa. {ask_etapa}"
- `mudanca` / `aluguel` → "Funciona em casa alugada e você pode levar pra próxima — é digital. {ask_etapa}"
- `cancelamento` → "Pode cancelar quando quiser, é só avisar — sem taxa. {ask_etapa}"
- `como_funciona` → "É uma conexão digital com uma usina solar — você paga menos pela mesma luz, sem obra. {ask_etapa}"
- `foto_antes` → "Pode mandar sim! Mas antes me confirma {ask_etapa}"
- `desistencia` → encerra com handoff suave (não reancora) — vira sinal pra `shouldHandoff = true`
- `outro` → cai no LLM micro-writer com prompt enxuto ("responda a dúvida em 1 frase e reancore")

`{ask_etapa}` reusa as variantes já existentes de `fallbackPorEtapa`.

### 3. Mudança no `orchestrator.ts`
Substituir o bloco da linha 163:

```ts
if (ETAPAS_DETERMINISTICAS.has(state.etapa)) {
  const q = leadFezPergunta(inboundText, state.etapa, customer);
  if (q.pergunta) {
    if (q.tipo === "desistencia") {
      shouldHandoff = true;
      reply = sanitize(respostaDespedida(customer.name));
    } else if (q.tipo === "outro") {
      // micro-writer enxuto: responde dúvida + reancora
      const r = await microWriteDuvida({ etapa, inbound, nome, valor, ... });
      reply = sanitize(r.text);
      modelUsed = r.modelUsed;
    } else {
      reply = sanitize(respostaPerguntaCurta(q.tipo, customer.name, state.etapa, customer.electricity_bill_value));
      modelUsed = `deterministic_duvida:${q.tipo}`;
    }
    state.objecoes_tratadas = [...(state.objecoes_tratadas||[]), q.tipo].slice(-12);
  } else {
    reply = sanitize(fallbackPorEtapa(state.etapa, customer.name, customer.electricity_bill_value, state.tentativas_etapa));
    modelUsed = "deterministic_template";
  }
}
```

E ajustar o `tentativas_etapa`: se respondeu dúvida, **não conta como tentativa falha** da etapa (não bate `tetoTentativas` por engano).

### 4. Corrigir a etapa `simulacao` (conv-03)
Em `templates.ts`, expandir `classificarObjecao` e `respostaConsideracao` com os mesmos 9 tipos acima (hoje só cobre `economia/calculo` e `generica`). Assim o anti-repetição no orchestrator (linha 193-200) consegue trocar de tema em vez de repetir a frase de economia.

### 5. Tratar "desistência" em qualquer etapa
Detector adicional: se `q.tipo === "desistencia"` (`"não quero"`, `"desisti"`, `"tchau"`, `"deixa pra lá"`), o bot manda **1 frase de despedida educada + libera o handoff** em vez de continuar pedindo foto. Vale para `foto_conta`, `doc`, `email` também (conv-05).

### 6. Re-rodar a skill e validar
Rodar `bun /tmp/run.ts --only scripted` e conferir no novo REPORT.md:
- 0 turnos com `LOOP (mesma resposta 2x)` causados por pergunta ignorada
- conv-04, 06, 07, 08, 10 → bot responde a objeção antes de pedir nome
- conv-05 → bot encerra educadamente quando lead diz "tchau"
- conv-03 → bot responde "demora quanto?" com frase diferente da de economia
- 10/10 ainda chegam em `cadastro_finalizando` no happy path

## Arquivos a alterar

- `supabase/functions/_shared/vendedora/extractors.ts` — adicionar `leadFezPergunta`
- `supabase/functions/_shared/vendedora/templates.ts` — adicionar `respostaPerguntaCurta`, `respostaDespedida`, expandir `classificarObjecao`/`respostaConsideracao`
- `supabase/functions/_shared/vendedora/orchestrator.ts` — novo bloco de decisão em ETAPAS_DETERMINISTICAS + tratamento de desistência

## Fora do escopo

- Trocar provedor de LLM ou plataforma SaaS (assunto da pergunta anterior, fica pra outro momento).
- Mudar a state machine — ela está correta, o problema é só "responder a pergunta antes de avançar".
- Persistir nada no banco — segue tudo em `dryRun` na skill de teste.

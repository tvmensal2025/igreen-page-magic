## Objetivo

Validar a correção do bloco de "responder dúvida + reancorar" com 10 conversas **mais difíceis** — leads que prolongam, voltam ao mesmo tema com nuance diferente, misturam objeções, pedem prova social, e só fecham depois de 3-5 dúvidas reais. Cada conversa precisa terminar em `cadastro_finalizando` ou em `aguardando_humano` com handoff coerente (não em loop).

## O que vai mudar

**Apenas o arquivo da skill de teste** (`.agents/skills/vendedora-e2e-conversations/scripts/run.ts`). Nada de código de produção, nada de banco, nada de portal — segue `dryRun`, segue sem enviar pro iGreen.

### Nova bateria: `SCRIPTED_DIFICEIS`

10 cenários novos, cada um com 12-18 turnos. Estrutura: o lead **sempre** acaba mandando os dados (nome, valor, foto, doc, email) — o que muda é a quantidade de objeções/dúvidas antes de cada passo. Assim eu consigo medir se a IA:

1. Responde a dúvida específica (não repete a anterior)
2. Reancora a pergunta da etapa depois de responder
3. Não conta dúvida como tentativa falha (não cai em handoff cedo demais)
4. Não trava em loop quando o lead repete a dúvida com palavras diferentes
5. Sabe encerrar educado quando o lead desiste de verdade

Os 10 cenários cobrem ângulos diferentes:

| # | id | Dificuldade principal |
|---|---|---|
| 1 | `dificil-bombardeio-inicio` | 5 perguntas seguidas antes de dar o nome (fidelidade, boleto, prazo, mudança, segurança) |
| 2 | `dificil-volta-mesmo-tema` | Pergunta fidelidade em 3 momentos diferentes (antes do nome, depois do valor, depois da foto) — testa variação anti-repetição |
| 3 | `dificil-objecao-no-meio` | Dá nome+valor, mas no `simulacao` joga "tá caro pra que isso", "minha vizinha disse que não funciona", "e se a empresa quebrar?" |
| 4 | `dificil-tecnico-engenheiro` | "Como funciona compensação de créditos?", "quem é a geradora?", "tem ANEEL homologando?", "qual o CNPJ?" — força respostas com fato |
| 5 | `dificil-reclamacao-enel` | Começa xingando a Enel, depois pergunta se isso é a Enel mesmo, depois pede prova de que não é golpe — 4 dúvidas de credibilidade |
| 6 | `dificil-conta-baixa-insiste` | Conta R$ 140, pergunta se vale a pena 3x, depois aceita e segue até o fim |
| 7 | `dificil-aluguel-medo` | Mora alugado, pergunta sobre mudança 2x, multa, contrato em nome de terceiro, e só depois manda doc |
| 8 | `dificil-quase-desiste-volta` | Diz "ah não sei", "deixa eu pensar", "talvez outra hora" — bot precisa reengajar sem ser chato; no fim fecha |
| 9 | `dificil-desiste-de-verdade` | Depois de 4 dúvidas diz "olha, melhor não, valeu" — bot precisa encerrar educado + handoff (NÃO seguir pedindo foto) |
| 10 | `dificil-pede-falar-humano` | No meio do fluxo: "quero falar com alguém de verdade" — bot precisa escalar, não insistir no script |

### Como vai rodar

```bash
bun /tmp/run.ts --only scripted --out /mnt/documents/vendedora-runs/duvidas-dificeis-v1
```

A flag `--only scripted` já existe. Vou **adicionar a flag `--scenario-set <basico|dificil|todos>`** (default `basico` pra não quebrar runs anteriores). Quando `dificil`, ele roda só os 10 novos; `todos` roda os 20.

### Validação automática no REPORT.md

O REPORT atual já marca `LOOP (mesma resposta 2x)`, `LLM_FALLBACK`, etapa final. Vou somar 3 checks novos por conversa:

1. **`DUVIDA_IGNORADA`** — turno em que o lead fez pergunta (heurística: tem `?` ou interrogativo) e a resposta do bot é idêntica à etapa anterior (= não respondeu, só reancorou)
2. **`REPETIU_TEMA`** — 2 respostas seguidas com o mesmo `modelUsed: deterministic_duvida:<tipo>` e texto >70% similar
3. **`HANDOFF_INCOERENTE`** — handoff disparado sem o lead ter pedido humano nem desistido

Cada conversa vira `conv-NN-<id>.md` no diretório de saída, igual hoje.

### Critério de sucesso

- **≥ 8/10** chegam em `cadastro_finalizando` (cenários 9 e 10 são handoff de propósito, não contam como falha)
- **0** ocorrências de `DUVIDA_IGNORADA` nas etapas determinísticas
- **0** loops de mesma resposta exata 2× consecutivas
- Cenário 9 termina com `respostaDespedida` + `shouldHandoff=true`
- Cenário 10 escala pra humano dentro de 1 turno após o pedido

Se algum critério falhar, eu analiso a conversa específica antes de mexer em código de novo — pode ser ajuste de template, pode ser tipo de dúvida novo a adicionar em `leadFezPergunta`.

## Fora do escopo

- Trocar provedor de LLM
- Mexer no orchestrator/templates de produção (só ajusto se a bateria difícil expor bug novo — aí volto a pedir aprovação)
- Persistir nada no banco / enviar nada pro portal iGreen

## Arquivos a alterar

- `.agents/skills/vendedora-e2e-conversations/scripts/run.ts` — adicionar `SCRIPTED_DIFICEIS[]`, flag `--scenario-set`, e os 3 checks novos no gerador do REPORT

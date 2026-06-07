# Auditoria — 10 conversas difíceis (`duvidas-dificeis-v1`)  
  
A IA TEM QUE USAR AS RESPOTAS DO FAQ TEMOS BASE DE CONHECIMENTO E DEVE SER USADA ( REGRA )

O REPORT só marcou 1 problema, mas lendo turno a turno achei **8 bugs reais**. A maioria é "dúvida cai no balde `generica` e bot responde fora de contexto". Tem 2 críticos (pede-humano e desistência) e 1 derrubando uma conversa inteira (extrator de nome).

## Bugs encontrados (por severidade)

### 🔴 Crítico

**1. `pede-falar-humano` não escala (conv-06, turnos 5 e 6)**
Lead: *"antes de seguir quero falar com alguém de verdade"* → bot: *"Eu sou uma consultora real..."*. Lead insiste: *"tipo, um humano mesmo, não bot"* → bot ignora de novo e segue oferecendo desconto.
**Esperado:** detectar pedido de humano (regex: `humano|pessoa de verdade|alguém de verdade|gente de verdade|atendente|não bot|nao bot|falar com alguem`) → `respostaPedidoHumano()` + `shouldHandoff=true` no 1º turno.

**2. `desiste-de-verdade` não detecta despedida (conv-04, turno 5)**
Lead: *"sabe, olha, melhor não, valeu"* → bot: *"Antes da gente seguir, como posso te chamar?"*. O `leadFezPergunta` não casa porque não tem `?`, e o detector de `desistencia` não pega "melhor não".
**Esperado:** ampliar gatilhos de desistência (`melhor não|não quero mais|deixa pra lá|valeu, mas não|não vai dar|desisto|outra hora|fica pra depois`) → despedida + handoff.

**3. Extractor de nome falha em "ok confio, Nome" (conv-08, turno 6)**
Lead: *"ok confio, Cláudia Reis"* → bot não extrai e re-pergunta. Isso degenerou em loop de 4 turnos (`710`, `quero`, foto) todos ignorados, terminando em handoff incoerente.
**Causa:** o regex de prefixo em `extractors.ts/extrairNome` só aceita `ok|tá|blz|sim|certo|claro|então|aham|aqui|opa|oi` — "confio" não casa, e o segundo termo bloqueia a passagem.
**Fix:** aceitar prefixos compostos (`ok confio`, `tô dentro`, `pode anotar`, `fechado então`) e tratar qualquer texto antes de vírgula+nome próprio como confirmação.

### 🟡 Médio (ignora pergunta real, responde genérico)

**4. Dúvida "vale a pena com conta baixa?" cai em `generica` (conv-03, turnos 3, 4, 5)**
*"minha conta é só 140, vale a pena?"* / *"20% de 140 dá quase nada né"* → bot responde *"sem obra, sem fidelidade, ANEEL"* ou só reancora. Nunca valida que mesmo R$ 28/mês = R$ 336/ano sem custo.
**Fix:** novo tipo `conta_baixa` em `leadFezPergunta` (gatilhos: `vale a pena|conta baixa|conta pequena|pouca coisa|dá quase nada|compensa`) + resposta que reconhece o valor e mostra economia anual.

**5. Dúvida "contrato no nome de quem?" cai em `generica` (conv-01, turno 5)**
*"o contrato fica no nome de quem, meu ou do dono?"* → resposta sobre ANEEL. Totalmente fora do tema.
**Fix:** novo tipo `titularidade` (gatilhos: `nome de quem|titularidade|titular|no meu nome|do dono|do propriet|inquilino`).

**6. Dúvidas técnicas (CNPJ, homologação) caem em `generica` (conv-09, turnos 4 e 5)**
*"tem homologação na ANEEL?"* / *"qual o CNPJ da iGreen?"* → responde *"sem obra, sem fidelidade, ANEEL"*. Não dá CNPJ, não confirma homologação por nome.
**Fix:** novos tipos `cnpj` e `homologacao_aneel` com resposta factual (CNPJ + número da homologação ANEEL).

**7. "Me explica de novo" é ignorado (conv-07, turno 5)**
Lead: *"tá, me explica de novo rapidinho"* → bot: *"Antes da gente seguir, como posso te chamar?"*. Não detecta pedido de recapitulação.
**Fix:** novo tipo `pedido_recap` (gatilhos: `me explica de novo|recapitula|repete|de novo rapid|resume|como funciona mesmo`) — devolve pitch curto de 1-2 linhas + reancora.

### 🟢 Cosmético

**8. Saudação usa username do consultor como nome (todas)**
*"Sou a tvmensal22 da iGreen Energy"* — o `tvmensal22` é o handle/login, não nome. Fica ruim.
**Fix:** se `consultant.name` parece username (regex `^[a-z0-9_]+$` ou sem espaço e com dígito), omitir o "Sou a X" e usar só *"Olá! Aqui é da iGreen Energy..."*.

## O que vou mudar (arquivos)

1. `**supabase/functions/_shared/vendedora/templates.ts**`
  - `leadFezPergunta()`: adicionar 5 tipos novos (`conta_baixa`, `titularidade`, `cnpj`, `homologacao_aneel`, `pedido_recap`) e ampliar `pedido_humano` + `desistencia`.
  - `respostaPerguntaCurta()`: novos cases com texto específico (não genérico).
  - Detector de username em `respostaAbertura()` para suprimir nome do consultor quando for handle.
2. `**supabase/functions/_shared/vendedora/extractors.ts**`
  - `extrairNome()`: ampliar regex de prefixo aceitando `ok confio`, `pode anotar`, `tô dentro`, `fechado então`, `me chamo`, `aqui é o/a`. Aceitar qualquer texto curto (≤3 palavras minúsculas) antes de vírgula+nome próprio.
3. `**supabase/functions/_shared/vendedora/orchestrator.ts**`
  - Quando `leadFezPergunta` retorna `pedido_humano` ou `desistencia`, setar `shouldHandoff=true` + resposta apropriada **independente da etapa atual** (hoje só faz handoff em `desistencia` — `pedido_humano` não existe ainda).

## Validação

Re-rodar a bateria difícil:

```bash
bun /tmp/run.ts --scenario-set dificil --out /mnt/documents/vendedora-runs/duvidas-dificeis-v2
```

**Critério de aceite:**

- conv-04 (desiste): handoff no turno 5, sem pedir foto
- conv-06 (humano): handoff no turno 5, sem insistir
- conv-08 (reclamacao-enel): extrai "Cláudia Reis" no turno 6 e segue para `valor` (sem loop nem handoff incoerente)
- conv-01 turno 5, conv-03 turnos 3-5, conv-07 turno 5, conv-09 turnos 4-5: bot responde no tema da pergunta (não cai em "sem obra, sem fidelidade, ANEEL")
- Saudação: não aparece "tvmensal22" (ou handle similar)
- ≥9/10 chegam em `cadastro_finalizando` (exceto conv-04 e conv-06 que devem terminar em handoff coerente)

## Fora do escopo

- Trocar modelo LLM
- Mexer no extractor de valor/email
- Persistir nada / mandar pro iGreen
- Refatorar state-machine

## Arquivos a alterar

- `supabase/functions/_shared/vendedora/templates.ts`
- `supabase/functions/_shared/vendedora/extractors.ts`
- `supabase/functions/_shared/vendedora/orchestrator.ts`

> ⚠️ A pasta `.lovable/` está no `.gitignore` deste projeto — esse plano não persiste em commit. Quer que eu remova a entrada do `.gitignore` pra os planos ficarem versionados?
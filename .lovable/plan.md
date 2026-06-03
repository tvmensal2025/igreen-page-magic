# Auditoria completa do Fluxo D

**Regra inviolável:** cada passo é uma entidade isolada com ID próprio. Cópias são passos novos. A auditoria nunca sugere "sincronizar" passos entre si — só aponta defeitos *internos* a um passo ou *link quebrado* a partir dele.

## O que será feito

### 1. Auditoria estática (por passo, isolada)

Script Deno lê os 16 passos do flow `320bf22c-…` e valida cada um sozinho:

- `fallback.mode = ai_answer` exige `captures._buttons` com ≥1 opção (bug já corrigido — re-checar)
- `transitions[].goto_step_id` aponta para passo existente **e ativo** (senão = link quebrado **deste** passo)
- IDs de botões únicos dentro do passo
- `trigger_phrases` não-vazias quando a transição não tem `goto_special`
- `captures` com `field` e `kind` válidos para o `step_type`
- Typos óbvios em títulos de botão (espaço faltando após emoji, etc.)
- `position` único no fluxo
- Passo ativo cujo `goto_step_id` aponta para passo inativo

### 2. Reachability (passo isolado, só reporta)

A partir de `d_welcome`, calcular conjunto alcançável. Passos ativos fora desse conjunto são reportados como "inalcançáveis" e a migration opcional desativa **apenas eles** (`is_active=false`), sem tocar em mais nada.

Candidatos atuais: `d_como_funciona_copy_in3s` (pos 19) e `d_handoff` (pos 9).

### 3. Simulação de runtime (engine v3 local, determinístico)

Importa `_shared/engine` direto, sem Whapi/Evolution/Gemini reais. Para cada jornada, valida turno-a-turno o outbound esperado:

- **Happy path foto:** welcome → "simular" → escolher_simulacao(foto) → upload conta → resultado → cadastrar → documento → email → telefone → finalizar
- **Happy path valor:** welcome → "simular" → escolher_simulacao(valor) → "300" → resultado → cadastrar → …
- **Dúvida + IA (bug original):** welcome → simular → resultado → "tem fidelidade?" → confirma que sai `ai_answer` **+** os 3 botões (cadastrar/nova_pergunta/humano) re-emitidos
- **Loop de dúvida:** 3x perguntas seguidas → confirma escalation/repeat correto
- **Handoff:** "humano" digitado em welcome, simular, resultado, dúvidas
- **Atalho:** "cadastrar" direto em welcome
- **Inputs hostis:** texto em capture_conta, imagem em capture_email, "1"/"2"/"3" como números (Evolution numbered fallback)
- **Cobertura de canal:** cada jornada roda 2x — capabilities Whapi (botões reais) e Evolution (lista numerada)

### 4. Entregáveis

- `.kiro/specs/fluxo-d-auditoria/report.md` — relatório completo agrupado por passo: defeitos internos, links quebrados, alcançabilidade, resultado de cada jornada simulada (PASS/FAIL com diff do outbound esperado vs. obtido)
- Migration opcional separada que só desativa os passos inalcançáveis (apresentada via supabase--migration para aprovação)

### Sem efeitos colaterais

- Zero escrita em `bot_flow_steps` durante a auditoria
- Zero chamada a Whapi/Evolution/Gemini reais
- Banco só é tocado se você aprovar a migration de desativação no fim

## Detalhes técnicos

- Scripts em `.kiro/specs/fluxo-d-auditoria/` (audit-static.ts, audit-runtime.ts)
- Runtime usa `supabase/functions/_shared/engine/runStep.ts` + `variants/d.ts` + capabilities mockadas (`{supportsButtons:true,maxButtons:3,supportsList:false}` para Whapi; `{supportsButtons:false,maxButtons:0,supportsList:false}` para Evolution)
- Cada jornada é um array `[{input, expectedOutbound[]}]`; o runner compara `kind`, `text` (regex tolerante), `choice.preferred`, `choice.options.length`
- Falha de jornada = diff exato para reproduzir  
  
JA APLICAR PARA OS PASSOS NAO SER DUPLICADO ERRADO, E SIM COO UNICO SEMPRE, INDEPENDENTE DA ALTERACO DE 1 NUNCA ALTERA O OUTRO
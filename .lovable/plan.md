# Plano — Abertura inteligente + não repetir perguntas

## Objetivo
1. Dar à IA uma **abertura padrão** clara, no nome do consultor (ex: Rafael Ferreira), que apresenta valor antes de pedir o nome.
2. Garantir que a IA **nunca repita** uma pergunta cujo dado o lead já forneceu (nome, valor, cidade, etc).

## Mudanças

### 1. Abertura inteligente (1ª mensagem)
Em `supabase/functions/_shared/vendedora-v1/playbook.ts` (etapa `interesse`) e no `DEFAULT_PERSONA` do `writer.ts`, definir o template oficial de abertura:

```
Olá! 😊 Aqui é a *{{representante}}* da iGreen Energy.
Funciona assim: você passa a pagar *menos* todo mês na conta de luz, sem obra e sem trocar de distribuidora ⚡
Posso te chamar como?
```

Regras:
- Só usar essa abertura quando `etapa === interesse` **e** não houver nome registrado.
- Se o lead já mandou o nome no primeiro turno ("oi, sou o Fernando"), pular direto pra etapa `valor` e **não** pedir o nome de novo.

### 2. Reconhecer info já capturada (anti-repetição)
Adicionar bloco obrigatório no `system` do `writer.ts` (logo após `# Plano`):

```
# Fatos já conhecidos (NÃO PERGUNTE DE NOVO)
- nome: {{nome_lead || "desconhecido"}}
- valor_conta: {{valor || "desconhecido"}}
- cidade/distribuidora/email: ...
REGRA DURA: se o campo está preenchido, NÃO pergunte. Use-o naturalmente.
Se a próxima jogada do planner pede um campo que já está preenchido, IGNORE essa parte da jogada e avance pra próxima informação faltante.
```

### 3. Planner respeita fatos
Em `planner.ts` SYSTEM, adicionar regra 8:
> Antes de colocar um campo em `info_a_capturar`, verifique `fatos_confirmados` e `state.info`. Nunca peça algo que já está lá. Se nome+valor já existem, vá direto pra `simulacao`.

E injetar `state.info` + `knownFacts` de forma mais saliente no `userMsg` do planner (já vai, mas reforçar a instrução de leitura).

### 4. Detectar nome no primeiro turno
No webhook que monta o turno inicial (ou via tool `registrar_nome` chamada automaticamente quando o lead já se apresenta), garantir que se a 1ª mensagem do lead contém "meu nome é X" / "sou o X" / "aqui é X", o nome é salvo **antes** do writer rodar — assim a abertura já pula a pergunta.

Implementação leve: deixar isso por conta do writer (que já tem a tool `registrar_nome`) + reforço no prompt: "Se o lead já se apresentou na mesma mensagem, registre o nome e avance".

## Arquivos a editar
- `supabase/functions/_shared/vendedora-v1/writer.ts` — DEFAULT_PERSONA com abertura + bloco "fatos conhecidos".
- `supabase/functions/_shared/vendedora-v1/playbook.ts` — `interesse` step com a abertura nova.
- `supabase/functions/_shared/vendedora-v1/planner.ts` — regra 8 anti-repetição.
- `supabase/functions/_shared/fluxo-b-prompt.ts` — alinhar `DEFAULT_PROMPT` com a abertura.

## Fora de escopo
- Não mexer no critic/bloqueio de mensagens rejeitadas (item separado da análise anterior).
- Não mexer em `pedir_foto_conta` (já corrigido).

Confirma que posso aplicar?

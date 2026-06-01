# Corrigir botão "Quero simular" da etapa de dúvidas

Análise completa concluída — todos os caminhos do fluxo levam ao final (cadastro completo em `d_finalizar` ou handoff humano em `d_handoff`). Apenas **um botão está incoerente** e precisa de ajuste.

## Problema

Na etapa `d_duvidas`, o botão **"Quero simular"** leva para `d_pedir_conta` (foto da conta), exatamente o mesmo destino do botão "Quero cadastrar". Quem clica em "Quero simular" espera escolher entre simulação rápida e completa, não ir direto pra envio de foto.

## Correção

Atualizar a transição do `d_duvidas` (id `38c0d101-6492-4b1e-8229-c676c804161a`):

- Frases gatilho `Quero simular`, `simular` → passam a apontar para `d_escolher_simulacao` (id `b1a53333-3333-4333-8333-000000000003`), em vez de `d_pedir_conta`.

Demais transições permanecem inalteradas:
- `Quero cadastrar`, `cadastrar` → `d_pedir_conta` (mantém)
- `Falar com Rafael`, `humano`, `atendente` → especial `humano` (mantém)
- IA livre para perguntas em texto livre (mantém)

## Ponto 2 confirmado pelo usuário

Mantém o fluxo atual em `d_simular_resultado` → "Continuar Cadastro" → `d_pedir_conta`. Nenhuma mudança aqui.

## Resumo dos demais botões (todos OK)

```
d_welcome              → 3 botões coerentes
d_escolher_simulacao   → 2 botões coerentes
d_resultado            → 3 botões coerentes
d_simular_resultado    → 3 botões coerentes
d_como_funciona        → 3 botões coerentes
d_duvidas              → 1 botão a corrigir (acima)
```

## Detalhes técnicos

- Uma única atualização em `bot_flow_steps` no campo `transitions` do registro com `step_key = 'd_duvidas'`.
- Sem mudança de schema, código frontend ou edge function.

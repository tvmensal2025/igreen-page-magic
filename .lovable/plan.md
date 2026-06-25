# Análise — Fluxo D / Cadastro Rápido

## Verificação no banco (estado atual)

Existem **7 fluxos D ativos** (`bot_flows.variant='D' AND is_active=true`). Em **todos os 7**, o passo `d_welcome` tem o botão `⚡ Cadastro rápido` com `id=cadastro_rapido` e a transição correspondente aponta para um passo cujo `step_key = d_pedir_documento`. Nenhum aponta para simulação nem para `goto_special=humano`.

Frases-gatilho confirmadas em cada transição:
`cadastro_rapido, cadastro rápido, cadastro rapido, ⚡ cadastro rápido, cadastrar, cadastrar e finalizar, quero me cadastrar`.

A palavra "humano/atendente/consultor" continua em transição separada com `goto_special=humano` (handoff intencional).

## Verificação no código (whapi-webhook + evolution-webhook)

Em `supabase/functions/whapi-webhook/handlers/bot-flow.ts` (linhas 3157–3219) e no equivalente em `evolution-webhook`:

1. `_flowDQuickCadastroIntent` detecta intenção quando `customer.flow_variant === 'D'` E o texto/botão casa com `/cadastro[_\s-]*rapido|cadastrar\s*e\s*finalizar|quero\s*me\s*cadastrar|\bcadastrar\b/` (ou "humano" estando em `d_welcome`).
2. Logo após resolver `nextCustom` pelas transições, se a intenção foi detectada, **força** `nextCustom = d_pedir_documento` carregado por `step_key`.
3. Se a resolução caísse em `__special: humano` e a intenção for cadastro, também força `d_pedir_documento`; fallback adicional retorna a mensagem "Show! Pra finalizar seu cadastro, me manda só uma foto da frente do seu documento 📄" caso o passo não exista.

## Conclusão

Com banco + guard duplo no webhook, o Cadastro Rápido vai para documento em 100% dos caminhos previstos, mesmo se alguém editar o FlowBuilder errado depois (o guard sobrescreve a resolução).

### Pontos de atenção (não bloqueantes)

- **Lead novo sem `flow_variant` setado ainda**: o guard só dispara se `flow_variant === 'D'`. Hoje, quando o lead entra no fluxo D, o `flow_variant` é gravado antes do `d_welcome` resolver, então OK. Se um dia mudar essa ordem, o guard ficaria inerte — a rota do banco continua correta, então não causaria bug, apenas perderíamos a rede de segurança.
- **Outros 6 fluxos D ativos**: o sistema tem 7 fluxos D simultaneamente ativos. Não é um problema de roteamento (todos foram validados), mas vale revisar se isso é intencional — normalmente só um fluxo por variant deveria estar ativo.

## Recomendação

Nenhuma alteração de código necessária. Está sólido. Se quiser, posso:

- **Opção A**: Consolidar para apenas 1 fluxo D ativo (mais limpo, evita inconsistências futuras).
- **Opção B**: Remover o filtro `flow_variant === 'D'` do guard, fazendo-o disparar pela palavra "cadastrar" em qualquer contexto onde o customer esteja em `d_welcome`/`d_resultado` (rede de segurança ainda mais ampla).
- **Opção C**: Deixar como está e apenas monitorar.

Me diga qual prefere (ou nenhuma). OPCAO A

&nbsp;
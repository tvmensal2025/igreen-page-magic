## Diagnóstico
Consultor logado (0c2711ad) tem **44 contatos com conversa** em `conversations`. O fetch atual do Conversão exclui pelo SQL:

```
.is("igreen_code", null)
.is("data_ativo", null)
.is("data_validado", null)
.is("data_cadastro", null)
```

Mas dos 44 que conversaram, **6 já têm `igreen_code`** (Gislaine, Lucineia, Ana Claudia, Évelin, Luiz Lyra, +1) — são leads que assinaram mas continuam em negociação/validação. Eles somem do Conversão por causa desse filtro. Só 2 têm status realmente ativo (`andamento_igreen` in `ativo/aprovado/validado/licenciada/licenciado`).

Ou seja: "ter código iGreen" ≠ "cliente ativo". Cliente ativo mesmo é quem tem `andamento_igreen` num status final OU `assinatura_cliente` truthy OU `data_ativo/data_validado` preenchidos (esses últimos são zero na base atual, mas devem seguir cortando).

## Mudança
### `src/components/admin/conversao/ConversaoCockpit.tsx` — fetch (linhas 139-147)
Retirar do `.select`:
- `.is("igreen_code", null)` — mantém quem já assinou mas ainda está sendo trabalhado.
- `.is("data_cadastro", null)` — só cadastro no portal também não é sinal de cliente ativo.

Manter:
- `.is("data_ativo", null)` e `.is("data_validado", null)` — esses sim indicam ativação/validação real.
- `.eq("consultant_id", consultantId)` e ordenação por `last_bot_interaction_at`.

Filtro JS já bloqueia `andamento_igreen ∈ (ativo,aprovado,validado,licenciada,licenciado)` e `assinatura_cliente` truthy — isso continua garantindo que cliente ativo não apareça.

Resultado esperado: ~42 leads (44 que conversaram − 2 com status ativo) aparecem para o consultor 0c2711ad, contra os poucos de agora.

## Fora de escopo
- Sem mudar Captação, schema ou RLS.
- Sem alterar UI, filtros de tela, drawer, ou pipeline de IA.

## Verificação
Após aplicar: fila Conversão do consultor 0c2711ad passa a mostrar Gislaine, Lucineia, Ana Claudia, Évelin, Luiz Lyra e demais que conversaram e ainda estão em andamento; ninguém com `andamento_igreen` ativo/validado/etc. na lista.

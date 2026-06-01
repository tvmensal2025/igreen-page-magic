## O que aconteceu nos últimos leads

Inspecionei `conversations` + `bot_flow_steps` para os 5 leads reais mais recentes (≈ 1h atrás):

| Lead | O que fez | O que o bot respondeu | Esperado |
|---|---|---|---|
| Heloísa (5511994907045) | clicou **"💡 Simulação rápida"** e mandou **"120,00"** | foi pra `d_como_funciona` (áudio + vídeo + "700 mil pessoas…") | ir pra `d_simular_valor` e devolver prévia da economia |
| Deus e fiel (553491948649) | digitou **"357"** | foi pra `d_como_funciona` | tratar como valor da conta e simular |
| ROBERTO (5519992235652) | clicou **"💚 Quero simular"** | parou em `d_escolher_simulacao` (não avança) | aguardar escolha rápida/completa |
| Keh (5515997009228) | clicou **"💡 Simulação rápida"** | recebeu o prompt de valor, mas a etapa anterior já tinha mandado pro caminho errado em outros leads | — |
| BRUNO (5511971254913) | (sessão antiga, já tratada com fix de tokens Gemini) | — | — |

Padrão claro: **toda vez que o lead escolhe simulação ou manda um número no passo `d_escolher_simulacao`, ele cai no fallback default → `d_como_funciona`** (vídeo institucional). Quem chegou ali tentando simular acaba assistindo "como funciona" e perde o gancho.

## Causa raiz

Passo `d_escolher_simulacao` (`b1a53333-…-0003`) tem:

- transição "simular_rapida": `trigger_phrases: [simular_rapida, rapida, rápida, valor, só o valor, so o valor]`
- transição "simular_completa": `trigger_phrases: [simular_completa, completa, foto, conta]`
- **fallback default** → `d_como_funciona` (`c87d76f8`)

Problemas:

1. **Botão "💡 Simulação rápida"** chega com o emoji + label. O matcher de keyword bate por igualdade/contém no texto normalizado, mas o payload do botão no Evolution às vezes vem como o ID interno (`simular_rapida`) e às vezes como o label (`💡 Simulação rápida`). O label contém "rápida" — deveria casar. Suspeita: a normalização está removendo acento mas a phrase cadastrada `rápida` mantém o acento; comparação fica `rapida` vs `rápida` e falha. Resultado → fallback `d_como_funciona`.
2. **Número puro ("357", "120,00")** não casa com nenhuma phrase, então cai no fallback. Mas neste contexto o número É a resposta de "simulação rápida". Deveria detectar valor numérico e ir direto pra `d_simular_valor` (ou pular o pedido e já calcular a prévia).
3. **Fallback errado**: mandar quem está escolhendo simulação para `d_como_funciona` desorienta — o lead acabou de pedir pra simular, não pra ouvir explicação.

## Plano de correção

### 1. Engine — normalizar acentos no match de transições
`supabase/functions/_shared/flow-engine-v3.ts` (ou onde mora `matchTransition`): aplicar `normalize("NFD").replace(/[\u0300-\u036f]/g,"")` **dos dois lados** (phrase cadastrada e mensagem recebida) antes do compare. Isso resolve o caso `rápida` ↔ `rapida` e qualquer outro acento. Reutilizar `normalizeFaqQuestion` que já existe em `ai-faq-answerer.ts`.

### 2. Engine — detecção de valor numérico em `d_escolher_simulacao`
Adicionar regra: se mensagem casa `/^\s*R?\$?\s*\d{1,4}([.,]\d{1,2})?\s*$/` (ex: `120`, `120,00`, `R$ 300`) e o passo atual é `d_escolher_simulacao`, rotear para `d_simular_valor` (b1a51111…) com o valor já capturado em `electricity_bill_value`, pulando a pergunta "me manda o valor".

Implementar como pré-check no handler do passo (igual ao que já existe pra outras capturas) — não precisa cadastrar phrase numérica.

### 3. Fallback do `d_escolher_simulacao`
Mudar o fallback default de `c87d76f8` (d_como_funciona) para `repeat` (repetir a pergunta com os botões). Quem chegou aqui já passou por `d_welcome` e disse que quer simular — repetir é melhor que jogar pra vídeo institucional.

Via UI ou migration na linha do step:
```sql
UPDATE bot_flow_steps
SET fallback = jsonb_build_object('mode','repeat')
WHERE id = 'b1a53333-3333-4333-8333-000000000003';
```

### 4. Phrases extras de segurança
Adicionar variantes ao trigger "simular_rapida" da `d_escolher_simulacao`: `simulacao rapida`, `simulação rápida`, `rapido`, `quero rapida`. Para "simular_completa": `simulação completa`, `quero completa`, `foto da conta`, `mandar conta`.

### 5. Recuperar os 4 leads travados
Após o fix, rodar uma função/script único que, pra cada um dos 5 customer_ids acima, re-emite a mensagem do passo correto:
- Heloísa & Deus e fiel: setar `conversation_step = 'flow:b1a51111-…-0001'` e disparar simulação com o valor que eles já mandaram.
- ROBERTO & Keh: re-enviar `d_escolher_simulacao` (já estão lá, mas perderam contexto).

Vou usar o endpoint admin de reset/step-jump que já existe em `services/resetConversation.ts`.

## Fora de escopo

- Não mexer no `d_welcome`, `d_como_funciona`, nem na cascata Gemini.
- Não tocar no fix de tokens Gemini do BRUNO (já aplicado em ai-gateway.ts).
- Não alterar UI do editor de fluxo.

## Arquivos afetados

- `supabase/functions/_shared/flow-engine-v3.ts` (normalização + numeric pre-check)
- 1 migration: `UPDATE bot_flow_steps` (fallback + phrases extras)
- 1 chamada manual de recuperação para os 5 leads (script único, sem mudar código de produção)

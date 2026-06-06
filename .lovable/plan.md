## Objetivo

Mudar o comportamento da IA Fluxo B em dois pontos:

1. **Nova ordem do funil**: assim que o lead manda o valor da conta, a IA já entrega a simulação e segue construindo confiança (tira dúvidas, trata objeções). Só pede **foto da conta** e **documento** lá no fim, quando o lead já está claramente comprado.
2. **Faixa verbal de desconto por valor**: na hora de apresentar a simulação, a IA fala uma faixa (ex.: "entre 12% e 20%") proporcional ao valor da conta, mas o **número final em reais** continua calculado com 20% (mantém coerência com LP, FAQ e bot — regra `mem/copy/discount-rate-20.md`).

## Novo funil

```text
1. Gancho (abertura, sem pedir nome)
2. Sinal positivo do lead → pedir nome
3. Pedir valor médio da conta
4. SIMULAÇÃO IMEDIATA: faixa verbal + número em R$ (mensal/anual)
5. Construir confiança: tratar dúvidas/objeções, mostrar ANEEL, responder FAQ
   ↳ Só avança quando o lead demonstra interesse claro
     (ex.: "quero", "como faço", "vamos", "ok manda", "fechado", "topo")
6. Pedir FOTO da conta
7. Pedir DOCUMENTO (RG/CNH)
8. Pedir e-mail
9. finalizar_cadastro
```

A IA **não pode** pedir foto da conta no mesmo turno da simulação (mudança principal). O CTA pós-simulação vira pergunta consultiva, não pedido de arquivo.

## Faixa verbal de desconto

Apenas na frase de simulação. O cálculo numérico continua `valor × 0,20`.


| Valor da conta | Frase verbal sugerida | Cálculo exibido |
| -------------- | --------------------- | --------------- |
| < R$ 200       | "entre *8% e 20%*"    | × 0,20          |
| R$ 200 – 400   | entre *8% e 20%*      | × 0,20          |
| > R$ 400       | "entre *8% e 20%*     | × 0,20          |


Exemplo (conta R$ 350): "Com conta de *R$ 350*, o desconto fica *entre 08% a 20%* conforme a análise da sua fatura PQ DEPENDE DO ICMS MAS  A média, dá em torno de *R$ X/mês* (cerca de *R$ X /ano*) ⚡"  


> Risco assumido (você escolheu "faixa só na simulação verbal"): o lead pode perceber que o número não bate com a faixa máxima. A frase usa "na média" pra abrir essa folga sem mentir. Se aparecer reclamação, a saída é tratar como objeção e oferecer simulação exata pela foto da conta.

## Mudanças por arquivo

### `supabase/functions/_shared/fluxo-b-prompt.ts` (DEFAULT_PROMPT)

- **Funil (seção "# Objetivo")**: reordenar passos 5–7 para `5) Simulação verbal + número → 6) Tratar dúvidas/objeções e confirmar interesse → 7) Foto da conta → 8) Documento → 9) E-mail → 10) finalizar_cadastro`.
- **Seção "# Fechamento por compromisso"**: substituir o atual "pede foto logo após simulação" por um template em 2 turnos:
  - Turno A (logo após o valor): apresenta faixa + número + pergunta consultiva ("Faz sentido pra você?" / "Quer entender como funciona?"). **Proibido pedir foto aqui.**
  - Turno B (só depois que o lead confirma interesse): "Pra travar sua simulação exata e seu cadastro, me manda a *foto da conta de luz* 📷".
- **Nova seção "# Faixa de desconto na simulação verbal"**: tabela acima + regra "o número em reais SEMPRE usa 20%; a faixa é só pra abrir conversa".
- **Regras de negócio**: manter "Economia mensal = valor × 0,20". Adicionar: "NUNCA peça foto/documento antes do lead demonstrar interesse claro pós-simulação (sinais: 'quero', 'como faço', 'vamos', 'fechado', 'topo', 'ok manda')."
- **Aberturas A–D**: mantêm "até 20%" (sem mudança).

### `supabase/functions/_shared/vendedora-v1/playbook.ts`

- Etapa `simulacao`: trocar jogadas que pedem foto ("apresentar_numero_com_cta", "apresentar_numero_e_pedir_foto") por "apresentar_numero_e_qualificar_interesse" — número + pergunta consultiva, nunca foto no mesmo turno.
- Adicionar etapa intermediária implícita no detalhe: foto só vai pra `foto_conta` depois que o Planner detectar sinal de interesse.
- Limpar resíduo de prova social inventada: trocar `"ANEEL + 80mil clientes, sem obra…"` (linha 16) por `"ANEEL, mesma distribuidora, sem obra. Pergunta de interesse no fim."`.

### `supabase/functions/_shared/vendedora-v1/writer.ts` (DEFAULT_PERSONA)

- Atualizar a linha do funil para refletir nova ordem: `interesse → nome → valor → simulação → confirmação de interesse → foto da conta → documento → e-mail → finalizar`.
- Manter "Economia mensal = valor × 0,20" (cálculo).
- Adicionar regra: "Não peça foto/doc no mesmo turno da simulação. Aguarde sinal de interesse explícito."

### `supabase/functions/_shared/vendedora-v1/planner.ts` (SYSTEM prompt)

- Adicionar regra dura: "Não avance de `simulacao` para `foto_conta` no mesmo turno em que apresentou o número. Exige sinal de interesse do lead no turno seguinte."

### Banco — `public.consultants`

- `UPDATE consultants SET ai_persona_fluxo_b = <novo DEFAULT_PROMPT>` em todos os consultores, para sobrescrever cópias antigas em cache (mesma estratégia da rodada anterior).

## O que NÃO muda

- Aberturas A–D, regras anti-alucinação, formatação WhatsApp, fórmula de cálculo (`× 0,20`), FAQ, tools, fluxo B state machine, OCR/portal.
- Memória `mem/copy/discount-rate-20.md`: continua válida — todo número final é 20%; a faixa é só linguagem.

## Validação após implementação

1. Rodar `fluxo-b-ai` em dryRun pelo painel `/admin/fluxos` com 3 cenários:
  - Conta R$ 150 → deve falar faixa entre *8% e 20%*" e NÃO pedir foto.
  - Conta R$ 350 → faixa entre *8% e 20%* + pergunta consultiva.
  - Conta R$ 600 + lead diz "quero" → aí sim pede foto.
2. Conferir que `pedir_foto_conta` não é chamado no mesmo turno de `registrar_valor_conta`.  
  
REGRA SEMPRE DE 08 A 20%
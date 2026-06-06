# Corrigir alucinações do prompt do Fluxo B

## Problema
A IA disse "Rafael Ferreira" e "80 mil clientes" — nenhum dos dois veio da sua base de conhecimento:

- **"Rafael"** é fallback hardcoded em `fluxo-b-prompt.ts:122` quando o nome do consultor não chega. O modelo completou "Ferreira" sozinho.
- **"80 mil clientes"** está escrito direto no `DEFAULT_PROMPT` (linhas 14, 37, 47, 62, 97) e em `vendedora-v1/writer.ts:81`. Foi colocado por mim no refino anterior como "prova social" — não veio da FAQ.

## O que mudar

### 1. `supabase/functions/_shared/fluxo-b-prompt.ts`
- **Remover toda menção a "80 mil clientes"** das 5 ocorrências no `DEFAULT_PROMPT`. Reescrever as 4 aberturas (A, B, C, D) e o tratamento da objeção "é golpe?" usando só fatos seguros: regulamentação ANEEL, mesma distribuidora, até 20% de desconto, sem obra.
- **Reforçar a regra anti-alucinação** para incluir explicitamente: "NUNCA cite número de clientes, anos de mercado, faturamento, ranking ou qualquer estatística que não esteja na # FAQ. Se não estiver, omita — não substitua por aproximação."
- **Trocar o fallback `"Rafael"`** (linha 122) por uma string neutra que não vire nome falso: usar `"da iGreen"` ou simplesmente vazio, e ajustar as aberturas pra funcionarem sem nome do consultor quando ele não existir. Alternativa: lançar erro/log se `ctx.representante` vier vazio, pra não silenciar o problema.

### 2. `supabase/functions/_shared/vendedora-v1/writer.ts:81`
- Remover "+80 mil clientes" da descrição da persona. Deixar só "energia limpa regulamentada pela ANEEL".

### 3. Aplicar o prompt atualizado em todos os consultores
- Rodar `UPDATE public.consultants SET ai_persona_fluxo_b = <novo DEFAULT_PROMPT>` para sobrescrever as cópias que já foram propagadas no refino anterior (que carregam o "80 mil clientes").

## O que NÃO mudar
- Funil, regras de fechamento, tratamento de objeções restantes, formatação WhatsApp, anti-alucinação existente, fórmula de economia (×0,20), regra de FAQ. Tudo isso fica.
- A leitura da FAQ via `ai_knowledge_sections` já funciona — o problema é só o prompt inventando fatos que deveriam vir de lá.

## Resultado esperado
- A IA nunca mais cita número de clientes a menos que esteja na sua FAQ.
- Se o `consultant.name` não chegar, ela se apresenta como "da iGreen" sem inventar um nome próprio.
- Sua base de conhecimento volta a ser a única fonte de prova social e números.

---
*Obs: `.lovable/` está no seu `.gitignore`, então este plano não persiste após o snapshot. Quer que eu remova essa entrada pra planos ficarem salvos no repo?*

# Objetivo

A partir de agora **toda conversa do Fluxo B roda exclusivamente a Vendedora V2** (a versão à prova de erro que acabamos de criar). V1 e legacy ficam desligados de vez — sem env var, sem sorteio, sem fallback silencioso.

# O que muda

## 1. `supabase/functions/_shared/fluxo-b-ai.ts` — entrar sempre em V2

- Remover o sorteio de variante (`pickVariant`, `fluxo_b_variant`, `variant_id`, `b.v1` vs `b.legacy`).
- Remover os flags `VENDEDORA_V1_FORCE_OFF` e `VENDEDORA_V2_ENABLED` e o flag `__force_vendedora_v2` que usávamos só no tester.
- Remover o import de `runVendedoraV1` (manter só `runVendedoraV2`).
- O caminho único passa a ser:
  - Carrega `customer`.
  - Se for nudge interno (`input.nudgeHook`), ainda usa o pipeline antigo de prompt+tool-calling (V2 não foi desenhada pra nudge — manter esse branch só pra reaquecer lead sumido).
  - Caso contrário, chama `runVendedoraV2(...)` direto e retorna o resultado com `variantId: "b.v2"`.
- Apagar todo o bloco "legacy fall-through" (linhas ~127–356) **exceto** a parte usada pelo nudge — extrair essa parte para uma função interna `runNudgeLegacy(...)` chamada só quando `isNudgeRun === true`.

## 2. `supabase/functions/_shared/vendedora-v1/index.ts` — limpar exports

- Manter `runVendedoraV2` como export principal.
- Marcar `runVendedoraV1` como deprecated (remover do export público) — não é mais chamada em runtime.

## 3. Tester (`src/components/admin/flow-builder/FluxoBEditor.tsx`)

- Remover os parâmetros `forceVariantId` e `forceV2` (não precisam mais existir; V2 é o único caminho).
- O metadado mostrado passa a ser sempre `vendedora_v2`.

## 4. Edge `supabase/functions/fluxo-b-ai/index.ts`

- Remover a leitura/forward de `forceVariantId` e `forceV2` do body.
- Remover a manipulação de `syntheticCustomer.variant_id` / `fluxo_b_variant`.

## 5. Banco — sem migração necessária

- As colunas `customers.variant_id` e `customers.fluxo_b_variant` continuam existindo (legado), mas deixam de ser lidas/gravadas. Nada quebra.
- `flow_variants` continua intacto — pode ser reaproveitado depois se quisermos voltar a A/B testar.

# Validação

1. Deploy `fluxo-b-ai`.
2. Rodar a sequência de teste no tester (`oi` → `sim` → `Sirlene` → `900` → `quero`), como funciona, golpe, quantos boleto vemm? demora?.
3. Confirmar em **todas** as respostas: `variantId === "b.v2"` e `debug.phase === "vendedora_v2"`.
4. Confirmar nos logs de edge: nenhuma chamada caiu no legacy (`phase: "fluxo_b_chat"`).
5. Confirmar nudge interno (follow-up) ainda funciona — disparar um nudge sintético e ver `runNudgeLegacy` rodando.

# Riscos

- **Nudge interno**: V2 hoje não trata reaquecimento de lead sumido. Manter o branch legacy só pra esse caso é a escolha mais segura. Se quiser que nudge também rode V2, vira tarefa separada.
- **Conversas antigas em V1**: leads que estavam no meio de um fluxo V1 vão receber respostas V2 no próximo turno. V2 lê o histórico e o estado, então transição é suave, mas pode haver leve duplicação de pergunta no primeiro turno pós-corte.

Posso executar?
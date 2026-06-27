## Objetivo

Auditar se o Fluxo D entregue aos números dos consultores (Whapi ou Evolution) é **realmente o mesmo** — mesmas etapas, mesmas transições, mesmas mídias, mesmas regras — com **única diferença permitida** sendo a forma de renderizar escolhas (botão interativo no Whapi vs. lista numerada no Evolution).

## Estado atual (levantamento)

**1. Resolução do fluxo — OK no papel.**
`supabase/functions/_shared/resolve-flow.ts` é único e usado pelos dois webhooks. Regra:
- consultor com `bot_flows.sync_mode='public'` → roteia para o fluxo PÚBLICO da variante D (`is_public=true`).
- consultor com `sync_mode='custom'` → usa o fluxo próprio.

Banco hoje (variante D):
- Fluxo público D: `320bf22c-…` (dono super-admin), ativo.
- Demais 6 consultores com fluxo D ativo: todos em `sync_mode='public'` → todos resolvem para `320bf22c`. ✅
- O fluxo público está marcado `sync_mode='custom'` (irrelevante: só importa para o dono, e o dono é o super-admin que **edita** o público).

**2. Mídias — também unificadas.**
`resolveMediaOwnerId` redireciona o `consultant_id` das mídias para o dono do fluxo público quando `sync_mode='public'`. Ou seja, áudios/vídeos/imagens do Fluxo D vêm do super-admin para todos. ✅

**3. Motores divergem entre canais — RISCO.**
Mesmo carregando o mesmo `flow_id`, as regras de execução vivem **duplicadas** em dois arquivos por canal:

```text
whapi-webhook/handlers/bot-flow.ts            6.267 linhas
evolution-webhook/handlers/bot-flow.ts        5.804 linhas
  → ~1.876 linhas de diff (cadastro: OCR, OTP, portal, doc, simulação)

whapi-webhook/handlers/conversational/index.ts   2.867 linhas
evolution-webhook/handlers/conversational/index.ts 2.626 linhas
  → ~1.212 linhas de diff (motor que interpreta o fluxo desenhado)
```

Já existem shims unificados em `_shared/bot/` para `state-machine`, `templates` e `step-namespace`, mas o miolo (bot-flow + conversational) ainda é duplicado. Toda correção aplicada de um lado precisa ser copiada à mão para o outro — e historicamente escapa (foi exatamente a origem dos bugs recentes de auto-avanço pós-simulação e da palavra-chave/QR do parceiro).

**4. Diferenças que DEVEM existir** (corretas, manter):
- Renderização de `ask_choice`: Whapi usa botões (`sendButtons`, máx 3), Evolution cai para texto numerado `*1.* …`. Já modelado em `channelPreview.ts` e `_shared/channels/dispatch-choice.ts`.
- Captura da resposta: Whapi lê `button_id`; Evolution lê dígito do texto.

**5. Diferenças que NÃO deveriam existir** (focos da auditoria):
- Ordem/intervalo de envio de mídia (`sleepForMedia`).
- Gate pós-simulação (o fix recente de `__post_bill_wait_step_id` foi aplicado no Whapi — verificar paridade no Evolution).
- Fallbacks `repeat` / `ai_answer` / handoff humano.
- Atalhos globais (números 1/2/3 no welcome, “humano”, “rafael”).
- Regra de re-welcome, silêncio pós-handoff, idempotência de buffer.
- Resolução de `goto_step_id` inválido e auto-cura de step órfão (bloco 1707–1770 do Evolution já existe; conferir se Whapi tem o equivalente exato).

## Plano de auditoria (somente leitura, com relatório versionado)

1. **Snapshot de configuração no banco**
   - Listar todos os `bot_flows` ativos da variante D, com `is_public`, `sync_mode`, `consultant_id` e `flow_id` resolvido por `resolveFlowId` (simulado).
   - Confirmar que 100% dos consultores ativos resolvem para o `flow_id` público.
   - Listar consultores em `sync_mode='custom'` (deveriam ser zero ou só o super-admin) — qualquer outro é desvio.

2. **Diff dirigido Whapi × Evolution**
   - Gerar `.kiro/specs/bot-engine-channel-unification/_artifacts/diff-bot-flow-D.md` e `diff-conversational-D.md` classificando cada bloco divergente em:
     - `OK-canal` (diferença de botão/lista, esperada),
     - `BUG-paridade` (regra de negócio divergente — precisa unificar),
     - `MORTO` (código que nenhum dos canais ainda alcança no Fluxo D).

3. **Simulação de runtime para o Fluxo D** (igual ao `report.md` existente em `.kiro/specs/fluxo-d-auditoria/`, mas comparando saídas dos dois motores reais, não do emulador)
   - Para as 11 jornadas já catalogadas (happy path FOTO/VALOR, dúvida+IA, loop 3x, handoff por texto, numéricos 1/2/3, etc.), rodar os handlers de cada canal em modo dry-run e comparar:
     - sequência de passos atingidos,
     - textos emitidos (ignorando o sufixo `*1.* / *2.*`),
     - mídias enviadas (`media_id`),
     - estado final (`conversation_step`, `flow_variant`).
   - Qualquer divergência fora de “forma de escolha” entra no relatório como `BUG-paridade`.

4. **Verificação dos fixes recentes**
   - Confirmar que o gate `stepHasInteractiveWait` e `__post_bill_wait_step_id` (fix do auto-avanço após simulação) está presente também no Evolution.
   - Confirmar que o bloco `step-mismatch-cure` (auto-cura de step órfão) é idêntico nos dois.
   - Confirmar idempotência de buffer (`conversational-send-idempotency.ts`) é chamada igual nos dois.

5. **Entregáveis** (sem mudar código de produção)
   - `.kiro/specs/bot-engine-channel-unification/_artifacts/parity-fluxo-D-report.md` com:
     - tabela consultor × `flow_id` resolvido,
     - lista de `BUG-paridade` encontrados, com linha exata Whapi vs. Evolution,
     - veredito por canal: “Fluxo D idêntico ✅” ou “Divergente: N pontos”.
   - Recomendação final: **manter rota de unificação já iniciada na spec `bot-engine-channel-unification`** (extrair miolo para `_shared/bot/` e deixar webhooks só com parse de inbound + adapter de canal), priorizando os `BUG-paridade` encontrados como primeiras tarefas.

## Detalhes técnicos

- Roda 100% read-only: nenhuma migration, nenhum deploy, nenhuma alteração de fluxo.
- Scripts ficam em `.kiro/specs/bot-engine-channel-unification/_artifacts/` (Python para o diff classificado, TS dry-run para a simulação).
- Resultado fica versionado em markdown; o usuário aprova antes de qualquer correção de paridade.

## Fora de escopo desta tarefa

- Refatorar/unificar os handlers (já é a spec `bot-engine-channel-unification`).
- Alterar o fluxo público D em si.
- Mexer em mídias.
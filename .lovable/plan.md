
# Plano: Vendedora v1 → venda completa + ferramentas de operação

Objetivo: a v1 vira uma vendedora que **fecha o cadastro sozinha** (foto da conta + RG/CNH + e-mail + telefone confirmado) chamando o mesmo `finalize-capture` que os outros fluxos usam — sem reinventar portal/sync. Em paralelo, entregamos as 7 melhorias da auditoria, com painel A/B desenhado pra **N variantes** (não só duas).

## 1. Cadastro completo dentro da v1

A v1 hoje só pede "foto da conta" e "documento" e para. Vamos estender pra cobrir o checklist completo, na mesma lógica que `finalize-capture` exige.

### Campos obrigatórios que ela precisa capturar/confirmar
- `name` (já tem)
- `electricity_bill_value` (já tem)
- `electricity_bill_photo_url` — foto/PDF da conta (vem do webhook quando lead manda mídia)
- `document_front_url` + `document_back_url` (RG) **ou** `document_front_url` apenas (CNH) — vem do webhook
- `document_type` ('rg' | 'cnh')
- `email` — **novo, hoje a v1 não pede**
- `phone_whatsapp` — já vem do webhook
- `address_city` / `address_state` (extraídos do OCR da conta)

### Mudanças no playbook
Nova etapa entre `doc` e `finalizando`: **`email`**. Sequência completa do funil:
```text
interesse → nome → valor → simulacao → foto_conta → doc → email → finalizando → pos_cadastro
```

### Novas tools no Writer
- `registrar_email(email)` — valida regex, grava em `customers.email`.
- `confirmar_telefone(telefone)` — confirma se o WhatsApp é o melhor pra contato (alguns leads pedem outro).
- `finalizar_cadastro()` — passa a **realmente chamar** `finalize-capture` (hoje só muda step). Antes de chamar, a v1 valida o checklist; se falta algo, pede o que falta em vez de finalizar.

### Integração com `finalize-capture`
`runVendedoraV1` ganha um helper `tentarFechar(customerId)`:
1. Lê o customer atualizado.
2. Verifica checklist (`name`, `email`, `bill_url`, `doc_urls`, `phone`, `electricity_bill_value`).
3. Se completo → chama `finalize-capture` via `supabase.functions.invoke` com auth de service role.
4. Se incompleto → planner força a próxima etapa pelo campo que falta.

Quando o `finalize-capture` responde OK, a v1 marca `conversation_step = "cadastro_finalizando"`, envia a mensagem de confirmação ("seu cadastro foi enviado, em até 5 min você recebe…") e pausa o bot pra acompanhamento humano em caso de erro do portal.

### Tratamento de mídia (foto da conta, doc)
A v1 não processa mídia hoje. Quando o webhook recebe imagem/PDF, ele:
- Salva URL em `electricity_bill_photo_url` ou `document_front_url`/`_back_url` (já é feito).
- Chama a v1 com `inboundText = "[CONTA RECEBIDA]"` ou `"[DOC RECEBIDO]"`.

Vamos adicionar **detecção desses marcadores** no início do `runVendedoraV1`: se o inbound começa com `[CONTA RECEBIDA]`, o planner pula direto pra próxima etapa (não tenta "responder" a foto). Análoga pra documento.

## 2. Sistema genérico de variantes (substitui o A/B binário atual)

Você tem razão: hoje é "v1 vs legacy", mas haverá Fluxo A, B, C, D, e dentro de cada um, várias subvariantes. O sorteio precisa ser genérico.

### Tabela `flow_variants` (nova)
| coluna | tipo | função |
|---|---|---|
| `id` | text PK | ex: `b.v1`, `b.legacy`, `d.express_v2` |
| `fluxo` | text | `A` / `B` / `C` / `D` |
| `nome` | text | rótulo amigável |
| `descricao` | text | o que essa variante faz de diferente |
| `weight` | int | peso no sorteio (0 = desligada) |
| `is_active` | boolean | kill switch global da variante |
| `consultant_overrides` | jsonb | `{ "<consultant_id>": { weight, is_active } }` pra kill switch por consultor |

### Coluna em `customers`
- Mantém `flow_variant` (A/B/C/D) — sem mudança.
- `fluxo_b_variant` (text) vira **`variant_id`** (text, ex: `b.v1`) — generaliza pra qualquer fluxo. Migração: backfill `b.legacy`/`b.v1` baseado no valor atual.

### Roteamento
Substitui o `Math.random() < 0.5` por:
```ts
const variant = await pickVariant({ supabase, fluxo: customer.flow_variant, consultantId });
```
`pickVariant` lê `flow_variants` ativas pro fluxo do lead, aplica overrides do consultor, faz sorteio ponderado e persiste em `customers.variant_id`.

### Kill switch (resolve item 3 sem código extra)
- **Por consultor:** edita `consultant_overrides`.
- **Global:** `weight = 0` ou `is_active = false`.
- **Emergência total:** env var `VENDEDORA_V1_FORCE_OFF=true` em `runFluxoBAI` força `legacy`.

## 3. Painel A/B genérico — `/admin/fluxo-b` ganha aba "Variantes"

UI mostra uma **tabela por fluxo**, uma linha por variante, comparando KPIs lado a lado (N variantes, não 2):

| Variante | Leads | Turnos médios | % chegou em `simulacao` | % chegou em `foto_conta` | % chegou em `doc` | % `cadastro_finalizando` | % handoff humano | Latência média | Custo médio/lead |
|---|---|---|---|---|---|---|---|---|---|

Filtros: período (1d / 7d / 30d), consultor, fluxo (A/B/C/D).

Cada linha tem botões: **Pausar** (zera weight), **Forçar 100%** (zera weights das outras desse fluxo).

Dados vêm de:
- `ai_decisions` (turnos, latência, custo via tokens, source/variante).
- `customers` agrupado por `variant_id` (etapa final atingida).

## 4. Embeddings automáticos do `/admin/conhecimento?tab=ia`

### Trigger no banco
`AFTER INSERT OR UPDATE OF title, content, is_active ON ai_knowledge_sections` → chama edge `embed-knowledge` via `pg_net` com o `id` da seção. A edge gera embedding daquela seção e grava em `embedding`.

### Botão manual no admin
"Regerar todos os embeddings" — útil quando trocar modelo ou pra primeira carga. Mostra progresso (X/Y seções processadas).

### Indicador visual
Cada seção mostra um badge: ✅ embeddado / ⏳ pendente / ⚠️ erro. Vem de `embedding IS NOT NULL` + `embedding_updated_at`.

## 5. "Marcar conversa vencedora" no chat admin

No componente que renderiza a conversa do lead no admin, adiciona um botão **"⭐ Marcar como vencedora"** ao lado de cada mensagem do bot (ou no header da conversa pra marcar o trecho inteiro).

- Abre modal: escolhe `etapa` (interesse/valor/objecao/fechamento), seleciona o trecho de mensagens (slider de N msgs antes/depois), opcional `outcome` ("fechou", "quebrou objeção X").
- Chama edge `marcar-conversa-vencedora` (já existe) — ela monta o snippet, gera embedding, grava em `ai_winning_conversations`.
- Lista das vencedoras já marcadas aparece numa aba nova em `/admin/conhecimento?tab=vencedoras`.

## 6. Worker de `followup_at` (cron 5 min)

Edge function nova `process-followups`:
1. Lê `customers WHERE followup_at <= now() AND bot_paused = false AND variant_id LIKE 'b.%'`.
2. Pra cada lead: roda `runVendedoraV1` com inbound sintético `[FOLLOWUP_AGENDADO: <gancho>]`.
3. Writer entende o marcador e escreve a mensagem de retomada usando o `followup_hook` como contexto.
4. Salva resposta via canal certo (whapi/evolution), zera `followup_at`, incrementa `followup_count`.

### Guardrails
- Máx 2 followups por lead (`followup_count >= 2` → não dispara).
- Janela 9h–20h horário do consultor.
- Skip se houve mensagem do lead nas últimas 12h.
- Skip se `bot_paused = true`.

Cron: `*/5 * * * *` via `pg_cron` + `pg_net`.

## 7. Debug da v1 no tester `/admin/fluxo-b`

O `runVendedoraV1` já devolve `debug: { perfil, plano, ragChunks, criticoAprovado, criticoProblemas, stateBefore, stateAfter }`. Mas:
- A edge `fluxo-b-ai` (HTTP wrapper) **não está propagando o `debug`** no JSON de resposta.
- A UI do tester não tem painel pra renderizar.

Mudanças:
- `supabase/functions/fluxo-b-ai/index.ts`: incluir `debug` no `return json(...)`.
- `AdminFluxoB.tsx`: novo painel "Decisão interna" mostrando perfil (badges de temperatura/sentimento), plano (etapa, jogada, tom, info_a_capturar), nº chunks do RAG, parecer do crítico (aprovado/problemas), state antes/depois (diff).

## 8. Decisão sobre `oferecer_cadastro_express`

Hoje é **idêntica** a `pedir_foto_conta`. Como agora a v1 vai fechar o cadastro completo (item 1), a tool fica redundante. **Removo a tool** e ajusto o playbook pra usar `pedir_foto_conta` direto. Se no futuro existir um fluxo express real (form web curto), recriamos.

---

## Ordem de implementação

1. **Item 1 — cadastro completo + integração com `finalize-capture`** (núcleo, sem isso a v1 não vende).
2. **Item 4 — embeddings automáticos** (sem isso o RAG é decoração).
3. **Item 7 — debug no tester** (pra você conseguir validar 1 e 4).
4. **Item 2/3 — `flow_variants` + painel A/B + kill switch** (mede e controla).
5. **Item 5 — marcar conversa vencedora** (alimenta RAG ao longo do tempo).
6. **Item 6 — worker de followup** (último, com guardrails).
7. **Item 8 — remover `oferecer_cadastro_express`** (junto com item 1).

## Detalhes técnicos

### Arquivos a criar
- `supabase/migrations/<ts>_flow_variants_and_followup.sql` — tabela `flow_variants`, renomeia `fluxo_b_variant` → `variant_id`, adiciona `email` (se não existir), `followup_at`, `followup_hook`, `followup_count` em customers; trigger `pg_net` em `ai_knowledge_sections`.
- `supabase/functions/process-followups/index.ts` — worker.
- `supabase/functions/_shared/vendedora-v1/closer.ts` — checklist + chamada a `finalize-capture`.
- `supabase/functions/_shared/vendedora-v1/variant-picker.ts` — sorteio ponderado.
- `src/pages/AdminVariants.tsx` (ou aba em `AdminFluxoB.tsx`) — painel A/B.
- `src/components/admin/ChatWinningButton.tsx` — botão "marcar vencedora" + modal.
- `src/components/admin/fluxo-b/DebugPanel.tsx` — painel de decisão interna.

### Arquivos a editar
- `supabase/functions/_shared/vendedora-v1/playbook.ts` — adiciona etapa `email`, remove `oferecer_cadastro_express`.
- `supabase/functions/_shared/vendedora-v1/tools.ts` — adiciona `registrar_email`, `confirmar_telefone`, ajusta `finalizar_cadastro`.
- `supabase/functions/_shared/vendedora-v1/index.ts` — detecta `[CONTA RECEBIDA]`/`[DOC RECEBIDO]`/`[FOLLOWUP_AGENDADO]`, chama `closer.tentarFechar()`.
- `supabase/functions/_shared/fluxo-b-ai.ts` — troca `Math.random()` por `pickVariant()`, lê env `VENDEDORA_V1_FORCE_OFF`.
- `supabase/functions/fluxo-b-ai/index.ts` — propaga `debug`.
- `supabase/functions/evolution-webhook/handlers/bot-flow.ts` e `whapi-webhook/handlers/bot-flow.ts` — quando recebe mídia (conta/doc), enviar inbound sintético pra v1.
- `src/pages/AdminKnowledge.tsx` — botão "regerar embeddings" + badges de status.
- `src/pages/AdminFluxoB.tsx` — abas "Tester" / "Variantes" / "Vencedoras".

### Cuidados
- Não tocar Fluxo A, C, D em código de IA — só o `flow_variants` é genérico.
- Edge `finalize-capture` já tem todas as validações; v1 só **chama**, não duplica lógica de portal.
- Painel A/B é **read-only** dos dados existentes em `ai_decisions` + `customers` — não precisa de tabela nova de métricas.
- Worker de followup roda com service role; respeita `bot_paused` rigorosamente.

## Vai melhorar mesmo?

Sim, e agora com efeito composto:
- **Item 1** é o que muda o jogo: a v1 deixa de ser um chatbot e vira uma vendedora que **conclui a venda**. Sem isso, todos os outros itens são cosméticos.
- **Itens 2 + 3 + 7** garantem que você **vê** o resultado e pode pausar com 1 clique se a v1 começar a vender pior que a legacy.
- **Itens 4 + 5** alimentam o cérebro da v1 com conhecimento real e exemplos vencedores — é onde o ganho de longo prazo mora.
- **Item 6** é o último porque só faz sentido depois que a v1 já estiver provada.


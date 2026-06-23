## Auditoria: os passos do Fluxo A vão funcionar em qualquer fluxo novo?

### Resposta curta

**SIM**, com 2 ressalvas pequenas. O engine reconhece os passos pelo `step_type`, não pelo UUID — então qualquer fluxo novo com os mesmos `step_type`s funciona igual.

---

### Como o engine resolve os passos (evidências no código)

`whapi-webhook/handlers/bot-flow.ts` (linhas 2796-2848) tem o **custom-step-resolver**: dado um `conversation_step` (UUID ou step_key custom), busca em `bot_flow_steps` e mapeia o `step_type` pro handler legacy:


| step_type                           | handler legacy        | função                                         |
| ----------------------------------- | --------------------- | ---------------------------------------------- |
| `capture_conta`                     | `aguardando_conta`    | OCR da conta de luz + extração                 |
| `capture_documento` / `capture_doc` | `aguardando_doc_auto` | OCR de RG/CNH com auto-detect                  |
| `capture_email`                     | `ask_email`           | validação de e-mail                            |
| `confirm_phone`                     | `ask_phone_confirm`   | confirma telefone (Sim/Editar)                 |
| `finalizar_cadastro`                | `finalizando`         | dispara Portal2 + OTP + selfie                 |
| `message`                           | passo informativo     | só envia texto+mídia e avança por `position+1` |


`resolveFlowId` (`_shared/resolve-flow.ts`) busca o flow ativo por **consultant_id + variant** — sem UUIDs hard-coded.

### O que confere no banco hoje

**Fluxo A do Rafael** (`28acf20a…`, variant=A, sync_mode=custom):


| pos | step_type            | captures                                    | transitions                | fallback        | status |
| --- | -------------------- | ------------------------------------------- | -------------------------- | --------------- | ------ |
| 1   | `capture_conta`      | ✅ corrigido agora                           | `[]` (avança por position) | `{mode:repeat}` | OK     |
| 2   | `capture_documento`  | ✅ `media + auto_detect_doc_type`            | `[]`                       | `{mode:repeat}` | OK     |
| 3   | `capture_email`      | ✅ `text + email`                            | `[]`                       | `{mode:repeat}` | OK     |
| 4   | `confirm_phone`      | ✅ `text + telefone`                         | `[]`                       | `{mode:repeat}` | OK     |
| 5   | `finalizar_cadastro` | `[]` (correto: não captura, dispara portal) | `[]`                       | `{mode:repeat}` | OK     |


**Uso global desses step_types em outros fluxos** (todas as 8 instâncias de cada `confirm_phone`, `capture_email`, `capture_documento`, `finalizar_cadastro` no banco rodam pela mesma engine): consistente.

### Hard-codes encontrados — 1 só, sem impacto

- `supabase/functions/_shared/image-capture-step_test.ts:51` → `const UUID = "3d69389d…"`. **É arquivo de teste**, não roda em produção. Pode ficar.

### Ressalvas (não impedem funcionar, mas vale corrigir)

**R1. Não existe template público variante A.** Hoje só `variant=D` tem `is_public=true`. Se um novo consultor criar fluxo variante A com `sync_mode='public'`, o `resolveFlowId` cai no fallback e pode pegar o flow errado. **Recomendado:** marcar o Fluxo A do Rafael como `is_public=true` (vira o template oficial da variante A).

**R2. `step_key` precisa ser único por flow.** Se duplicar `step_key` ao criar fluxo novo, o resolver pega o `.maybeSingle()` e quebra. Hoje todos os 117 passos do banco respeitam isso, mas o editor não bloqueia — **recomendado adicionar índice único `(flow_id, step_key)**`.

### Plano

1. **Marcar o Fluxo A do Rafael como `is_public=true**` → vira template oficial da variante A. Novos consultores em `sync_mode='public'` herdam direto.
2. **Adicionar índice único `(flow_id, step_key)` em `bot_flow_steps**` → garantia de que step_key não duplica.
3. **Smoke test:** criar um fluxo novo de teste copiando esses 5 step_types e simular um lead percorrendo as 5 etapas (existe `src/lib/flow-simulator/engine.ts`).

Posso aplicar 1 e 2 numa migração e rodar o simulador no passo 3. SIM
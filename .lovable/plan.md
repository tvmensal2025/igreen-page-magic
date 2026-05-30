## Análise do que aconteceu com o BRUNO (5511971254913, flow_id=320bf22c, variant D)

### Timeline real (SP)
```
21:41:52  bot → d_welcome
21:41:57  user → "Quero simular"
21:42:04  bot → d_pedir_conta (capture_conta) ✅
21:42:39  user → "Eu gasto 300 reais por mes" (re-tentativa)
21:43:39  user → [PDF da conta]
21:43:50  bot → OCR rodou + enviou botões "✅ SIM / ❌ NÃO / ✏️ Editar"
21:43:57  user → "✅ SIM"   ← último evento "normal"
─── 4 min de silêncio ───
21:48:08  bot → d_como_funciona [audio]  (tag "(manual)")
21:48:43  bot → d_como_funciona [video]  (tag "(manual)")
21:48:44  bot → d_como_funciona [texto]  (tag "(manual)")
21:49:31  user → clicou de novo "📸 Quero simular"  ← loop
```

### Fluxo D canônico (`bot_flow_steps` ordenados)
```
1  d_welcome           message
2  d_pedir_conta       capture_conta
3  d_como_funciona     message  ← entre captures
4  d_resultado         message  ← entre captures
5  d_pedir_documento   capture_documento
6  d_pedir_email       capture_email
7  d_confirmar_telefone confirm_phone
8  d_duvidas           message
9  d_handoff           message
10 d_finalizar         finalizar_cadastro
```

Depois do "✅ SIM" o esperado é: dispara `d_como_funciona` → `d_resultado` → avança pro capture `d_pedir_documento`. Isso é exatamente o que `dispatchPostBillConfirm` (em `src/lib/captacao/postBillConfirm.ts` + espelho Deno) faz.

### O que de fato aconteceu
1. Handler do botão SIM **não chamou** `dispatchPostBillConfirm` (ou chamou e morreu antes da primeira mensagem) — 4 min de silêncio total.
2. 4 min depois alguém (Rafael ou cron) disparou **só** `d_como_funciona` via `manual-step-send` (todas as 3 mensagens carregam tag `(manual)`).
3. `d_resultado` (posição 4) **nunca** foi enviado.
4. `d_pedir_documento` (próximo capture) **nunca** foi disparado → cliente ficou sem próxima instrução e clicou no botão antigo do welcome.

### Causa provável (a investigar)
O caminho que processa `ButtonsV3:sim_conta` mora em `supabase/functions/whapi-webhook/handlers/bot-flow.ts`. Alterações recentes em volta de `portalValidation` / `distribuidoras` podem ter introduzido um throw silencioso *antes* do dispatch do próximo passo (provável suspeita: import novo ou normalize quebrando quando `customer.distribuidora="CPFL ENERGIA"`, já que era esse o valor gravado no momento do SIM).

---

## Plano de correção

### 1. Confirmar a causa (10 min, read-only)
- Ler `supabase/functions/whapi-webhook/handlers/bot-flow.ts` e localizar o handler do `sim_conta` (`confirmando_dados_conta`).
- Verificar se ele chama `dispatchPostBillConfirm` direto, ou se passa por algum validador novo.
- Comparar com `supabase/functions/_shared/pipeline-cadastro/registry.ts` se for o orquestrador real.
- Confirmar nos `edge-function-logs` (`whapi-webhook` filtrando por `customer=b5bbc2c2`) o que rodou entre 00:43:57 e 00:48:08 UTC.

### 2. Blindar o dispatch pós-SIM
Em **`supabase/functions/whapi-webhook/handlers/bot-flow.ts`** (handler do SIM):
- Envolver todo o bloco "marca bill_data_confirmed_at → dispatchPostBillConfirm" em try/catch que **sempre** loga `console.error("[sim_conta] dispatch falhou", err)` e **dispara fallback**: marcar `customers.error_message = "post_bill_dispatch_failed: <msg>"` e enviar texto simples "✅ Recebido! Já passo os próximos passos." pra não deixar o cliente mudo.
- Garantir que `normalizeDistribuidora` / `isHoldingName` (importados no OCR) **não** estão sendo chamados nesse caminho. Se estiverem, isolar atrás de try/catch — esses módulos não podem quebrar dispatch.

### 3. Replicar pro espelho Evolution
**`supabase/functions/evolution-webhook/handlers/bot-flow.ts`** tem o mesmo SIM handler — aplicar a mesma blindagem.

### 4. Resiliência no `dispatchPostBillConfirm` (`supabase/functions/_shared/...` + `src/lib/captacao/postBillConfirm.ts`)
- O `try` externo hoje engole erro do "advance flow" e não loga o customer_id — adicionar `console.error("[post-bill-confirm] customer=%s next=%s err=%s", customer.id, nextCaptureKey, err.message)`.
- Se nenhum `manual-step-send` retornou ok (entre + nextCapture), gravar `customers.error_message="post_bill_confirm_no_dispatch"` pra alerta do watchdog acordar.

### 5. Verificação manual
1. Refazer o fluxo no 5511971254913 com lead novo até "✅ SIM" → conferir nos logs:
   - `[post-bill-confirm] msg-step d_como_funciona ok`
   - `[post-bill-confirm] msg-step d_resultado ok`
   - `manual-step-send d_pedir_documento ok`
2. Forçar erro (renomear flow step) → confirmar que o fallback "Já passo os próximos passos" sai e o `error_message` no `customers` é populado.
3. Conferir que o card de captação no /admin do BRUNO mostra o `error_message` novo (já é exibido pelo `CaptureLeadCard`).

### Fora de escopo
- Reescrita do orquestrador de variantes.
- Mudança no `bot_flow_steps` do consultor (a ordem está correta).
- Re-OCR ou mexer no Portal 2 worker.

### Detalhes técnicos
- Arquivos a editar:
  - `supabase/functions/whapi-webhook/handlers/bot-flow.ts` (handler `sim_conta`)
  - `supabase/functions/evolution-webhook/handlers/bot-flow.ts` (mesmo handler, paridade)
  - `supabase/functions/_shared/...` (logging do `dispatchPostBillConfirm` — se o helper morar lá; senão o `src/lib/captacao/postBillConfirm.ts`)
- Nada de migração de banco.
- Nada de mudar `flow_variant=D` do customer.

> Aviso: o diretório `.lovable/` está no `.gitignore` do projeto. Este plano vive em `.lovable/plan.md` e **vai sumir no próximo snapshot** — se quiser preservar, remova `.lovable/` do `.gitignore`.

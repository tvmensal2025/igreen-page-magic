## Onde erramos no mapeamento (validação profunda)

Caso José Gonçalves (`92b1e988…`) — o operador **não** anexou errado. O bot manda o cliente para uma rota que exige um documento diferente do que a UI e o slot conseguem entregar.

### Cadeia do bug (confirmada no código)

1. **Bot** (`supabase/functions/whapi-webhook/handlers/bot-flow.ts:5786-5790`)
   `ask_contaunica` grava simultaneamente `contaunica = <escolha>` e `transferir_titularidade = <mesma escolha>`.

2. **Worker** (`worker-portal-2/server.mjs:1183-1186`) — comentário literal:
   ```
   // UX bot = boleto; portal = titularidade. Mesma escolha: unificado ⇔ transferir.
   contaUnica: c?.contaunica_answered === true ? !!c?.contaunica : false,
   transferirTitularidade: c?.contaunica_answered === true ? !!c?.contaunica : false,
   ```
   Ou seja: escolher "unificado" no bot vira `contaUnica=true + transferirTitularidade=true` no POST /customers.

3. **Extractor iGreen** (`server.mjs:720-772`) trata BOLETO e FATURA como estruturas diferentes. Quando o portal recebe `contaUnica=true + transferir_titularidade=true`, ele avalia o anexo do slot `energy-bill` esperando comprovante bancário e a IA reprova com:
   > *"é uma fatura/conta de energia elétrica da CPFL, não um comprovante de pagamento bancário"*

4. **Slot único de anexo** (`src/components/captacao/CaptureDocumentTiles.tsx:15-19`) — só existe `electricity_bill_photo_url`. Não há como o operador subir um boleto separado. `worker-portal-2/portal2-api-client.mjs:947` só usa esse slot, embora o portal iGreen aceite também `payment-proof` e `energy-bill-2` (`portal2-api-client.mjs:779-780`).

5. **Rótulo da UI mente o oposto do portal** (`CaptureBoletoPreference.tsx:14-25`): "Unificado — Um boleto (energia + iGreen juntos)". Isso vende **benefício futuro**, mas o portal usa a mesma flag como **comprovante atual**. Cliente e operador respondem "unificado" pensando em outra coisa.

6. **Sem gate cruzado** (`supabase/functions/_shared/portalValidation.ts`) — só valida presença de campo (`contaunica_answered=true`), não valida coerência entre resposta e tipo de arquivo. A reprovação só aparece depois do worker consumir o job.

### Correção (mantém o trace canônico intacto)

**A. Bot — `bot-flow.ts` step `ask_contaunica`**
- Trocar a pergunta para o que o portal realmente quer saber:
  "Hoje você recebe **um único boleto bancário** que já inclui energia + iGreen? 1-Sim / 2-Não / 3-Ainda não sei"
- Se 1-Sim → gravar `contaunica=true` **e** pedir explicitamente a foto do boleto no próximo passo.
- Se 2-Não ou 3 → `contaunica=false` (mantém o trace canônico já validado).
- **Desacoplar** `transferir_titularidade` — vira pergunta separada só quando aplicável, não mais casada 1:1.

**B. UI ficha — `CaptureBoletoPreference.tsx`**
- Reescrever os labels: "Boleto único (comprovante bancário)" e "Boletos separados (fatura da distribuidora)". Sem prometer "benefício futuro" no rótulo.

**C. Novo slot — `CaptureDocumentTiles.tsx`**
- Quando `customer.contaunica === true`, mostrar um segundo tile **obrigatório**: "Boleto bancário".
- Persistir em nova coluna `electricity_boleto_photo_url` (nullable).

**D. Worker — `worker-portal-2/server.mjs` + `portal2-api-client.mjs`**
- Quando `contaUnica=true`, resolver `billFile` a partir de `electricity_boleto_photo_url`.
- Se `contaUnica=false`, manter comportamento canônico (fatura no slot `energy-bill`).
- Opcional (não obrigatório para o fix): subir também o comprovante no slot `payment-proof` do portal quando disponível.

**E. Gate cedo — `supabase/functions/_shared/portalValidation.ts` + `finalize-capture`**
- Nova regra: `contaunica=true && !electricity_boleto_photo_url` → `missing: ["Boleto bancário"]` no `finalize-capture`, antes de enfileirar o worker.
- Botão "Finalizar" no `FinalizeButton.tsx` continua funcionando (ele já reage a `missing`).

**F. Admin monitor — `AdminPortalMonitor.tsx`**
- Quando `portal2_error_kind = 'ia_reprovada'` e a `rejection_reason` mencionar "comprovante de pagamento", exibir chip "Anexo x modo divergente — cliente marcou boleto único, portal exige comprovante bancário" + atalho "Trocar anexo/rota".

**G. Migração**
```sql
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS electricity_boleto_photo_url text;
```
Sem novos GRANTs — herda as políticas atuais de `customers`. Sem trigger novo.

### Ação imediata pro José Gonçalves (sem esperar o deploy acima)

Escolher **uma** conforme o caso real:

1. Ele **não** recebe boleto único hoje → corrigir na ficha `contaunica=false, transferir_titularidade=false`, manter a fatura CPFL já anexada, reenviar. Trace canônico → passa.
2. Ele **recebe** boleto único hoje → pedir foto do boleto bancário, substituir `electricity_bill_photo_url` por essa nova imagem, reenviar. Passa também.

### Verificação depois do deploy

- Cadastro `contaunica=false` + fatura CPFL → gate IA passa (trace canônico preservado).
- Cadastro `contaunica=true` + boleto no novo slot → gate IA passa.
- Cadastro `contaunica=true` sem boleto → `finalize-capture` retorna `missing: ["Boleto bancário"]` sem chamar worker.
- Cadastro antigo com `contaunica=true` + fatura no slot antigo → UI bloqueia antes; se passar via API direta, gate IA continua reprovando (rede de segurança).

### O que NÃO mexer

- Não afrouxar `evaluateIaGate` (`portal-errors.mjs:259-263`) — a reprovação é correta.
- Não alterar o trace oficial `e923a09c-abba-4ae1-a256-80e97094f686` nem mexer em `PORTAL2_AI_AUDIT_LIMIT`.
- Não mexer nas atribuições/campanha/rodízio — não tem relação com esse bug.
- Não mudar `resolveConcessionariaByCep`, `formatPhone`, `formatCep`, bonus rule — preservados.
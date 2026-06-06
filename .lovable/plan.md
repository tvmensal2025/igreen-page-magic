## Análise do fluxo — telefone 5511971254913 (lead JOSE FELICIO BATISTA / `e7faa174-7904-44ae-b923-66d676fd30be`)

Reconstruí toda a jornada a partir da tabela `conversations`. O fluxo correu bem até o final do cadastro e travou no penúltimo passo.

### Linha do tempo real

```text
04:33:06  IN   "Oi"                                 → welcome
04:33:11  OUT  d_welcome (menu numérico)
04:33:20  IN   "3"
04:33:32  OUT  "Me envia a foto da conta de luz"    → aguardando_conta
04:33:50  IN   [imagem] conta de luz                ✅ OCR ok
04:34:01  IN   "1"                                  confirmando_dados_conta
04:34:05  OUT  d_resultado (simulação R$ 255,35 → economia R$20–52)
04:34:12  IN   "1"
04:34:20  OUT  "Agora preciso do RG/CNH"            → aguardando_doc_auto
04:34:29  IN   [PDF] documento                      ✅ OCR doc ok
04:34:45  IN   "1"                                  confirmando_dados_doc
            (bot detectou mismatch nome conta × doc)
04:34:55  IN   "1"   ┐
04:35:06  IN   "1"   │
04:35:14  IN   "1"   │ ← LOOP: bot fica em confirmar_titularidade
04:35:22  IN   "2"   │   e reenvia sempre a mesma pergunta
04:35:30  IN   "3"   ┘
```

### Causa raiz

O step `**confirmar_titularidade**` (handler em `supabase/functions/evolution-webhook/handlers/bot-flow.ts:4202-4231`) só aceita três entradas:

- button id `titular_mesmo` / texto casando `/mesma|sou eu|igual/`
- button id `titular_outro` / `/outro|cônjuge|esposa|pai|mãe/`
- button id `titular_corrigir` / `/corrigir|errado|edit/`

Quando nenhuma casa, chama `sendOptions(...)` com três botões. **Mas o adapter Evolution loga `supports_buttons:false**` — então `sendOptions` cai no fallback de texto, que numera as opções como 1/2/3. O usuário responde "1", "2", "3" — e o handler **não tem mapeamento numérico**, então cai no `else` e repete a mesma pergunta infinitamente.

Mesmo bug existe no whapi-webhook (canal Whapi também não suporta botões nativos da mesma forma neste step).

### Impacto para os consultores

Qualquer lead em que o nome do RG/CNH não bate exatamente com o nome da conta de luz (caso muito comum: conta no nome do pai/cônjuge) **trava aqui e não finaliza cadastro**. O bot fica em loop até o lead desistir.

---

## Plano de correção

### 1. Aceitar respostas numéricas em `confirmar_titularidade`

Em `supabase/functions/evolution-webhook/handlers/bot-flow.ts` (case `confirmar_titularidade`, linhas 4202-4231), adicionar mapeamento:

- `"1"` → `titular_mesmo`
- `"2"` → `titular_outro`
- `"3"` → `titular_corrigir`

Antes da cadeia de regex existente, normalizar:

```ts
const numMap: Record<string,string> = { "1":"titular_mesmo","2":"titular_outro","3":"titular_corrigir" };
const normalized = numMap[resp] ?? resp;
```

E usar `normalized` nas comparações de id. Os regex de texto livre continuam funcionando.

### 2. Reescrever o fallback de texto para deixar a opção numérica explícita

Quando `sendOptions` cai em texto, o prompt já vira algo como "1) Mesma pessoa / 2) Outro titular / 3) Corrigir", mas o `reply` de fallback `"Responda: *mesma pessoa*, *outro titular* ou *corrigir*."` não ensina o atalho. Trocar por:

```
Responda com o número:
*1* Mesma pessoa
*2* Outro titular
*3* Corrigir dados
```

### 3. Aplicar a mesma correção no whapi-webhook

`supabase/functions/whapi-webhook/handlers/bot-flow.ts` tem o handler espelhado (o repo mantém os dois webhooks em paralelo). Aplicar a mesma mudança lá.

### 4. Validação (sem nova migração, sem mudar schema)

- Editar manualmente o lead `e7faa174-...` voltando para `confirmar_titularidade` (SQL UPDATE) e responder "1" → deve avançar para o próximo step (validação facial / endereço, via `autoResolveCepIfNeeded`).
- Conferir logs `evolution-webhook`: `handler_done step_before=confirmar_titularidade step_after=<próximo>` (hoje fica `step_after=confirmar_titularidade`).
- Confirmar que nenhum outro step do funil tem o mesmo padrão (botões + numeração não-mapeada). Vou varrer rapidamente `confirmando_dados_doc`, `confirmando_dados_conta`, `editing_doc_menu` durante a implementação — todos já aceitam números, só `confirmar_titularidade` ficou de fora.

### Fora de escopo

- Não mexer no OCR (rodou ok nesta conversa).
- Não mexer no detect-doc-type (correções da rodada anterior continuam válidas).
- Não criar migration nem alterar schema.
- Não tocar em `portal-worker2`.

Aprova que eu implemente? Sim

&nbsp;

## Auditoria de loops em todos os steps do bot

Varri todos os `case` dos handlers `bot-flow.ts` (evolution + whapi) e cruzei com cada chamada de `sendOptions(...)`. O risco de loop só existe quando o handler envia botões e exige o `id` do botão (ou regex de texto livre) sem aceitar `1`/`2`/`3` — porque o canal Evolution (e o fallback do Whapi) renderiza `sendOptions` como texto numerado (`*1.* Mesma pessoa` + "_Digite o número da opção desejada._").

### Resultado da varredura

| Step | Aceita 1/2/3? | Status |
|---|---|---|
| `confirmando_dados_conta` | ✅ 1=sim · 2=não · 3=editar | OK |
| `confirmando_dados_doc` | ✅ 1=sim · 2=não · 3=editar | OK |
| `confirmar_titularidade` | ✅ (corrigido na rodada anterior) | OK |
| `editing_conta_menu` | ✅ 1–6 + 0 | OK |
| `editing_doc_menu` | ✅ 1–4 + 0 | OK |
| `menu_inicial` / `pos_video` | ✅ por regex `cadastr/humano` + fallback IA livre | OK (não trava) |
| `ask_quero_cadastrar` | ✅ "1" listado em triggers | OK |
| `ask_finalizar` | ✅ "1" listado em triggers | OK |
| `aguardando_humano` | ✅ "2" + regex `cadastr` | OK |
| **`ask_phone_confirm`** | ❌ **`1`/`2` só são aceitos se `isButton===true`** | **LOOP** |
| `validando_otp` / `otp_falhou` / `aguardando_facial` / `cadastro_em_analise` | aceitam só texto livre/código | OK (não usam botões) |

### Bug confirmado — `ask_phone_confirm`

Em `supabase/functions/evolution-webhook/handlers/bot-flow.ts:4488-4493` e no espelho em `whapi-webhook/handlers/bot-flow.ts:4985-4990`:

```ts
const sim    = (isButton && (resp === "sim_phone" || resp === "1")) || (!isButton && /^(sim|s|isso…)\b/.test(resp));
const editar = (isButton && (resp === "editar_phone" || resp === "2")) || (!isButton && /^(n[aã]o|n|editar…)\b/.test(resp));
```

Como `sendOptions` no Evolution sempre cai no caminho de texto numerado (não há suporte nativo a botões), o usuário recebe a pergunta listada como `*1.* Sim · *2.* Outro número` e o sistema injeta "_Digite o número da opção desejada._". Quando ele responde `1` ou `2`, `isButton=false`, e nenhum dos regex casa com dígito → cai no `else` (linhas 4533-4540) e reenvia a mesma pergunta. Mesmo padrão do `confirmar_titularidade` que já corrigimos.

Adicionalmente o fallback de texto (`if (!sent) reply = "Digite *1* …"`) só roda quando `sendOptions` falha — então o lead nunca vê uma instrução clara, só a lista numerada que não funciona.

### Outros pontos analisados e descartados

- `pitch_conexao_club`, `aguardando_conta`, `aguardando_doc_*`, `ask_cpf`, `ask_name`, `ask_cep`, `ask_email`, `ask_distribuidora`, `ask_installation_number`, `ask_bill_value` — todos pedem dado livre (foto/número/texto), sem botões → sem loop.
- O bloco de reset (`RE_INTENT_RESET`, linha 1922) chama `sendOptions` com 3 ids (`entender_desconto`, `cadastrar_agora`, `falar_humano`) e cai em `menu_inicial`. O handler de `menu_inicial` (linha 2942) não trata `entender_desconto`, mas o `else` migra o lead para `qualificacao` com texto livre — degrada para conversa, não trava. Mantenho como está.
- `pitch_conexao_club` (linha 3623) só envia texto, sem botões → OK.

---

## Plano de correção

### 1. Tornar `ask_phone_confirm` numeric-friendly nos dois webhooks

Substituir as duas linhas das flags `sim`/`editar` para aceitar `1`/`2` **independentemente** de ter vindo como botão ou texto:

```ts
const numKey = ({ "1": "sim_phone", "2": "editar_phone" } as const)[resp] ?? resp;
const sim    = numKey === "sim_phone"    || /^(sim|s|isso|isso\s+mesmo|é\s+meu|eh\s+meu|confirmo|pode|certo|correto|positivo)\b/.test(resp);
const editar = numKey === "editar_phone" || /^(n[aã]o|n|editar|outro|outro\s+n[uú]mero|trocar|mudar|errado)\b/.test(resp);
```

Aplicar em `supabase/functions/evolution-webhook/handlers/bot-flow.ts:4487-4493` e `supabase/functions/whapi-webhook/handlers/bot-flow.ts:4985-4990`.

### 2. Garantir prompt numérico explícito no envio

No `else` dos dois handlers (`linhas 4533-4540` evo / `5030-…` whapi), trocar `reply = ""` para sempre incluir o atalho — assim o lead vê "Responda *1* para confirmar, *2* para informar outro número" abaixo da lista, mesmo quando `sendOptions` foi enviado com sucesso:

```ts
reply = "";
// (sem mudança aqui — sendOptions já injeta "Digite o número")
```

A função `sendOptions` (linha 1037) já anexa `_Digite o número da opção desejada._`, então não precisamos duplicar. Só ajustar o fallback de erro (`if (!sent)`) que já está claro.

Conclusão: o item 2 é só conferência — a mudança real é a do item 1.

### 3. Validação

- Buscar leads recentes presos em `ask_phone_confirm` no banco (`SELECT id, phone_whatsapp, updated_at FROM customers WHERE conversation_step = 'ask_phone_confirm' AND updated_at > now() - interval '7 days'`). Se houver, eles vão destravar no próximo `1`/`2` após o deploy.
- Verificar nos logs do `evolution-webhook` após uma interação real: `handler_done step_before=ask_phone_confirm step_after=<próximo>` (hoje fica preso).
- Re-rodar a auditoria: nenhum outro step compartilha o padrão `isButton && resp === "N"`.

### Fora de escopo

- Não tocar em OCR / detect-doc-type / portal-worker.
- Não criar migration nem mudar schema.
- Não mexer no flow custom (Flow Builder) — esse usa `dispatchStepFromFlow` e segue outra lógica.

Aprova?

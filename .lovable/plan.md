
# Diagnóstico — 5511971254913 (ROZANA MAZOCK DIAS)

Este é um **relatório de análise**, não plano de código. Nenhuma alteração é necessária no momento; só sinalizo 1 ponto de atenção no final.

## 1. Qual variante ela seguiu?

**Variante A — Sofia Multicanal (Grupo A / cadastro pós-conta direto).**

- `customers.flow_variant = 'A'`
- `conversation_step = 'aguardando_doc_auto'`
- `origin_channel = 'whapi'`

Ou seja: entrou pelo Whapi, caiu no funil Sofia-A (`a1_→a7_`), passou pela conta e já foi despachada automaticamente para o passo **a7_ask_document** (sem re-explicar economia — que é exatamente o comportamento de `advanceSofiaToDocumentAfterBill` em `bot/sofia-post-bill-routing.ts`).

## 2. Áudio do nome com `!` — vale pra quem não tem nome no banco?

**Sim, vale para todo mundo, sempre que houver nome.** O `!` foi colocado nas duas funções que geram TTS de nome:

- `formatNameGreetForTts()` — usado quando é saudação completa: `"Olá... Fernandinho!"`
- `buildNameOnlyTtsText()` — usado quando é só o nome costurado antes do corpo: `"Fernandinho!"`

Ambas recebem o nome de forma dinâmica (parâmetro), então não depende de estar salvo no banco antes — assim que o nome existir em memória (OCR, digitado, capturado), o TTS renderiza com `!` e o cache de áudio por nome passa a servir todo mundo com aquele nome.

**Ponto de atenção:** o cache já existente (áudios gerados antes do fix, com `.` no final) continua valendo até expirar/regravar. Se quiser forçar re-render agora, dá pra invalidar `voice_name_clips` desses nomes — mas é opcional.

## 3. Por que "não leu o OCR"?

**Leu.** Todos os campos do OCR estão preenchidos no banco:

| Campo | Valor |
|---|---|
| `bill_holder_name` | ROZANA MAZOCK DIAS |
| `name` | ROZANA MAZOCK DIAS |
| `numero_instalacao` | 80886601830 |
| `media_consumo` | 441 kWh |
| `electricity_bill_value` | R$ 484,88 |

**O que confunde:** `ocr_done = false`. Isso é um flag desatualizado — o passo Sofia-A confirma automaticamente via `bill_data_confirmed_at` + `bill_data_confirmation_by = 'auto_sofia'` e não seta `ocr_done`. Não bloqueia o fluxo (o `hasBillData` do `conversation-helpers` já considera `numero_instalacao ≥ 7 dígitos` como válido, então o resume funciona). É cosmético.

## 4. Vai chegar ao Portal + OTP + Facial sem erro?

**Vai, desde que ela complete os próximos passos.** Estado atual e o que falta:

```
✅ a1-a5  identificação + conta OCR                (feito)
✅ a6     confirmação de dados da conta            (auto, auto_sofia)
⏳ a7     documento (RG/CNH/CIN)                   ← ELA ESTÁ AQUI
⏳ a8     confirmar telefone (portal2_celular_alt) 
⏳ a9     submit portal + pedir OTP
⏳ a10    OTP validado (portal-otp-watchdog)
⏳ a11    link facial (Assinar documentos)
```

Faltando no banco: `cpf`, `doc_holder_name`, `portal2_celular_alt`. Isso é normal — vai ser preenchido pelos passos a7/a8.

### Checagens que dão OK para o Portal 2:

- **Telefone**: `phone_whatsapp = 5511971254913` (13 dígitos, DDD 11 válido). `resolvePortalWhatsapp` vai usar esse valor até ela confirmar/trocar em a8. Regressão do caso Osmar não afeta (DDD 11, nada de 12 dígitos ambíguos).
- **Gate IA_REPROVADA_CONTA**: não vai disparar — não é `contaunica` neste lead, e mesmo se fosse, o fix recente pede boleto bancário quando `transferir_titularidade=true`.
- **Gate IA_CONTA_ILEGIVEL**: 4/4 campos presentes (nome, instalação, mês implícito no valor, valor) → passa folgado no `≥2 de 4`.
- **Nome consistency**: `name_mismatch_flag=false`, `bill_holder_name` travado como fonte confiável — quando o RG for lido, o `checkHolderMatch` roda; se bater "Rozana Mazock Dias" no RG, segue direto; se não bater, entra `confirmar_titularidade` (não bloqueia, só ramifica).
- **OTP**: `portal-otp-watchdog` está rodando e saudável (log 15:29 `ok:true`). Assim que o portal disparar o código no WhatsApp da cliente, ela digita, o watchdog valida e o passo a10→a11 (facial) libera automaticamente.

### Risco real neste lead: **nenhum bloqueador técnico.**

O único risco é humano — ela precisa (a) mandar a foto do documento em a7, (b) confirmar o telefone em a8. Se ela abandonar antes disso, o **Motor de Cadência** (que hoje está com toggle OFF nas automações) não vai reengajar.

## Recomendação (opcional, não é código)

Se quiser garantir que essa lead específica não trave por causa do toggle OFF, ligar `cadence_engine` + `process_followups` em `automation_toggles` — mas isso é decisão sua, não faz parte deste diagnóstico.

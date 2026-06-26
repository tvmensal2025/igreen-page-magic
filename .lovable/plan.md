## Problema

Hoje a atribuição de um lead a um parceiro indicador depende **só** da `keyword` do parceiro aparecer no texto da primeira mensagem (`keyword-matcher.ts` → `matchKeyword`). Isso falha silenciosamente em vários cenários reais, e o lead acaba ficando para o consultor (você):

1. O lead **apaga ou edita** a mensagem pré-preenchida do `wa.me` antes de enviar (muito comum).
2. A keyword do parceiro é **genérica** ou colide com outra (ex.: "Maria", "energia") — match volta nulo ou para o parceiro errado.
3. O parceiro foi salvo **sem keyword** (defesa atual cai no `nome`, que pode não aparecer no texto do lead).
4. Você escaneou um QR antigo (sem `short_code`) — o `wa.me` direto não carrega marcador algum.

`partner_igreen_id` salvo no parceiro **só serve para o cashback** (lido em `submit-otp`, `portal-otp-watchdog`, `portal-worker`). Ele **não cria** atribuição — quem cria é o `referral_partner_id` da tabela `customers`, preenchido pelo webhook a partir da keyword. Sem match de keyword, o cashback nunca chega no parceiro.

## Solução

Adicionar um **marcador determinístico** baseado no `short_code` do parceiro na mensagem pré-preenchida do QR, e fazer o webhook resolver a atribuição por esse marcador **antes** de cair no match por keyword. O `short_code` é numérico, único por consultor, neutro (não expõe nome) e já é gerado para todo parceiro novo.

Formato do marcador: `#R{short_code}` (ex.: `#R482917`). Curto, raro o suficiente para não colidir com texto natural, e fácil de detectar com regex.

### Fluxo novo

```text
QR scan → qr-redirect resolve partner → message = frase_padrão + " #R{short_code}"
       ↓
wa.me abre WhatsApp com mensagem pré-preenchida contendo "#R482917"
       ↓
Lead envia (mesmo editando parte do texto, é provável manter o marcador)
       ↓
Webhook: 1) procura /#R(\d+)/ → resolve partner por (consultant_id, short_code)
         2) se não achou marcador, fallback para matchKeyword (legado)
         3) se ainda não achou, lead fica sem partner (como hoje)
```

### Defesas adicionais no formulário do parceiro

- Já exigimos ≥1 keyword. Manter.
- Avisar no UI que a keyword deve ser **única e específica** (ex.: sobrenome + cidade), não palavra comum. Pequena dica abaixo do campo.
- Bloquear keywords claramente genéricas no submit do form: lista curta (`energia`, `desconto`, `luz`, `solar`, `iGreen`, nome do consultor) — erro inline pedindo algo mais específico. Não toca dados existentes.

### O que NÃO muda

- Cashback (`submit-otp`, `portal-worker`) continua lendo `referral_partners.partner_igreen_id` via FK. Sem mexer.
- `matchKeyword` continua existindo como fallback para links antigos sem `short_code`.
- Schema do banco: nenhuma migration necessária. `short_code` já existe em `referral_partners`.

## Arquivos afetados

- `supabase/functions/_shared/qr-phrase.ts` — anexar `#R{short_code}` quando fornecido; respeitar `QR_PHRASE_MAX` (pode estourar levemente se necessário — marcador é prioridade sobre o limite estético).
- `src/components/admin/parceiros/qrPhrase.ts` — espelhar a mesma lógica (front e edge precisam render a mesma mensagem no card e no `wa.me`).
- `src/components/admin/parceiros/PartnerQrCode.tsx` — passar `shortCode` para `resolveQrMessage` no preview e no `buildWaMeUrl` (fallback sem link curto).
- `supabase/functions/qr-redirect/index.ts` — passar `short_code` do parceiro para `resolveQrMessage`.
- `supabase/functions/evolution-webhook/index.ts` e `supabase/functions/whapi-webhook/index.ts` — antes do `matchKeyword`, extrair `#R(\d+)` do `messageText` e, se houver, buscar `referral_partners` por `(consultant_id, short_code, is_active)`. Em match, atualizar `customers.referral_partner_id` (mesmo update existente).
- `src/components/admin/parceiros/PartnerForm.tsx` — bloquear keywords genéricas com erro inline + microcopy sob o campo.
- `src/components/admin/parceiros/__tests__/qrPhrase.test.ts` — caso novo: `resolveQrMessage` inclui `#R...` quando short_code é passado.

## Detalhes técnicos

**Assinatura nova** (compatível, parâmetro opcional):
```ts
resolveQrMessage(qrPhrase, keyword, shortCode?) // shortCode anexa "#R{code}" ao fim
```

**Regex no webhook** (executado antes do `matchKeyword`):
```ts
const m = normalizeText(messageText).match(/#?r\s*0*(\d{3,})/i);
if (m) { /* SELECT referral_partners WHERE consultant_id = ? AND short_code = ? AND is_active */ }
```
Tolerante a `#R 482917`, `R482917`, `#r482917`.

**Comprimento do link**: o marcador adiciona ~10 chars codificados (`%20%23R482917`). A frase padrão atual tem ~50 chars; total continua confortavelmente abaixo do limite prático do `wa.me`.

**Backfill**: nenhum. Parceiros antigos com QR já impresso continuam funcionando pelo caminho legado (keyword no texto). Reimpressões novas já saem com o marcador.

**Telemetria**: logar no console do webhook qual caminho atribuiu (`partner_match_source: "short_code" | "keyword"`) para acompanhar a redução de falhas.

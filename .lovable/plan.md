# Captação automática contínua (mesmo com IA desativada)

## Situação atual

O sistema já tem o extrator multi-campo (`_shared/multi-field-extractor.ts` + `_shared/captureExtractors.ts`) que reconhece, em texto livre PT-BR:

- **Nome** (`extractNome`: "sou X", "me chamo X", "meu nome é X", resposta crua "João Silva")
- **Email** (regex)
- **CEP** (regex 8 dígitos)
- **Valor da conta de luz** (`extractValor`: "R$ 380", "uns 400", "trezentos", número puro 30-50000)
- **CPF / RG / Data nascimento / Telefone fixo**

**Onde já roda hoje (whapi + evolution webhook):**
1. `self-intro` — só nas **2 primeiras mensagens** inbound do lead.
2. `manual-capture-stop` (texto e áudio) — só quando `capture_mode='manual'` **E** o consultor **não tem fluxo A/B/C/D ativo**. Hoje todo cliente tem fluxo D → esse bloco quase nunca executa.

**Resultado prático**: depois da 2ª mensagem, ou quando o fluxo D está ativo, nada extrai mais nada do que o lead escreve. Telefone (do número WhatsApp) e pushName já são capturados, mas nome próprio, email e valor que aparecem no meio da conversa são ignorados.

## O que mudar

### 1. Multi-extract em TODA mensagem inbound (texto e áudio transcrito)

Em `supabase/functions/whapi-webhook/index.ts` (e espelhar em `evolution-webhook/index.ts`):

- Tirar o multi-extract do gate de "primeiras 2 mensagens" e do gate de "sem fluxo ativo".
- Rodar `extractMultiField` + `buildMultiFieldPatch` em **todo inbound de texto não-arquivo**, antes de entregar a mensagem ao fluxo, independente de `capture_mode` ou de fluxo ativo.
- A regra de hierarquia em `buildMultiFieldPatch` continua válida: **só preenche slots vazios** (`!customer.cep`, `!customer.email`, `electricity_bill_value == null`, etc.) — não sobrescreve nada já capturado por OCR, manual ou confirmação explícita.
- Para `name`: manter a regra atual (sobrescreve só `whatsapp_profile`/`unknown`/`freeform_multi`; nunca sobrescreve `manual`/`ocr_*`/`user_confirmed`/`self_introduced`). Promover `name_source` para `self_introduced` quando vier do bloco de self-intro estendido (qualquer inbound nas primeiras N mensagens, não só 2).
- Log estruturado: `[auto-capture] customer=... fields=name,email,electricity_bill_value`.

Isso garante: mesmo com IA desativada, com fluxo D rodando, ou com o consultor conversando manual no chat, qualquer "meu email é joao@x.com" / "minha conta dá 450" é gravado em `customers` na hora.

### 2. Botão "Capturar da conta de luz" no painel lateral

Em `src/components/captacao/CaptureSheet.tsx` (ou `CaptureDocumentTiles.tsx`):

- Adicionar botão **"📸 Capturar da conta"** no tile da conta de energia.
- Comportamento ao clicar:
  1. Procura na timeline do lead a **última imagem/PDF inbound** classificada como conta de luz (`media_kind='bill'` ou heurística). Se não existir, abre `<input type="file">` pra upload manual pelo consultor.
  2. Chama o pipeline OCR já existente (`reprocess-capture` ou função equivalente que dispara o worker portal) passando `customer_id` + `source_message_id`/upload.
  3. Após retorno do OCR, escreve em `customers`:
     - `electricity_bill_photo_url` (anexo na lateral)
     - `electricity_bill_value`, `cep`, `address_*`, `name` (se ainda vazios; respeitando `name_source`)
     - `electricity_bill_photo_source='consultant_button'`
  4. Toast com campos preenchidos e botão pra abrir o `OcrReviewCard` se confiança média.

- O tile da conta passa a mostrar miniatura do anexo quando `electricity_bill_photo_url` existir, com link pra abrir em fullscreen.

### 3. Paridade Evolution

Espelhar mudança 1 em `supabase/functions/evolution-webhook/index.ts` para os blocos análogos (`self-intro`, `manual-capture-stop`, `manual-capture-stop-audio`).

## Detalhes técnicos

**Arquivos a alterar:**

- `supabase/functions/whapi-webhook/index.ts` — mover bloco `extractMultiField` (linhas ~554-580) para rodar em todo inbound de texto, remover gates `isEarly`/`needsTrustedName`/`bypass`; manter no-op se patch vazio.
- `supabase/functions/evolution-webhook/index.ts` — mesma mudança nos blocos equivalentes.
- `supabase/functions/_shared/multi-field-extractor.ts` — sem mudança (já é idempotente).
- `src/components/captacao/CaptureDocumentTiles.tsx` — novo botão "Capturar da conta" no tile bill; integrar com `reprocess-capture`.
- `src/components/captacao/CaptureSheet.tsx` — mostrar miniatura do anexo quando existir.

**Não muda:**

- Schema do banco (`customers` já tem todos os campos).
- Hierarquia de `name_source` (continua protegendo OCR/manual).
- Fluxo D, intent classifier, bot-flow.ts.
- Captura de telefone (já vem do número WhatsApp).

**Idempotência:** `buildMultiFieldPatch` só preenche slots vazios, então rodar a cada inbound não cria sobrescrita nem custa nada quando todos os campos já estão preenchidos.

**Telemetria:** logs `[auto-capture]` em `outbound_message_log` permitem auditar quais campos vieram de conversa livre vs OCR vs manual.

## Fora de escopo

- IA Gemini / Lovable AI (esta captação é 100% regex, roda sem créditos).
- Reabrir leads já cadastrados.
- Mudança no builder de fluxo.
- Captura por áudio (continua via transcrição existente; nenhum trabalho novo de STT).

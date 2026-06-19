## Análise — lead `5511973042020` (customer `f3f83cfe…`, Fluxo D do consultor `0c2711ad…`)

### Conversa real (19/06 BRT)

| Hora | Quem | Mensagem / passo |
|---|---|---|
| 12:41 | Lead | *"Olá o horacio do limpa nome **te recomendou**, para eu economizar."* (frase do QR físico do Horacio) |
| 12:41 | Bot | `d_welcome` |
| 12:42 | Lead | clica **🎥 Como funciona** |
| 12:42 | Bot | `d_como_funciona` (áudio + vídeo + texto) |
| 12:45 | Lead | clica **💬 Tenho uma pergunta** |
| 12:45 | Bot | `d_duvidas`: **"Te, manda sua pergunta aqui..."** ← o "**Te**" do print |
| 12:46 | Lead | clica **✅ Cadastrar agora** |
| 12:46 | Bot | `d_pedir_documento`: **"Show, Te! Agora preciso de mais uma foto... 🪪 RG / 🚗 CNH"** ← pulou o pedido de conta |
| 12:48 | Lead | manda foto (era conta de luz) |
| 12:48 | Bot | "Esse arquivo não parece RG/CNH (parece conta de energia)" |
| 12:49 | Lead | manda outra foto |
| 12:49 | Bot | "Não consegui ler a conta com clareza (qualidade: 0%)" |

`customers.name = 'Te Recomendou'`, `name_source = self_introduced`. Conversation_step ficou em `aguardando_conta`.

## Os 3 bugs

### Bug 1 — Nome "Te Recomendou" extraído da frase
O extrator de nome `self_introduced` pega "...**te recomendou**..." como nome. Por isso o bot chama o lead de **"Te"** em todas as mensagens. Esse mesmo QR físico do Horacio (`wa.me/...?text=Ol%C3%A1%20o%20horacio%20do%20limpa%20nome%20te%20recomendou...`) vai produzir esse bug em **toda** lead nova que escanear.

**Origem provável:** `supabase/functions/_shared/conversion/phrase-catalog.ts` ou o name-extractor do `whapi-webhook`. Precisa adicionar blacklist para os padrões `\bte recomendou\b`, `\bme recomendou\b`, `\bnos recomendou\b`, `\brecomendou\b` (quando seguido/precedido por pronome), e nunca aceitar primeiro nome "Te"/"Me"/"Nos".

### Bug 2 — "Cadastrar agora" pulou o `d_pedir_conta`
Depois do `d_duvidas`, o clique em **"✅ Cadastrar agora"** roteou direto para `d_pedir_documento` (capture_documento, pos 5), **pulando** o `d_pedir_conta` (pos 2) que é onde o fluxo D pede a conta de energia primeiro. O fluxo correto é:

```
d_welcome → d_pedir_conta → d_como_funciona → d_resultado → d_pedir_documento → ...
```

**Origem:** o botão "Cadastrar agora" do `d_duvidas` (ou o router do `d_duvidas`) tem `goto_step_id` apontando direto para `d_pedir_documento`. Precisa apontar para `d_pedir_conta` quando `bill_data_confirmed_at IS NULL`.

### Bug 3 — OCR da conta retornou "qualidade 0%"
Na 2ª foto (já no caminho `aguardando_conta`) o OCR rejeitou com 0%. O `error_message` do registro anterior diz:
```
aguard_conta: isFile=true hasImage=false fileBase64Len=646916 sandbox=false
```
Sugere que o WhatsApp entregou a mídia como `document` (não como `image`), e o pipeline OCR não está convertendo/tratando esse caso bem. Pode ser também só foto ruim — sem ver a imagem é especulativo.

## Plano

### Etapa 1 — Bug 1 (nome "Te"): prioridade alta
- Localizar o name-extractor (`whapi-webhook/handlers/conversational/*` + `_shared/conversion/phrase-catalog.ts`).
- Adicionar blacklist de tokens: `te`, `me`, `nos`, `recomendou`, `recomendado`, `indicou`, `mandou`, e regex que rejeita sequências contendo `(te|me|nos)\s+recomendou`.
- Migração de dados: `UPDATE customers SET name=NULL, name_source=NULL WHERE name ILIKE 'Te Recomendou%' OR name ILIKE 'Me Recomendou%'` (preserva o registro mas força o bot a perguntar o nome ou usar o nome da conta).
- Teste unitário no `phrase-catalog.test.ts` cobrindo a frase exata do QR do Horacio.

### Etapa 2 — Bug 2 (roteamento "Cadastrar agora" → conta antes de doc)
- Auditar o step `d_duvidas` (`bot_flow_steps` do flow `320bf22c…`) e os botões/router que ele despacha.
- Garantir que "Cadastrar agora" siga esta lógica:
  - se `bill_data_confirmed_at IS NULL` → vai para `d_pedir_conta`;
  - se já tem conta confirmada → vai para `d_pedir_documento`.
- Pode ser config (`fallback.goto_step_id` do botão) ou código no handler do `d_duvidas`. Investigar antes de decidir onde corrigir.

### Etapa 3 — Bug 3 (OCR 0% / documento vs imagem)
- Olhar `processando_ocr_conta` e a função que recebe a mídia (`whapi-webhook` → `qr-phrase` ou `ocr-*`).
- Verificar se quando `messageType=document` e `mimetype=image/*` o pipeline está re-encodando como imagem antes de mandar pro OCR.
- Adicionar log estruturado no `engine_logs` com kind=`ocr_quality_low` salvando mimetype, tamanho e primeiro KB do header pra diagnosticar reincidências.

### Etapa 4 — Destravar este lead específico
- `UPDATE customers SET name=NULL, conversation_step='aguardando_conta', ocr_conta_attempts=0, error_message=NULL WHERE id='f3f83cfe-9e3d-48a0-a04d-fcec0cad886c'`.
- Mandar mensagem manual pelo painel: *"Olá! Pra eu te ajudar a economizar na conta de luz, me manda uma foto bem nítida da sua conta de energia (página com o valor total e o número da instalação) 📸"*.

## O que NÃO faço sem confirmação

- Etapa 3 (OCR) só investigar; só mexo no pipeline OCR se confirmarmos que é bug e não foto ruim.
- Não vou mudar o QR do Horacio (já tratado em conversa anterior — vira keyword alias da Nilma).
- Não vou alterar fluxo de outros consultores.

**Confirma se posso seguir com Etapas 1, 2 e 4 agora, e investigar Etapa 3 em paralelo?**

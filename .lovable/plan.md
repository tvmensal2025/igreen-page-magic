# Menu "⋯" no PDF/imagem do chat → anexar à lateral + extrair dados

## O que o usuário quer

Hoje quando um lead manda um PDF (ou foto) no chat, o bubble só mostra "Baixar" / preview iframe. Não tem como mandar aquele documento direto pra coluna da captação (`electricity_bill_photo_url`, `document_front_url`, `document_back_url`) nem pra rodar o OCR sem baixar manualmente e fazer upload de novo no painel lateral.

Solução: adicionar no menu de 3 pontos (⋯) que já existe no MessageBubble novas ações específicas para documentos/imagens:

- **📎 Usar como Conta de Energia**
- **📎 Usar como RG/CNH (Frente)**
- **📎 Usar como RG/CNH (Verso)**
- **🤖 Extrair dados agora** (só aparece se já estiver anexado naquele slot)

Tudo isso já dispara o OCR (`reprocess-capture`) em background, igual ao tile da lateral — então em ~5s os campos (valor, CEP, endereço, nome) aparecem preenchidos no card do lead.

## Como funciona por trás

1. Clica numa ação → `onLoadMedia(message.id)` baixa o blob da mensagem (já existe).
2. Reupload para `whatsapp-media/captacao/{customerId}/{key}-{ts}.{ext}` (mesmo bucket/path do `CaptureDocumentTiles`).
3. `UPDATE customers SET {key}=url WHERE id=customerId` (já existe via onUploaded handler que vou expor).
4. `supabase.functions.invoke("reprocess-capture", { body: { customerId, kind } })`.
5. Toast: "📎 Anexado como Conta de Energia · Extraindo dados…".
6. A lateral (`useCaptureSession`) já escuta updates → recarrega sozinha.

## Arquivos a alterar

| arquivo | mudança |
|---|---|
| `src/components/whatsapp/MessageBubble.tsx` | menu ⋯ ganha grupo "Anexar à captação" quando `mediaType` é `document` ou `image` e há `customerId`; chama nova prop `onAttachToCapture(message, key)` |
| `src/components/whatsapp/ChatView.tsx` | passa `customerId` + handler `onAttachToCapture` ao `MessageBubble`. Handler reaproveita lógica de upload/OCR (extraída para hook). |
| `src/hooks/useCaptureAttach.ts` (novo) | função `attachMediaToCapture({ customerId, blob, ext, key })` que faz upload+update+OCR. Reutilizada pelos tiles da lateral também (refactor leve, opcional). |

Nenhuma migração de banco, nenhum novo edge function, nenhuma mudança em fluxo D / engine / orquestrador IA.

## Fora de escopo

- Drag-and-drop do PDF pra coluna lateral (versão futura).
- Detectar automaticamente "isso é conta" vs "isso é RG" sem o usuário escolher.
- Mexer em mensagens enviadas pelo bot (`fromMe`).

## Validação

1. Lead manda PDF → consultor abre menu ⋯ → "Usar como Conta de Energia" → tile da lateral fica verde com ícone PDF em <2s; em 5-10s campos `electricity_value`, `cep`, `address` preenchidos.
2. Mesma coisa para foto JPG/PNG → tile vira thumbnail.
3. Documento já anexado: menu mostra "🤖 Extrair dados agora" que só roda OCR de novo, sem reupload.

## Objetivo
Trocar a imagem de fundo padrão do gerador de QR Code de parceiros pela nova arte enviada (família comemorando + fatura iGreen com "Economia na Fatura de Energia – Lei Federal 14.300"), aplicando-a automaticamente para todos os parceiros, novos e existentes.

## O que muda

**1. Substituir o arquivo do template padrão**
- O componente `src/components/admin/parceiros/PartnerQrCode.tsx` já aponta para um único caminho fixo:
  ```ts
  const DEFAULT_TEMPLATE = "/images/mutirao-lei-14300-base.jpg";
  ```
- Vou sobrescrever esse arquivo (`public/images/mutirao-lei-14300-base.jpg`) com a nova imagem enviada, convertendo o PNG para JPG (mesma dimensão/proporção da arte, ~1024x1536) para manter o nome e o tipo já usados em todo o app.
- Como o caminho do arquivo continua o mesmo, **todos os parceiros** (atuais e futuros) passam a ver a nova arte automaticamente ao abrir o modal "QR Code — {parceiro}", sem precisar mexer em banco nem em estado salvo.

**2. Nada mais muda**
- O usuário continua podendo enviar uma imagem própria pelo botão "Enviar imagem" e voltar para o padrão com "Usar padrão".
- Posição/tamanho do QR, faixa do rodapé e exportação PNG continuam funcionando igual — só o pixel de fundo muda.

## Detalhes técnicos
- Arquivo trocado: `public/images/mutirao-lei-14300-base.jpg` (mesma chave usada por `DEFAULT_TEMPLATE` em `PartnerQrCode.tsx:30` e desenhada no canvas de export em `PartnerQrCode.tsx:192`).
- Conversão: `convert /mnt/user-uploads/file_00000000b834720e80c1a917ac808d31.png -quality 88 public/images/mutirao-lei-14300-base.jpg` via `nix run nixpkgs#imagemagick`.
- Como o nome do arquivo é o mesmo, navegadores que já têm cache da arte antiga podem mostrar a versão antiga por alguns minutos (hard refresh resolve). Se quiser forçar atualização imediata para todo mundo, posso renomear o arquivo (ex.: `mutirao-lei-14300-base-v2.jpg`) e atualizar a constante — me avise se preferir essa variação.

## Validação
1. Abrir `/admin` → Parceiros → clicar em qualquer parceiro → modal "QR Code" abre já com a nova arte de fundo.
2. Mover o QR e a faixa, depois clicar em "Baixar PNG" — o PNG exportado precisa conter a nova arte.
3. Clicar em "Enviar imagem" para subir uma imagem própria → "Usar padrão" deve voltar para a nova arte.

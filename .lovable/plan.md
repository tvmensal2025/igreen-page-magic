## Por que o banner baixado fica diferente

O preview no modal e o PNG são exatamente o canvas (1069×1920). Já o PDF é gerado em página física **504×940 mm** e a arte é encaixada com `contain` (mantendo proporção, com fundo verde de "letterbox") — só que as proporções não batem:

- Canvas: 1069 / 1920 = **0,5568**
- PDF: 504 / 940 = **0,5362**

Como o `contain` deixa a arte menor para caber sem cortar, sobram **faixas verdes nas laterais (ou topo/rodapé)** no PDF, e o conteúdo aparece levemente reduzido em relação ao preview. O PNG não tem esse problema porque é 1:1 com o canvas.

## Plano (1 ajuste só)

Alinhar a proporção do canvas do banner com a proporção física do PDF para que **preview, PNG e PDF fiquem visualmente idênticos**, sem letterbox.

**Arquivo:** `src/components/admin/PanfletoModal.tsx`

- Trocar as dimensões do canvas do banner para a mesma proporção do PDF 504×940 mm, mantendo resolução alta para impressão:
  - `BANNER_W = 1008` (504 × 2)
  - `BANNER_H = 1880` (940 × 2)
- Nada mais muda: o render usa `BANNER_W/BANNER_H` em todos os cálculos (faixa do rodapé, posição do QR, bloco "APONTE A CÂMERA" em %), então tudo se adapta automaticamente.
- A faixa de licenciado/whatsapp continua com auto-shrink, então o texto não estoura.

## Resultado esperado

- Preview no modal = PNG baixado = PDF baixado (sem barras verdes nas bordas, mesma composição).
- A arte fica pronta pra gráfica no tamanho exato 504×940 mm sem distorção.

Posso aplicar?
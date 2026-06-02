## O que vou fazer

### 1. Travar o tamanho do banner — em **Parceiro** e em **Meu link**

No "Meu link" (PanfletoModal) já corrigi pra `1008×1880` (proporção exata de 504×940 mm).
No "Parceiro" (PartnerQrCode) o banner ainda está em `1069×1920` (proporção 0,5568 ≠ 0,5362 do PDF) — vou ajustar pra ficar igual, sem letterbox e idêntico ao preview.

**Arquivo:** `src/components/admin/parceiros/PartnerQrCode.tsx`

- `TEMPLATE_DIMS.banner`: `canvasW: 1008, canvasH: 1880` (mantém pdfWmm/pdfHmm = 504/940).
- `TEMPLATE_DIMS.a4`: também ajustar para a proporção real de A4 → `canvasW: 1240, canvasH: 1754` (210/297 ≈ 0,707), pra Sulfite também travar 1:1 com o PDF.

Como todos os cálculos de QR, faixa e bloco "APONTE A CÂMERA" usam `% do canvas`, nada mais precisa ser tocado — escala junto.

### 2. Trocar a cor do bloco "APONTE A CÂMERA DO SEU CELULAR AQUI"

Hoje está `#22ff44` (verde neon) + `#ffffff` (branco) sobre a foto/fundo verde — pouco contraste, fica "apagado".

Vou trocar para **amarelo `#ffd700`** nas duas linhas (mesmo amarelo da faixa do rodapé e do título do banner), com contorno preto mais grosso pra garantir legibilidade sobre qualquer fundo. A seta também vira amarela pra ficar coerente.

**Arquivos:**
- `src/components/admin/PanfletoModal.tsx` (função `drawCameraBlock`)
- `src/components/admin/parceiros/PartnerQrCode.tsx` (bloco "5. APONTE A CÂMERA")

Mudanças em cada um:
- `fillStyle "#22ff44"` → `"#ffd700"` (linha 1 e seta)
- `fillStyle "#ffffff"` → `"#ffd700"` (linha 2)
- `lineWidth` do contorno: `* 0.04` → `* 0.08` (contorno preto ~2x mais grosso pra "estampar" sobre a foto)

## Resultado

- Banner sempre 1:1 com o PDF, tanto no card do parceiro quanto no "meu link" — preview = PNG = PDF.
- "APONTE A CÂMERA DO SEU CELULAR AQUI" + seta em amarelo brand com contorno preto firme, bem mais legível.

Posso aplicar?
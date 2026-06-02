# Ajustes Banner — chamada "APONTE A CÂMERA" arrastável + faixa menor

## 1. `PanfletoModal.tsx` (banner do consultor)

### Bloco "APONTE A CÂMERA" — agora arrastável, menor, seta pra baixo

- Trocar o bloco fixo à direita do QR por um bloco posicionável (apenas no formato banner).
- Novo estado `cameraPos = { xPct, yPct }` (default: acima do QR, ~`x:18%`, `y:71%`).
- Render com `useEffect` quando muda formato/estado; em cima do canvas, um `<div>` absoluto arrastável (pointer events) que apenas guia o posicionamento. O texto/seta é desenhado no canvas a partir das coordenadas — preview e PNG/PDF batem.
- Conteúdo final do bloco (sem a 3ª linha "fale comigo agora"):
  - Linha 1: `APONTE A CÂMERA` — 36px peso 900 ouro `#ffd700` (antes 56px)
  - Linha 2: `DO SEU CELULAR AQUI` — 36px peso 900 branco
  - Seta dourada apontando **pra baixo** (triângulo `▼`) centrada abaixo da linha 2, ~30px de altura.
- Bloco pode ser arrastado livremente sobre o banner; seta sempre aponta pra baixo (o usuário posiciona o bloco acima do QR ou de onde quiser).

### Faixa do rodapé (LICENCIADO/WHATSAPP) menor

- Altura: `140px → 70px`.
- Bordas douradas: `6px → 3px`.
- Fonte: `44px → 26px` peso 900.
- Padding lateral: `60px → 40px`.

### QR

- Manter posição/tamanho atuais (`y: 1480`, `size: 310`).

## 2. `PartnerQrCode.tsx` (parceiro)

- Adicionar mesmo bloco "APONTE A CÂMERA" arrastável (válido tanto em A4 quanto em banner do parceiro):
  - Estado novo `cameraPos = { xPct, yPct }` (default acima do QR atual).
  - Handle `pointerdown` adicional ("camera") similar ao QR/footer.
  - No `renderToCanvas`: desenhar as 2 linhas + seta pra baixo nas mesmas coordenadas %.
  - Tamanho proporcional ao canvas: linhas ~`CW * 0.035` px, seta ~`CW * 0.04` de altura.
- Preview: `<div>` absoluto arrastável mostrando o texto e seta (HTML + SVG triangle), igual ao QR/footer.
- Sem "fale comigo agora" — só 2 linhas + seta.

## Fora do escopo

- Formato A4 do `PanfletoModal` (continua igual).
- Imagens base.
- Lógica de QR / wa.me / dados do consultor.

## Verificação

- Abrir modal do consultor no formato Banner: bloco aparece acima do QR, posso arrastar; seta aponta pra baixo; faixa do rodapé bem mais fina e legível.
- Mesma coisa em /admin/parceiros → QR do parceiro: bloco arrastável, seta pra baixo, sem 3ª linha.
- PNG e PDF refletem a posição arrastada.

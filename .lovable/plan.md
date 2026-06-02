## Problema

Hoje os PDFs/PNGs estão saindo no tamanho errado e cortando/esticando a arte:

- **A4** está sendo gerado em **148×222mm** (quase A5) — não é A4 real.
- **Banner** está em 504×940mm mas o `addImage` força a imagem em toda a página, e como a proporção da imagem (1069×1920 = 0.557) não bate exatamente com o PDF (0.536), a arte estica.
- O **QR de parceiro** (`PartnerQrCode`) usa um canvas fixo 1080×1620 (proporção 2:3) e aplica `cover` no fundo do banner, **cortando** a imagem 9:16 do banner em cima e embaixo.

## Solução

Renderizar cada template no **canvas com a proporção exata da imagem original**, depois exportar o PDF no **tamanho físico correto** mantendo a proporção (sem distorção, com letterbox verde escuro caso sobre alguma faixa).

### 1. `src/components/admin/PanfletoModal.tsx`

- **A4**: PDF em **210×297mm** (A4 real). Como a arte é 2:3 (1024×1536) e A4 é ~0.707, ela não cobre 100% da folha — desenhar a arte centralizada respeitando proporção, com fundo verde escuro (`#0d3b1f`) nas faixas laterais/superior-inferior pra ficar print-ready.
- **Banner**: PDF em **504×940mm**. Manter o canvas em 1069×1920 (proporção nativa da arte 0.557). Como 504×940mm = 0.536, calcular `fit-contain` e centralizar (faixas mínimas verdes em cima/baixo) — sem esticar.
- Helper único `drawContain(pdf, imgData, pageW, pageH, imgW, imgH, bgColor)` pra centralizar a imagem na página sem cortar.
- Os overlays (QR + faixa LICENCIADO/WHATSAPP) continuam desenhados sobre o canvas antes da exportação — sem mudança de posição.

### 2. `src/components/admin/parceiros/PartnerQrCode.tsx`

- Tornar `CANVAS_W`/`CANVAS_H` **dependentes do template**:
  - A4: 1024×1536 (proporção 2:3 = `0.667`)
  - Banner: 1069×1920 (proporção 9:16 = `0.557`)
- Atualizar o `PREVIEW` (atualmente 320×480 fixo) pra recalcular altura a partir da proporção do template selecionado, mantendo largura 320 — assim o preview reflete a arte real, sem corte.
- Trocar `cover` por `contain` no draw do background (`Math.min` em vez de `Math.max`) e preencher fundo verde escuro `#0a3d2c` nas faixas residuais.
- Adicionar export PDF além do PNG, usando os mesmos tamanhos físicos do PanfletoModal (210×297mm A4 / 504×940mm Banner) com `drawContain`.

### 3. Sem mudança visual de overlays

Posições padrão de QR/footer continuam em **percentual** do canvas (já são responsivas à proporção). Só o tamanho/proporção do canvas e do PDF mudam.

## Validação

Após a mudança, ao baixar:
- O PDF A4 abre em 210×297mm com a arte inteira visível (com pequena faixa verde superior/inferior ou lateral).
- O PDF banner abre em 504×940mm com a arte inteira visível, sem cortar a família/conta de luz/CTA.
- O preview do PartnerQrCode mostra a arte completa do banner (não cortada nas pontas).

## Fora do escopo

- Não mexer no `LinksTab.tsx` nem no fluxo do `qr-redirect` edge function.
- Não regenerar as imagens base — usar as duas que já estão em `/public/images/`.
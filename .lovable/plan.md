# Travar layout do Banner 504×940mm e corrigir download

## O que muda

No `src/components/admin/parceiros/PartnerQrCode.tsx`, atualizar os defaults travados do template `banner` para bater exatamente com o que aparece no print (sliders mostrados: 87% / 22% / 28% / 99%):

```ts
banner: {
  label: "Banner 504×940mm",
  src: "/images/banner-lei-14300-base.jpg",
  qrX: 22,      // era 20
  qrY: 87,      // já estava
  qrSize: 28,   // era 30
  footerY: 99,  // já estava
},
```

`DEFAULT_LOCKED.banner` continua `true` — abre travado nessa posição. Quem quiser mexer continua podendo destravar.

## Garantir que o download sai igual ao preview (sem cortes laterais)

O preview usa `background-size: cover` (320 × 575 px, ratio 0.557). O canvas de export é `1008 × 1808` (mesmo ratio 0.557) com `drawImageCover`. PDF é `504 × 904 mm` (mesmo ratio). Como os três usam a mesma proporção e o mesmo "cover", o download já sai 1:1 com o preview.

Para blindar contra qualquer drift futuro:

1. No `handleDownloadPDF`, remover o cálculo de `scale/dx/dy` (que existe só "por segurança" e nunca dispara hoje) e desenhar a imagem ocupando o PDF inteiro: `pdf.addImage(imgData, "JPEG", 0, 0, wmm, hmm)`. Isso garante que nada fica com margem branca/preta nas laterais mesmo se o canvas vier com 1px de diferença por arredondamento.
2. Trocar `toDataURL("image/jpeg", 0.95)` por `toDataURL("image/png")` no PDF — JPEG nessa qualidade pode introduzir artefato no QR (que é binário). PNG mantém o QR cristalino e ainda preserva 100% do visual do preview.

Nenhuma outra parte do componente, nem o resto do app, é tocada.

## Verificação

- Abrir o modal QR Code de um parceiro → escolher "Banner 504×940mm" → conferir que aparece travado com QR no canto inferior esquerdo sobre a família e faixa amarela no rodapé, idêntico ao print.
- Clicar "Baixar PDF (504×904mm)" → abrir o PDF → conferir que o conteúdo enche a página inteira, sem margem branca lateral, com QR e faixa exatamente nas mesmas posições do preview.
- Clicar "Baixar PNG" → mesma checagem (1008×1808, sem cortes).

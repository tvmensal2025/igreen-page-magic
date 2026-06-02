# Ajustes no Banner 504×940mm

## Problemas

1. Faixa verde do rodapé (LICENCIADO / WHATSAPP) está com altura/tipografia desproporcional para um banner de quase 1 metro de altura — fica fina demais e o texto pequeno.
2. Falta uma chamada de ação clara perto do QR Code instruindo a pessoa a apontar a câmera (hoje só tem "APONTE A CÂMERA" em verde-limão minúsculo acima do QR, pouco visível no banner físico).

## O que vai mudar (apenas no `renderBanner` em `src/components/admin/PanfletoModal.tsx`)

### 1. Faixa do rodapé proporcional ao banner

- Altura da faixa: de **70px → 140px** (canvas 1920px de altura → ~7% da arte, equivalente a ~66mm impressos, legível a 2-3m de distância).
- Bordas douradas: de 3px → 6px (proporção mantida).
- Fonte LICENCIADO/WHATSAPP: de **22px → 44px peso 900**, padding lateral 60px.
- Padding vertical interno para o texto não colar nas bordas douradas.

### 2. Frase estratégica ao lado do QR

Substituir o pequeno "APONTE A CÂMERA" atual por um bloco de chamada à direita do QR (o QR fica na esquerda inferior, sobra espaço à direita até a faixa).

Layout do bloco de chamada (à direita do QR, alinhado verticalmente ao centro do QR):

```text
   [ QR ]   APONTE A CÂMERA
            DO SEU CELULAR AQUI
             ↙ (seta apontando pro QR)
```

- Linha 1: `APONTE A CÂMERA` — 56px, peso 900, amarelo ouro `#ffd700`
- Linha 2: `DO SEU CELULAR AQUI` — 56px, peso 900, branco
- Seta/triângulo dourado apontando do texto para o QR (desenhada via `ctx.beginPath`)

Posição: começa em `x = QR.x + QR.size + 40`, centralizada verticalmente em relação ao QR.

### 3. Pequenos ajustes de respiro

- Subir o QR um pouco (`y: 1545 → 1480`) para liberar espaço da faixa maior do rodapé.
- Aumentar a moldura branca do QR de 6px → 12px para destacar mais.

## Fora do escopo

- Formato A4 (continua como está).
- `PartnerQrCode.tsx` (mesma frase pode ser portada depois, se você quiser — me avise).
- Imagem base do banner.

## Verificação

Após implementar, abrir o modal em /admin no formato Banner e conferir visualmente: faixa do rodapé legível, frase chamativa ao lado do QR, nada cortado.
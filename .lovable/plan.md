## Problema

Ao usar o suporte remoto, o operador não consegue interagir com as bordas da tela do consultor — topo, esquerda, direita e inferior ficam "mortos". Causas identificadas:

**1. Letterbox do `object-contain` (principal)**
`src/pages/SuperAdminRemoteSupport.tsx` L836‑845 renderiza o `<video>` com `w-full h-full object-contain` dentro de um container preto. Quando a proporção do container ≠ proporção do vídeo capturado, o vídeo é centralizado com **faixas pretas em volta** (letterbox). O overlay de controle (`absolute inset-0`) cobre também essas faixas, mas `toNorm` (L1488‑1523) retorna `null` para qualquer ponto fora de `dispW×dispH`, ignorando cliques/movimentos → sensação de "borda cortada" nos 4 lados.

**2. Banner do consultor cobre o topo real da página**
`src/features/remote-support/ActiveSessionBanner.tsx` L83 monta um banner `fixed top-0 inset-x-0 z-[9999]` com `data-remote-support-banner`. Esse selector está em `PROTECTED_SELECTOR` (`actionHandler.ts` L21), então qualquer coordenada que caia sobre a faixa do banner é bloqueada — mesmo depois de resolver o letterbox, o operador continua "sem topo" porque o topo do vídeo É o banner. Além disso o banner empurra o conteúdo real da página para baixo (o body não tem `padding-top`), então parte inferior da página some do viewport enquanto o banner está aberto.

**3. `toNorm` descarta as bordas exatas**
`if (px < 0 || py < 0 || px > dispW || py > dispH) return null;` — em arredondamentos de `getBoundingClientRect` a última coluna/linha de pixels vira `null`, causando micro‑cortes nas bordas mesmo sem letterbox.

## O que fazer

### A. Eliminar letterbox no operador
`src/pages/SuperAdminRemoteSupport.tsx`
- Passar do container preto `object-contain` para um container que **assume a proporção real do consultor**: aplicar `style={{ aspectRatio: requesterVp ? `${requesterVp.innerWidth} / ${requesterVp.innerHeight}` : undefined }}` no `containerRef` e trocar `object-contain` por `object-fill` no `<video>`. Como o vídeo é a captura fiel da aba do consultor, `object-fill` no container com a proporção correta = 1:1 sem distorção e sem faixas.
- No modo fullscreen, envolver o container em um wrapper flex `items-center justify-center` para o container manter a proporção sem esticar em telas com aspect diferente (mantém máximo `max-h-full max-w-full`).
- Em `RemoteControlOverlay.toNorm` (L1488‑1523): remover a lógica de letterbox (offsetX/offsetY/dispW/dispH) e passar a normalizar direto contra `rect.width`/`rect.height`, clampando `normX`/`normY` em `[0,1]` (sem retornar `null` para pontos "fora"). Isso garante que a borda extrema clicável funcione.

### B. Remover a "faixa morta" do topo no consultor
`src/features/remote-support/ActiveSessionBanner.tsx` + `RemoteSupportProvider.tsx`
- Enquanto a sessão está `active` e `sharing=true`, colapsar o banner para uma barra fina (≈24px) com apenas o status + botões Pausar/Encerrar. Isso reduz a área bloqueada no topo do vídeo capturado.
- Publicar a altura atual do banner numa CSS var (`--remote-support-banner-h`) e aplicar `padding-top` correspondente no `<body>` (ou no root do app) só enquanto o banner existe, para que nenhum conteúdo real da página fique escondido embaixo do banner (o operador deixa de perder a parte inferior).
- Manter `data-remote-support-banner` (segurança: operador não consegue clicar no banner do próprio consultor), mas com footprint mínimo.

### C. Sanitizar bordas em `toNorm`
`src/pages/SuperAdminRemoteSupport.tsx` (dentro do RemoteControlOverlay)
- Substituir o `return null` por `clamp(0,1)` para `normX/normY`, garantindo que cliques em `y=0`, `y=rect.height`, `x=0`, `x=rect.width` sejam entregues como coordenadas 0 ou 1 (o consultor mapeia para pixels válidos).

### D. Sanity check
- Após as mudanças, rodar a sessão e conferir com o cursor virtual que ele acompanha o mouse até as 4 bordas do container e que cliques em `top:0`, `bottom:0`, `left:0`, `right:0` disparam ações reais.

## Arquivos afetados

- `src/pages/SuperAdminRemoteSupport.tsx` — container do vídeo (aspect ratio + object-fill), `toNorm` (sem letterbox, com clamp)
- `src/features/remote-support/ActiveSessionBanner.tsx` — variante colapsada durante `sharing`
- `src/features/remote-support/RemoteSupportProvider.tsx` — expor CSS var + `padding-top` no root enquanto banner ativo

Sem mudanças no `actionHandler.ts` nem em API/DB — é 100% ajuste de UI/mapeamento.

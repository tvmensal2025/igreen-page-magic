## Diagnóstico

A imagem HD do telhado é montada 100% no servidor (`supabase/functions/_shared/solar/data-layers.ts`, chamada por `solar-roof-hd`). Hoje os módulos ficam "tortos/errados" porque:

1. **Sem rotação**: `drawPanel(...rot=0)` (linha 338). O código foi propositalmente zerado ("girar pelo azimute deixava tortos") — o problema não era girar, era girar com o ângulo errado e sem compensar a distorção Mercator (px/m diferente em X e Y).
2. **Dimensões trocadas por orientação** em `extractPanelPositions` (economics-br.ts 318-319): `PORTRAIT` deveria ter `widthM = panelW (1.045)` e `heightM = panelH (1.879)`; hoje o `widthM` sempre recebe o maior lado quando LANDSCAPE, invertendo a proporção.
3. **Escalas anisotrópicas**: `pxPerMx` (lng) ≠ `pxPerMy` (lat) numa mesma latitude. Ao girar um retângulo, precisa usar uma escala única (m→px) senão ele fica trapezoidal.
4. **Estética "amadora"**: borda ciano grossa, sem gap entre módulos, sem sombra, heatmap por cima dos próprios módulos, sem vinheta — bem longe do padrão Reonic (módulos escuros uniformes, borda fina, gap regular, heatmap só na área livre).

Referência Reonic: painéis desenhados por segmento de telhado, alinhados à borda do segmento, mesma orientação por segmento, tom azul-marinho uniforme, borda hairline, leve espaçamento.

## Fase A — Alinhamento correto dos módulos (imagem HD)

Arquivo: `supabase/functions/_shared/solar/data-layers.ts` + `economics-br.ts`.

1. Corrigir `extractPanelPositions` (economics-br.ts):
   - `widthM  = orientation === "PORTRAIT" ? panelW : panelH` → **trocar**: PORTRAIT usa `panelW` como largura, `panelH` como altura; LANDSCAPE inverte. Garantir consistência com a rotação (o eixo "altura" do módulo aponta na direção do azimute do segmento).

2. Reintroduzir rotação por segmento em `composeHdRoofPng` / `drawPanel`:
   - Converter `azimuthDegrees` (bússola Google, 0=N, sentido horário) para radianos de tela: `rot = ((azimuth - 180) * Math.PI) / 180` para módulos apontando "para fora" do telhado com norte para cima na imagem.
   - Usar escala **isotrópica** para o desenho do módulo: `pxPerM = (pxPerMx + pxPerMy) / 2`. Manter posição do centro (cx, cy) com `pxPerMx / pxPerMy` (que já dão o ponto correto), mas `halfW`/`halfH` usam `pxPerM`.
   - `drawPanel` já suporta rotação; apenas passar `rot` corrigido.

3. Anti-aliasing simples nas bordas do módulo: quando `|lx|` ou `|ly|` cair dentro de uma faixa de 0.5 px do limite, aplicar alpha proporcional (cobertura) para eliminar serrilhado.

## Fase B — Acabamento visual "Reonic-like"

Ainda em `data-layers.ts` (`composeHdRoofPng` / `drawPanel` / `buildHdRoof`).

1. Paleta do módulo:
   - `fill = [11, 18, 32]` (azul-marinho quase preto).
   - `border = [30, 41, 59]` hairline (1 px, sem ciano).
   - Sombra: antes de pintar o módulo, escurecer um retângulo offset (+1, +1) em 25% de alpha.
2. Gap real entre módulos: reduzir `halfW`/`halfH` em ~4% (`* 0.96`) para simular a moldura de instalação.
3. Heatmap só onde **não há módulo**: manter um `panelMask` binário (buffer `Uint8Array` do tamanho da imagem) preenchido enquanto desenhamos os módulos; no loop de heatmap, aplicar cor da paleta apenas se `panelMask[i] === 0 && mask.values > 0.5`. Reduzir `fluxOpacity` default para `0.22`.
4. Vinheta sutil no PNG: multiplicar RGB por `1 - 0.15 * r²` (r = distância radial normalizada) para focar visualmente no telhado.
5. Manter cache existente (`hd_image_path`) — invalidar automaticamente para análises novas; nas antigas, o próximo pedido regenera se o campo `hd_bounds` estiver nulo.

## Fase C — Frontend (apenas legenda/observabilidade)

Arquivo: `src/features/solar-3d/components/SolarRealRoofView.tsx`.

1. Ao carregar o HD, trocar a legenda para: "Foto aérea · módulos alinhados ao telhado".
2. Nenhuma outra mudança visual/estrutural (não mexer no overlay div do satélite, que continua servindo como base rápida).

## Diagrama do pipeline HD (após mudanças)

```text
Solar API DataLayers
   ├── rgbUrl (foto aérea)  ──► base
   ├── maskUrl (telhado)     ──► restringe heatmap
   └── annualFluxUrl        ──► heatmap só em (mask ∧ ¬panelMask)
Building Insights
   └── solarPanels[]  ──► extractPanelPositions
                             (dimensões corretas + azimute segmento)
                                     │
composeHdRoofPng ────────────────────┤
   1. desenha base RGB                │
   2. sombra + módulos rotacionados   │  ← preenche panelMask
   3. heatmap fora dos módulos        │
   4. vinheta suave
```

## Fora do escopo

- Cálculos econômicos, banco, RLS, catálogo de produtos.
- Overlay de módulos por `<div>` sobre a imagem de satélite (usado só como base rápida enquanto o HD é gerado).
- 3D no Three.js (`SolarRoofViewer3DInner`) — este plano trata apenas da imagem HD (que é o que o cliente vê no PDF/modal).
- Cross-sell/telecom/seguros.

## Detalhes técnicos

- `drawPanel` passa a receber `pxPerM` isotrópico e `azimuthRad`; assinatura muda para `(out, w, h, cx, cy, halfW, halfH, rot, panelMask?)`.
- `panelMask` é `Uint8Array(w*h)` alocado uma vez em `composeHdRoofPng`.
- Anti-aliasing: dentro de `drawPanel`, calcular `coverage = clamp((halfW - |lx| + 0.5), 0, 1) * clamp((halfH - |ly| + 0.5), 0, 1)` e usar como alpha do blend.
- Regeneração forçada opcional: aceitar `body.force === true` em `solar-roof-hd` para reprocessar mesmo com `hd_image_path` já salvo — permite testar sem apagar registros.

## Aceite

- Módulos visualmente paralelos às bordas do segmento de telhado (rotação correta), sem ficarem "trapezoidais".
- Sem borda ciano; tom azul-marinho uniforme com hairline mais escura e leve sombra.
- Heatmap só aparece entre e ao redor dos módulos, nunca por cima deles.
- Imagem final visivelmente próxima da referência Reonic em qualidade percebida.

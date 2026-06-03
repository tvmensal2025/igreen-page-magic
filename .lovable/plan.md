# Permitir que o score chegue a ≥70 e desbloquear publicação

## Diagnóstico
Dois problemas, não um:

**1. Score "trava" mesmo depois de aplicar a sugestão da IA.**
Em `src/lib/adQualityScore.ts`:
- O score final é `copy*0.6 + image*0.4`.
- O score de imagem tem 4 checks. Dois deles são quase impossíveis de passar com foto real:
  - `textRatio < 0.18` (densidade de bordas via Sobel) — qualquer foto de placa/painel/conta de luz com detalhes finos cai como "muito texto".
  - `contrast >= 35` — fotos em hora dourada/sombra falham.
- Resultado: imagem fica em 50/100 e puxa o total pra ~65 mesmo com copy 100/100. Por isso o usuário "ajustou tudo" e continuou abaixo de 70.

**2. Mesmo quando o score sobe, o gate é binário e arbitrário.**
`CreateCampaignWizard.tsx:480` bloqueia avançar com `score < 70`. Não há override. O que **de fato** rejeita anúncio na Meta são os termos proibidos (`severity: "block"`).

## Mudanças

### 1. `src/lib/adQualityScore.ts` — calibrar score de imagem
- `textRatio`: limite de 0.18 → **0.28** (fotos reais com detalhe passam; só bloqueia thumb cheia de texto).
- `contrast`: limite de 35 → **25**.
- Adicionar bônus de +10 quando dimensão está acima do mínimo em 1.5× (premia foto grande).
- `canPublish`: passar a depender **só** de `blocks === 0` (sem piso de 70). Manter `score` e `level` pra UI.
- Adicionar campo novo `recommendedPublish = score >= 70` pra UI continuar sinalizando "ideal".

### 2. `src/components/admin/ads/CreateCampaignWizard.tsx` (≈ 478-488)
Trocar o bloqueio duro por confirmação:
- Se houver `block` de política → mantém toast vermelho e trava (anúncio seria rejeitado pela Meta).
- Se `score < 70` sem block → abrir `AlertDialog`: "Score X/100 abaixo do ideal de 70 — pode aumentar o CPL. Publicar mesmo assim?" com botões **Voltar a ajustar** / **Publicar mesmo assim**. Confirmar avança pro step 4.
- Se `score >= 70` → avança direto.

### 3. `src/components/admin/ads/AdQualityPanel.tsx`
- Ajustar `summary` amarelo: "Funciona, mas dá pra melhorar — dá pra publicar assim".
- Mostrar dica curta quando `image.score < 70` apontando que foto real com bastante detalhe pode ser sinalizada como "muito texto" (false positive comum).

## Fora de escopo
- Não mexo no gerador de copy da IA, templates, edge functions, banco, ou fluxo do bot.
- Não removo o painel de qualidade — só recalibro limites e tiro o gate duro.

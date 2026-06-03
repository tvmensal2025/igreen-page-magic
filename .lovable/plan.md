# Score de qualidade quando o anúncio é vídeo

## Diagnóstico
No modo vídeo, o `AdQualityPanel` recebe `primaryImage={null}` (porque `filesByFormat` só é populado pra foto). Em `adQualityScore.ts`, quando `primaryImage` é nulo, o componente passa um placeholder `{ score: 0, checks: [{ ok: false, label: "Nenhuma foto enviada" }] }` pro `image`, e o agregado vira `copy*0.6 + 0*0.4` — mesmo copy 100/100 fica em 60 e dispara o diálogo de "abaixo do ideal" sem motivo.

## Mudanças

### 1. `src/lib/adQualityScore.ts`
- Adicionar função `scoreVideo({ width, height, duration })` com checks:
  - dimensão vertical (≥1080×1920 ideal, ≥720×1280 mínimo)
  - aspect ratio 9:16 (±5%)
  - duração 6-60s (sweet spot Reels/Stories)
- Retorna mesma forma de `{ score, checks }` que `scoreImage`.

### 2. `src/components/admin/ads/AdQualityPanel.tsx`
- Novo prop opcional `primaryVideo?: { w: number; h: number; duration: number }`.
- Se `primaryVideo` presente, usar `scoreVideo` no lugar de `scoreImage` e renderizar a seção com o título **"Vídeo"** em vez de "Imagem". Mantém o resto (copy + agregado) idêntico.

### 3. `src/components/admin/ads/CreateCampaignWizard.tsx` (≈ linha 1314)
- Passar `primaryVideo={creativeMode === "video" && videoMeta ? { w: videoMeta.w, h: videoMeta.h, duration: videoMeta.duration } : undefined}`.
- Quando vídeo, não passa `primaryImage`.

## Fora de escopo
- Não mexo no upload/validação de vídeo na edge function.
- Não mexo no gerador de copy nem nas regras de política.

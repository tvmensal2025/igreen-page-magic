## Plano revisado — validado contra a documentação oficial da Meta

Fiz a checagem cruzada com os docs da Meta antes de mexer em qualquer coisa. **Um dos pontos do plano anterior estava errado** e teria causado exatamente o problema que a gente quer evitar (perda de performance por desligar Advantage+). Segue o plano correto, com citação da fonte para cada decisão.

---

### Correção 1: idade 28+ NÃO exige desligar Advantage+

**Documentação Meta** — [Advantage+ audience](https://developers.facebook.com/docs/marketing-api/audiences/reference/targeting-expansion/advantage-audience/):

> "Non-negotiable business constraints are NOT expanded, these include location constraints, **minimum age**, language, and custom audience exclusions."

Ou seja: **a idade mínima é uma restrição inegociável que o Advantage+ respeita por definição.** Você pode ter `age_min: 28` E `advantage_audience: 1` simultaneamente — a Meta não expande abaixo dos 28.

O código atual (`Math.min(body.age_min ?? 25, 25)`) e o comentário `"Advantage+ audience exige age_min <= 25"` estão **desatualizados** — provavelmente referem-se a Advantage+ Shopping Campaign (feature diferente) ou a um comportamento antigo pré-v23. Na v23+ (que é a versão do código, `graph.facebook.com/v23.0`), o docs diz explicitamente o contrário.

**Ação:** manter Advantage+ ligado e simplesmente subir a idade. Sem lógica condicional. É o cenário ideal — melhor entrega + público controlado.

---

### Correção 2: v23.0 mudou o default do Advantage+

**Documentação Meta** — [Changes to Advantage+ audience behaviours, jun/2025](https://developers.facebook.com/blog/post/2025/06/13/marketing-api-changes-to-advantage-plus-audience-behaviors/):

> "Prior to API version V23.0, the `advantage_audience` parameter within `targeting_automation` was optional […] As of v23.0, [it] defaults to 1 (opt-in) unless you explicitly set to 0."

O código já força `= 1` explicitamente, então isso já está certo. Só precisamos garantir que continue sendo enviado — não remover.

---

### Correção 3: crop de vídeo — a solução certa é Placement Asset Customization

**Documentação Meta** — [Aspect ratios supported by placements](https://www.facebook.com/business/help/682655495435254) e [Crop media for a video ad](https://www.facebook.com/business/help/268849943715692):

Cada placement tem seu aspect ratio ideal:
- Feed FB/IG: **1:1** (quadrado) ou 4:5
- Reels FB/IG, Stories FB/IG: **9:16** (vertical full-screen)
- In-stream FB: 16:9 (horizontal)
- **Instagram Explore será removido em jan/2026** — remover do código já.

Um único vídeo 9:16 em placement de feed quadrado = crop no topo/rodapé. Um vídeo quadrado em Reels = tarjas pretas ou zoom-crop.

Duas alternativas válidas segundo os docs:

**Opção A (simples, é o que vou fazer):** limitar placements ao aspect ratio do vídeo que você sobe. Como seus vídeos são 9:16 (viu-se no print: gravado em modo retrato), restringir para Reels + Stories em ambas as plataformas. Corta ~30% do alcance potencial mas **elimina crop 100%**.

**Opção B (ideal, fica para segunda fase):** [Placement Asset Customization](https://developers.facebook.com/docs/marketing-api/dynamic-creative/placement-asset-customization/) — subir 2 versões do vídeo (1 quadrado + 1 vertical) e mapear cada uma pro seu placement. Exige mudança no wizard (upload de duas versões) e um `asset_feed_spec` mais complexo. Não vou tocar nisso agora, mas deixo o link para quando você quiser expandir alcance sem crop.

---

### Correção 4: thumbnail do vídeo (`image_url`)

**Documentação Meta** — [Ad Creative Video Data](https://developers.facebook.com/docs/marketing-api/reference/ad-creative-video-data/):

O campo `image_url` no `video_data` **precisa ser uma imagem no mesmo aspect ratio do vídeo**. Se você manda uma thumb quadrada num vídeo 9:16, o Facebook croca a thumb (não o vídeo) — e é isso que aparece no feed antes do play e no card do Ads Manager (bate com seu print, onde a foto da mulher aparece cortada).

**Ação:** quando o vídeo é 9:16 (Reels/Stories only), **omitir `image_url`**. A Meta gera automaticamente a thumb do frame do vídeo no aspect certo. Só enviar `image_url` se um dia usarmos placements mistos e a thumb já vier cortada corretamente.

---

### Correção 5: "falando da página"

Isso é o **nome da Página do Facebook conectada** (`page_id` na `object_story_spec`). No seu caso mostra "Instituto dos Sonhos". O anúncio NÃO permite override do nome via API — quem define é a Página.

Duas ações possíveis:
1. **Fora do escopo desta correção:** trocar a Página conectada por uma com nome que combine com iGreen (você faz isso no `/admin` → conexões → Facebook).
2. **No escopo:** cortar `headline` para 27 caracteres no modo vídeo. Os docs de Reels Ads mostram que Reels corta headline em ~40 chars e o "primary_text" também some depois de 125. Vou aplicar limites conservadores para não aparecer texto truncado feio.

---

## Plano de implementação (mínimo, cirúrgico)

**Arquivo único:** `supabase/functions/facebook-create-campaign/index.ts`

1. **Idade default 28+**, mantendo Advantage+ ligado (docs confirmam compatibilidade):
   - Remover os 3 `Math.min(body.age_min ?? 25, 25)` (linhas 384, 454, 550).
   - Trocar por `body.age_min ?? 28`.
   - Manter `targeting_automation: { advantage_audience: 1 }` em ambos os lugares — sem condicional.
   - Remover o comentário desatualizado "Advantage+ audience exige age_min <= 25" e substituir por link do docs oficial.

2. **Placements do vídeo** (assumindo vídeos 9:16, que é o padrão do wizard):
   - Trocar `facebook_positions` de `["feed", "facebook_reels", "story"]` para `["facebook_reels", "story"]`.
   - Trocar `instagram_positions` de `["stream", "reels", "story", "explore"]` para `["reels", "story"]` (remove `stream` que é horizontal e `explore` que a Meta descontinua em jan/2026).
   - Manter `publisher_platforms: ["facebook", "instagram"]`.

3. **Thumbnail do vídeo:**
   - Remover a linha `if (thumbUrl) (videoData as any).image_url = thumbUrl;` (linha 824).
   - Deixar a Meta usar `thumbnail_url` gerado do próprio vídeo — respeita aspect ratio nativamente.

4. **Headline no modo vídeo:**
   - `title: body.headline.slice(0, 27)` no `videoData` (linha 820).

5. **Log de auditoria** antes do POST do adcreative de vídeo:
   ```ts
   console.log("[fb-create] video ad: age_min=", ageMin, "advantage=1, positions=", targeting.facebook_positions, targeting.instagram_positions);
   ```

**O que NÃO muda:**
- Modo foto (`asset_feed_spec`) — segue como está, ele já usa 3 formatos (square/vertical/story) e Meta escolhe por placement.
- Wizard/frontend — a regra "28+" vira default silencioso da plataforma. Se um dia quiser expor no wizard, é outra tarefa.
- Estrutura do `object_story_spec`, upload do vídeo, cache `ad_video_library`, captions SRT — nada disso é tocado.

**Riscos e mitigação:**
- Alcance do vídeo cai ~25-35% (Reels+Stories only vs feed+stream+explore). **Aceitável**: o que somem é feed quadrado com vídeo 9:16 cortado (impressão inútil) e placements horizontais (in-stream) que também cortavam. Está trocando lixo por qualidade.
- CPM pode subir 5-15% em Reels/Stories (placements premium). Compensa com melhor qualidade do lead 28+.
- Se algum dia subir vídeo 1:1, este código vai colocá-lo com tarjas nos Reels. Mitigação para segunda fase: detectar aspect ratio no upload (`ffprobe` no compress-worker) e escolher placements dinamicamente.

**Como validar depois do deploy:**
1. Publicar 1 campanha teste em modo vídeo.
2. No Ads Manager conferir:
   - Idade: 28-65 ✅
   - Vantagem+ público: ligado ✅
   - Prévias: só Facebook Reels, FB Stories, IG Reels, IG Stories, todas full-screen sem crop ✅
   - Thumbnail no card mostra o frame do vídeo, não uma foto cortada ✅
3. Se aparecer erro subcode 1870188/1870189 ou "targeting_relaxation": deixamos rollback pronto revertendo os 3 pontos do item 1.

**Referências consultadas:**
- [Advantage+ audience — non-negotiable constraints](https://developers.facebook.com/docs/marketing-api/audiences/reference/targeting-expansion/advantage-audience/)
- [Marketing API v23.0 Advantage+ audience default change](https://developers.facebook.com/blog/post/2025/06/13/marketing-api-changes-to-advantage-plus-audience-behaviors/)
- [Aspect ratios by placement + descontinuação do Explore em jan/2026](https://www.facebook.com/business/help/682655495435254)
- [Ad Creative Video Data (image_url + thumbnail_url)](https://developers.facebook.com/docs/marketing-api/reference/ad-creative-video-data/)
- [Reels Ads spec](https://developers.facebook.com/docs/marketing-api/creative/reels-ads)
- [Placement Asset Customization (opção B, futura)](https://developers.facebook.com/docs/marketing-api/dynamic-creative/placement-asset-customization/)

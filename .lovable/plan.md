## Auditoria — Vídeo Reels, Raio por endereço e Modo Econômico

Auditei cada peça da implantação. **Build TypeScript passa limpo** (`tsc --noEmit` sem erros), a migração está correta (tabela `ad_video_library` com GRANTs + RLS + índice único), e o bucket `consultant-photos` é público e aceita vídeos. Identifiquei **3 bugs reais** (corrigir antes de testar em produção) e **5 pontos de polimento** (não bloqueiam, mas vale fechar).

---

### A. Bugs reais a corrigir

**A1. Polling de status do vídeo na Meta tem lógica frágil** (`facebook-create-campaign/index.ts:488`)
```ts
const phase = st?.status?.video_status || st?.status?.processing_progress != null ? st?.status?.video_status : null;
```
Por precedência vira `(video_status || processing_progress != null) ? video_status : null` — funciona por acidente. Substituir por leitura direta:
```ts
const phase = st?.status?.video_status as string | undefined;
if (phase === "ready") { ready = true; break; }
if (phase === "error") throw new Error(`Vídeo rejeitado: ${st?.status?.error?.message || "erro"}`);
```

**A2. Limite de upload do vídeo: UI diz 100 MB, Supabase Storage default é 50 MB**
A UI valida `f.size > 100 * 1024 * 1024`, mas o cliente JS do Supabase aceita até 50 MB por padrão e o bucket `consultant-photos` está com `file_size_limit = NULL` (sem limite explícito, cai no default global). Vídeos entre 50–100 MB vão dar erro silencioso de upload. Duas opções:
- Reduzir o limite da UI pra 50 MB (mais simples), **ou**
- Subir o limite do bucket para 100 MB via migration (`UPDATE storage.buckets SET file_size_limit = 104857600 WHERE id = 'consultant-photos'`).
Recomendo o segundo (corresponde à mensagem mostrada ao consultor).

**A3. `cities` no banco fica vazio em modo raio** (`facebook-create-campaign/index.ts:815`)
```ts
cities: body.cities || [],
```
Em modo raio o array vem `[]` e o dashboard local perde o rastro de geo. Salvar também os pontos de raio em uma coluna nova (ou serializar dentro de `cities` como `[{ key: 'radius:...', name: 'Rua X +3km' }]`). Sem isso, listagens de campanha ficam sem identificar geo.

---

### B. Polimento (não bloqueia publicação, mas melhora)

**B1. Step 3 (copy) usa `cities.map()` — fica vazio em modo raio**
`generateCopyForCities()` monta a lista a partir de `cities`. Em modo raio passar `radiusPoints[0].address_string` ou `name` para a IA gerar copy contextual.

**B2. Step 3 AdPreview/AdQuality não mostram nada quando modo = vídeo**
`primaryImage` é null → painel de qualidade some, preview fica em branco. Renderizar fallback ("Vídeo Reels — preview indisponível antes da publicação") e pular o gate `quality.canPublish` quando `creativeMode === "video"` (atualmente já funciona porque `quality` é `null`, mas vale deixar explícito).

**B3. Preflight não recebe `creative_mode`/`video`**
O preflight só checa token/conta/WABA/reach. Para vídeo, vale adicionar warning quando o vídeo ainda não terminou processamento no upload da Meta (mas isso só dá pra ver depois do POST). Mínimo: documentar que vídeo pode atrasar a ativação automática até ~50 s.

**B4. `smartPublish.ts` não foi atualizado**
Continua publicando só `photos` + `cities`. Templates de vídeo ou com raio não passam por aí — mas como nem o `AdTemplateEditor` salva vídeo/raio ainda, sem regressão. Marcar como "fora de escopo desta entrega" ou estender se for usar templates de vídeo.

**B5. `AdTemplateEditor` ignora vídeo/raio**
Salvar como template pelo wizard (botão na Step 4) só persiste `photos`. Em modo vídeo, o template salvo nasce inválido (sem `video_url`). Bloquear o botão "Salvar como template" quando `creativeMode === "video"` até o editor ganhar suporte, **ou** estender o upsert pra gravar `video_url`/`video_thumb_url`/`creative_mode` (colunas já existem na migration).

---

### C. Pontos validados que estão OK

- ✅ TypeScript compila sem erros
- ✅ Migration `ad_video_library`: PRIMARY KEY, índice único `(consultant_id, url)`, GRANTs para `authenticated`/`service_role`, RLS com policy por consultor
- ✅ Colunas `video_url`, `video_thumb_url`, `creative_mode` adicionadas a `ad_templates`
- ✅ Bucket `consultant-photos`: público, aceita qualquer mime
- ✅ Edge function valida `cities OU custom_locations` (linha 146) e `photos OU video` (linha 143-145)
- ✅ Mínimo R$ 10/dia validado no backend (linha 151), bate com o slider e com o preset Econômico
- ✅ `geo_locations` monta `custom_locations` com clamp 1–50 km (linha 342) e `address_string`/`name` opcionais
- ✅ Modo vídeo força placements verticais (`feed`, `facebook_reels`, `story`, `stream`, `reels`, `story`, `explore`)
- ✅ Cache `ad_video_library` reusa `fb_video_id` em republicações
- ✅ `object_story_spec.video_data` inclui CTA `WHATSAPP_MESSAGE` com link `api.whatsapp.com/send` + mensagem inicial
- ✅ Preflight aceita `custom_locations`, monta `reachestimate` correto e emite warning para audiência <5k em raio
- ✅ Wizard reseta state de vídeo/raio ao reabrir (linha 207)
- ✅ Validação no `handleNext` cobre `cities=0` em modo cidades e `radiusPoints=0` em modo raio
- ✅ Submit envia `creative_mode`, `video`, `custom_locations` corretamente; `photos` é `undefined` no modo vídeo
- ✅ `AddressRadiusPicker` carrega Google Maps async com callback, usa Places API (New) `AutocompleteSuggestion`, restringe Brasil (`includedRegionCodes: ["br"]`), respeita teto 200 pontos, mostra `pending` em verde antes de confirmar

---

### D. Roteiro de teste manual (depois das correções A1–A3)

1. Wizard → Step 1 → toggle "Endereço + raio" → buscar "Av Paulista" → confirmar 3 km → próximo
2. Step 2 → toggle "Vídeo Reels" → enviar `.mp4` vertical 1080×1920 12s → próximo
3. Step 3 → conferir copy e WhatsApp message → próximo
4. Step 4 → clicar preset "Modo Econômico" (R$ 15 × 3d) → conferir resumo "📍 1 endereço, raio 3 km · 🎬 1 vídeo Reels (12.0s)" → Publicar
5. Verificar log da edge `facebook-create-campaign`: `step=video_upload`, polling até `ready`, criativo criado com `video_data`, ad ativado
6. Verificar `ad_video_library` no DB: row com `fb_video_id` preenchido
7. Repetir publicação com o **mesmo vídeo** → confirmar log `[fb-create] video CACHE HIT`

### Resumo executivo

Implantação **está 90% pronta**. Bloqueadores reais são apenas A1 (lógica de polling), A2 (limite de upload) e A3 (geo perdido no DB local). Tudo o mais é polimento. Posso aplicar A1+A2+A3 agora se você aprovar este plano.
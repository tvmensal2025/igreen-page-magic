## Auditoria detalhada da plataforma de anúncios

### O que está bom (manter)
- OAuth Facebook funcional, conta+página+pixel configurados (`facebook_connections`, `consultant_ad_settings`)
- 40+ edge functions cobrindo todo o ciclo: criar, pausar, estender, healthcheck, CBO→ABO, CAPI, audiences, sync
- `CreateCampaignWizard` (1646 linhas) + `SmartPublishButton` ("1 clique publica") já funcionam — 11 campanhas reais comprovam
- Picker de endereço+raio existe (`AddressRadiusPicker`) — modo "ultra-local" pronto

### Problemas reais encontrados

**1. Templates não têm vídeo.** Todos os 10 `ad_templates` estão com `creative_mode='photo'`. O vídeo de "28% análise" que você quer reaproveitar está em `ad_video_library` (2 vídeos), mas nunca foi salvo como template. Por isso você não consegue "usar o mesmo vídeo" via gallery.

**2. Templates sem cidades salvas.** Todos com `target_cidades=[]`. Significa que cada vez que você publica, precisa redigitar a cidade. Não há "Uberlândia 100km" salvo em lugar nenhum.

**3. Limite de raio em 50km.** O `AddressRadiusPicker` tem slider `min=1 max=50`. Você pediu 100km — hoje, impossível pelo modo radius. Saída: usar modo `cities` com Uberlândia + cidades num raio de 100km (Araguari, Uberaba, Patrocínio, Ituiutaba, Monte Carmelo, Araxá, Tupaciguara, Prata). A campanha de R$70/dia com 24 leads que você já rodou usa exatamente esse padrão (`Uberlândia, Araguari, Uberaba`).

**4. Métricas não chegam ao banco.** `facebook_ad_metrics_daily=0 linhas` e `avg_cpl_cents=NULL` em 100% dos templates. A função `facebook-sync-metrics` existe mas não está sendo chamada por cron. Resultado: o `usage_count` sobe (máx 2 num template), mas o CPL nunca aparece, então você nunca sabe qual template performa melhor.

**5. Template "Uberladia" com typo.** ID `7934ae66...` — R$70/dia, foto, 0 usos. Provavelmente foi sua tentativa anterior. Renomear + adicionar vídeo + salvar cidades.

**6. Tabela `bulk_campaigns` vazia.** Existe infra de campanhas em lote multi-cidade que nunca foi exercitada — pode ser exatamente o caso "1 campanha → várias cidades no raio".

**7. Meu lixo recente (vou apagar).** `campaign_templates` (tabela), `/admin/campanhas` (rota), `Campanhas.tsx`, `CampaignTemplateForm.tsx`, `CampaignTemplateCard.tsx`, `campaignTemplate.ts`, item de menu "Campanhas (Templates)" — tudo duplicado, vai sair.

---

## Plano de execução — B + C combinados

### Fase 0 — Reverter o erro
- Deletar arquivos: `src/pages/Campanhas.tsx`, `src/components/admin/campanhas/*`, `src/lib/campaignTemplate.ts`
- Remover rota `/admin/campanhas` em `App.tsx` e item de menu em `Admin.tsx`
- Migração: `DROP TABLE public.campaign_templates`

### Fase 1 — Consertar `ad_templates` (parte C)
- Adicionar dois templates novos via migração (consultant_id NULL = templates de plataforma):
  - **"Uberlândia + 100km — 28% Análise (Vídeo)"**: `creative_mode='video'`, `video_url` apontando para o vídeo que você usa, `target_cidades=['Uberlândia/MG','Araguari/MG','Uberaba/MG','Patrocínio/MG','Ituiutaba/MG','Monte Carmelo/MG','Araxá/MG','Tupaciguara/MG']`, `suggested_daily_budget_cents=7000`, `age_min=28 age_max=65`, headline e copy do "28%"
  - Renomear "Uberladia" → arquivar (status='archived') para sumir da galeria
- Adicionar campo `default_radius_km` (NULL, integer) em `ad_templates` para futuros templates ultra-locais

### Fase 2 — Expandir raio até 80km (parte C)
- Em `AddressRadiusPicker.tsx`: subir slider para `max=80` (limite real da Meta API), adicionar quick-picks `10, 25, 50, 80`
- Acima de 50km, mostrar dica: "Para cobrir região >80km, prefira modo 'Cidades inteiras'"

### Fase 3 — Atalho "Replicar última campanha" (parte B)
- Em `AdsCentralTab.tsx`, adicionar card no topo: **"Replicar campanha Uberlândia 100km · R$70/dia · 24 leads"** com botão "Publicar de novo"
- Botão chama o `CreateCampaignWizard` em modo `initialState` pré-preenchido:
  - Cidades: as 8 cidades de MG (Uberlândia + raio 100km)
  - Idade: 25–65, orçamento R$70/dia
  - Template ID: o novo template do vídeo de 28%
- Adicionar prop `initialState` ao `CreateCampaignWizard` (opcional, não quebra usos atuais)

### Fase 4 — Backfill de métricas (parte C)
- Criar cron Postgres (pg_cron) que chama `facebook-sync-metrics` 1x/dia para todos `facebook_campaigns` ativos
- Resultado: `avg_cpl_cents` começa a ser preenchido → galeria de templates passa a mostrar CPL real e ordenar por performance

### Fase 5 — Salvar cidades ao virar template (parte C)
- Em `SaveTemplateDialog.tsx`: capturar `cities` da campanha original e salvar em `target_cidades` do template (hoje não salva)
- Pequena UI: checkbox "Salvar cidades junto com o template"

### Detalhes técnicos

```text
Arquivos a editar
├── src/App.tsx                                  (remover rota)
├── src/pages/Admin.tsx                          (remover item menu)
├── src/components/admin/ads/AdsCentralTab.tsx   (card "Replicar")
├── src/components/admin/ads/CreateCampaignWizard.tsx  (prop initialState)
├── src/components/admin/ads/AddressRadiusPicker.tsx   (max 80)
├── src/components/admin/ads/SaveTemplateDialog.tsx    (salvar cidades)

Arquivos a deletar
├── src/pages/Campanhas.tsx
├── src/components/admin/campanhas/CampaignTemplateCard.tsx
├── src/components/admin/campanhas/CampaignTemplateForm.tsx
└── src/lib/campaignTemplate.ts

Migrações
├── DROP TABLE campaign_templates
├── INSERT ad_templates (Uberlândia 100km vídeo)
├── UPDATE ad_templates SET status='archived' WHERE title LIKE 'Uberladia%'
├── ALTER TABLE ad_templates ADD COLUMN default_radius_km integer
└── SELECT cron.schedule('sync-fb-metrics-daily', '0 6 * * *', $$ ... $$)
```

### Fora do escopo desta entrega
- Mexer em `bulk_campaigns` (existe infra mas seria feature nova)
- Dashboard novo de comparativo de templates (depende das métricas começarem a chegar — 1-2 dias após Fase 4)
- Auto-pause baseado em CPL (já existe `facebook-auto-pause`, só precisaria configurar regra)

### Pré-requisito de você
Preciso que me mande:
1. **URL do vídeo de 28%** que você quer usar (pode ser link do `ad_video_library` ou eu busco — me diga qual dos 2 vídeos)
2. **Headline exato** que tem performado bem ("Análise de 28% de economia"?)
3. **Copy principal** atual desse anúncio

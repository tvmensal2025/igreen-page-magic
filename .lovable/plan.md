## Diagnóstico

Fiz a análise profunda da aba de campanhas do Facebook e encontrei **2 causas raiz**:

### 1) "Só tem conversa no WhatsApp" — métricas zeradas

A tabela `facebook_metrics_daily` está **completamente vazia** (0 linhas em 30 dias), mesmo com 12 campanhas ativas. Motivo:

- O cron `fb-sync-metrics` roda a cada 5 min (OK).
- Mas ele chama a Edge Function passando **apenas** o header `apikey: <anon>` (sem `Authorization: Bearer <service_role>`).
- A função `facebook-sync-metrics` valida `authHeader === "Bearer " + SERVICE_ROLE_KEY` para reconhecer o cron. Como não bate, cai no `authConsultant` (que também falha, é chamada máquina-a-máquina) e retorna **401**.
- Logs confirmam: `POST | 401 | facebook-sync-metrics` a cada tick.
- Resultado: nunca gravou `impressions`, `clicks`, `leads`, `spend`, nem `messaging_conversations_started`. A UI só mostra os poucos valores que vêm de outra fonte (conversas atribuídas via CRM/CTWA).

### 2) "A capa ainda está errada"

O componente `CampaignsList.tsx` monta a miniatura na seguinte ordem:

1. `ad_template_usages` → `ad_templates.photos/video_thumb_url` → **tabela está vazia** (0 linhas).
2. Fallback: pega a **última imagem enviada** para `ad_image_library` do consultor, independente de qual campanha.

Ou seja: hoje toda campanha mostra a mesma imagem (a mais recente da biblioteca do Rafael), não a criativa que a Meta realmente está veiculando. As campanhas foram criadas sem `creative_pack_id` nem registro em `ad_template_usages`, então não há link com a mídia original.

A fonte de verdade correta é a própria Meta: cada `fb_ad_id` tem um `creative` com `image_url`/`thumbnail_url` (ou `video_id` → thumbnail).

---

## Plano de correção

### PR 1 — Consertar o cron (destrava todas as métricas)

Nova migration para recriar o job `fb-sync-metrics` passando o header correto:

```sql
select cron.unschedule('fb-sync-metrics');
select cron.schedule('fb-sync-metrics', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/facebook-sync-metrics',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := jsonb_build_object('cron', true)
  );
$$);
```

Fallback: se `current_setting` não estiver disponível, uso o valor via `vault.decrypted_secrets` ou coloco o service role literal (mesma estratégia já usada nos outros crons que funcionam — `bot-stuck-recovery`, `portal-otp-watchdog`).

Depois disparo `facebook-sync-metrics` manualmente 1x para popular o histórico de 7 dias.

### PR 2 — Capa real da campanha (fonte: Meta Graph API)

**Schema aditivo** em `facebook_campaigns`:

```sql
alter table facebook_campaigns
  add column if not exists thumbnail_url text,
  add column if not exists creative_format text,       -- 'image' | 'video'
  add column if not exists thumbnail_synced_at timestamptz;
```

**Estender `facebook-sync-ad-creatives**` (já roda a cada 6h) para, além do que já faz, buscar:

```
GET /{fb_ad_id}?fields=creative{image_url,thumbnail_url,object_story_spec,video_id}
```

- Se tiver `video_id` → busca `video_id?fields=picture` para thumb.
- Grava `thumbnail_url` + `creative_format` no `facebook_campaigns` (pega o criativo do ad ativo com mais impressões nos últimos 7d).

**Atualizar `CampaignsList.tsx**` (frontend):

- Nova prioridade do `CreativeThumb`:
  1. `campaign.thumbnail_url` (fonte real da Meta) ← **novo**
  2. `ad_template_usages → ad_templates` (mantém para wizard futuro)
  3. `ad_image_library` (último recurso, com badge "prévia — não é a capa veiculada")

### PR 3 — Verificação

- Rodo `facebook-sync-metrics` manualmente e confirmo linhas em `facebook_metrics_daily`.
- Rodo `facebook-sync-ad-creatives` manualmente e confirmo `thumbnail_url` preenchido nos 12 registros ativos do Rafael.
- Abro `/admin` → aba Performance/Campanhas: métricas com números reais e cada card com a capa correspondente.

---

## Detalhes técnicos

- Não mudo a autenticação da função `facebook-sync-metrics` (funciona corretamente para o botão manual da UI); só corrijo o cron que estava incompleto.
- O sync de criativos já roda a cada 6h — só amplio o payload para incluir `image_url/thumbnail_url` sem quebrar nada existente.
- Grants: as duas colunas novas herdam grants existentes de `facebook_campaigns` (não requer nova policy).
- Fallback anti-quebra: se a Meta não retornar thumbnail para um ad específico, mantenho o comportamento atual (biblioteca) marcado como "prévia".

Aprovando, executo PR 1 e disparo o sync na mesma leva; PR 2 e PR 3 vão em seguida no mesmo turno.  
  
coloque um botao para sincronixar assim, nao fica automatico, as veses demora para eu entrar e ver, iria faer cron desnecessario
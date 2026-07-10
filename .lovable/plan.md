# Fechamento migração Voz → Velip

Já feito em turnos anteriores:
- Driver `_shared/voice-dialer/velip.ts` (upload áudio, PlayAudioFile, MakeTTSCall, CreateDestinationBase, CreateCampaign, ChangeCampaign, GetCallStatus, GetUserID, interpretação de status `OK/NA/EK/CK/BK/IK`, retry só p/ `NA`).
- Edges reescritos: `voice-dialer-enqueue`, `voice-dialer-cron`, `voice-dialer-webhook`.
- Novos: `voice-dialer-health`, `voice-campaign-control` (pause/resume/cancel batch).
- `voice-template-stitch` faz upload lazy do OGG renderizado p/ Velip e persiste `velip_audio_id`.
- Migração aplicada: `attempts`, `max_attempts`, `next_attempt_at` em `voice_campaign_targets`; `velip_audio_id`/`velip_uploaded_at` em `voice_template_renders`; índices.
- UI: `VelipHealthBanner` no topo da aba Ligação; `VoiceCallHistoryPanel` mostra ID Velip, status Velip, custo, saldo, DTMF, payload Velip; textos “Twilio” → “Velip”.

## Falta fazer (este plano)

### 1. UI — `VoiceDialerPanel`
- Trocar rótulos remanescentes “Twilio/SID” → “Velip/ID”.
- Adicionar seletor **Modo de disparo** (Auto / 1‑a‑1 / Lote Velip) que envia `velip_mode` para `voice-dialer-enqueue`.
- Mostrar `velip_campaign_id` (batch) com botões **Pausar / Retomar / Cancelar** chamando `voice-campaign-control`.
- Placeholder de teste 55DDDNNNN, validar com `toVelipBRDest`.

### 2. `supabase/config.toml`
- Garantir `verify_jwt = false` para:
  - `voice-dialer-webhook` (Velip não manda JWT)
  - `voice-dialer-cron` (auth por header próprio)
  - `voice-dialer-health` (chamado sem sessão pelo banner na tela inicial)
- Manter `verify_jwt = true` (default) em `voice-dialer-enqueue` e `voice-campaign-control` (ambos usam `resolveCaller`).

### 3. pg_cron
- Confirmar via `supabase--read_query` se o job existente ainda aponta pro endpoint certo com header `x-voice-dialer-cron-secret`.
- Se preciso, atualizar o cron via `supabase--insert` (dados sensíveis — não via migration) para novo intervalo (5 min).

### 4. Deploy
Usar `supabase--deploy_edge_functions` uma vez com:
```
voice-dialer-enqueue
voice-dialer-cron
voice-dialer-webhook
voice-dialer-health
voice-campaign-control
voice-template-stitch
```

### 5. Docs / memória
- Reescrever `mem/features/voice-dialer.md` para Velip:
  - Secrets: `VELIP_API_TOKEN`, `VELIP_WEBHOOK_AUTH`, `VELIP_CALLER_ID` (opcional).
  - URL do webhook a colar no painel Velip:
    `https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/voice-dialer-webhook?auth=<VELIP_WEBHOOK_AUTH>`
  - Mapa de status Velip → interno.
  - Modos `single` vs `batch`.

### 6. Secrets (usuário faz depois)
Vou deixar prontos os 3 secrets abertos para o usuário preencher quando quiser, via `secrets--add_secret`:
- `VELIP_API_TOKEN` (obrigatório)
- `VELIP_WEBHOOK_AUTH` (obrigatório — gerar valor forte, colar aqui e cadastrar no painel Velip como `?auth=` do callback)
- `VELIP_CALLER_ID` (opcional — bina padrão)

Enquanto não forem preenchidos: `voice-dialer-health` responde `configured:false` e o banner mostra o alerta amarelo. Nada quebra em produção.

### 7. Verificação final
- `code--exec` para rodar `tsgo` só nos arquivos alterados.
- Chamar `voice-dialer-health` via `supabase--curl_edge_functions` para confirmar deploy ok (esperado: `configured:false` até o token entrar).
- Confirmar que webhook antigo (Twilio) foi desativado — a rota é a mesma path, então o código novo já sobrescreve; nada a limpar.

## Fora de escopo
- Rotação de números/DIDs Velip (dashboard deles).
- Wallet/cobrança pelo saldo Velip.
- Reintroduzir Twilio (código antigo permanece em `_shared/voice-dialer/twilio.ts` apenas como referência histórica).

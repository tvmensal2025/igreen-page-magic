
# Migração Completa Twilio → Velip — Módulo Admin → Ligação

Substituição integral do driver de voz PSTN. **Escopo isolado**: nada de WhatsApp, Evolution, Whapi, bot ou CRM é tocado. Todo o módulo `/admin?tab=voz` (Voice Dialer + Áudio-WhatsApp Campaign + Templates de voz + Histórico + Retorno de atendidas) passa a rodar sobre a API Velip V2.

---

## 1. Documentação Velip (o que efetivamente vamos usar)

**Base URL:** `https://vox.velip.com.br/api/v2/`
**Auth:** header `Authorization: Bearer <TOKEN_PERMANENTE>` (gerado no painel Velip → API → CONFIGURA → TOKENS).
**Firewall Velip:** origem `35.241.2.50`, callbacks vêm de `35.232.103.91` / `35.184.30.236` (TLS ≥ 1.2, porta 443).
**Retorno padrão:** JSON com `status` (texto) e `status_code` (0 = OK). Códigos 100-199 = autenticação, específicos por API detalhados em cada endpoint.

APIs que vamos consumir:

| API Velip | Uso no módulo |
|---|---|
| `GetUserID` | (opcional) Health-check inicial e diagnóstico de token no painel |
| `CreateAudioFile` | Upload de MP3/WAV do clipe/template → retorna `audio_id` reutilizável |
| `GetAudiosList` | Lista áudios já hospedados na Velip (sincroniza com nossa tabela) |
| `PlayAudioFile` | Dispara ligação **individual** usando `audio_id` (nosso caso principal — áudio pré-gravado) |
| `MakeTTSCall` | Dispara ligação **individual** com áudio TTS ou `audio_id`, com opções de programação, DTMF, transbordo |
| `CreateCampaign` | Dispara **lote** de destinos (até 500k) a partir de base pré-cadastrada |
| `CreateDestinationBase` | Sobe a base de destinos (JSON/CSV) para usar em `CreateCampaign` |
| `ChangeCampaign` | Pausa / retoma / cancela campanha em lote |
| `GetCampaignsList` | Lista/paginação de campanhas para o painel |
| `GetCallStatus` | Fallback quando o callback não chega — consulta status de uma ligação |
| `MakeSMS` (opcional futuro) | Não vai entrar agora; deixamos ganchos preparados |

**Callback (webhook único cadastrado no painel Velip → Integrações → URLs para Retorno):**
Payload JSON com `cd_id`, `cd_date`, `cd_time`, `cd_time_start`, `cd_time_end`, `cd_time_sec`, `cd_called_status` (`OK` = atendeu, `NA` = não atendeu, `EK` = número incorreto, `CK` = bloqueio, `BK` = bloqueio "não perturbe", `IK` = número inexistente), `cd_price`, `cd_value`, `saldo`, `ctid` (nosso ID interno até 15 chars), `dest`, `cd_resp1..12` (DTMF), `cdc_*` (campos de destino quando é campanha em lote).

**Peculiaridade que muda o design:** callback é **1 URL global** cadastrada 1 vez no painel Velip — não é passada por chamada como no Twilio StatusCallback. Amarração ligação↔target é feita pelo campo **`ctid`** que enviamos em cada request.

---

## 2. Análise do módulo atual (para preservar tudo)

Arquivos hoje em produção:

**Backend**
- `supabase/functions/_shared/voice-dialer/twilio.ts` — driver Twilio (auth, TwiML, AMD, signature)
- `supabase/functions/voice-dialer-enqueue/index.ts` — cria clipe + campanha + target(s), JWT
- `supabase/functions/voice-dialer-cron/index.ts` — worker (a cada 5 min): claim atômico `queued→dialing` e chama Twilio
- `supabase/functions/voice-dialer-webhook/index.ts` — recebe TwiML request + StatusCallback + AsyncAMD
- `supabase/functions/voice-template-stitch/index.ts` — costura blocos de áudio de template

**Frontend (Admin → Ligação)**
- `VozTab.tsx` — shell da aba
- `VoiceDialerPanel.tsx` — upload/gravação de clipe + ligação de teste
- `AudioWhatsAppCampaignPanel.tsx` — campanha de áudio no WhatsApp (não muda — não é Velip)
- `VozCampaignShell.tsx` + `VozContactPickerDialog.tsx` — seleção de contatos p/ campanha
- `VoiceCallHistoryPanel.tsx` — histórico com filtro/paginação

**Tabelas**
- `voice_audio_clips` (7 cols) — clipes MP3 armazenados no Storage Supabase
- `voice_campaigns` (16 cols) — 1 campanha por disparo (teste = campanha de 1 target)
- `voice_campaign_targets` (12 cols) — cada telefone destino; tem coluna legada `twilio_sid`
- `voice_call_logs` (14 cols) — 1 log por evento de call; tem `twilio_sid` e `answered_by`
- `voice_templates`, `voice_template_blocks`, `voice_template_renders`, `voice_name_clips` — sistema de templates (usa TTS + concat, sobrevivem)

Tudo isso continua existindo. A migração é **aditiva** (colunas `velip_*` novas) para permitir rollback.

---

## 3. Novas funcionalidades cobertas (além do que já tinha)

O usuário pediu explicitamente para não deixar nada de fora e citou "áudio, modelo, ligação atendida". Este plano cobre:

1. **Upload de áudio dedicado à Velip** (`CreateAudioFile`) com cache do `velip_audio_id` — evita re-upload a cada ligação.
2. **Modelos/templates de voz** — `voice-template-stitch` continua gerando o MP3 final, mas agora o resultado sobe automático para a Velip e vira `velip_audio_id` reutilizável por template.
3. **Ligação atendida — retorno rico**: capturamos `cd_called_status`, `cd_time_sec` (duração falada), `cd_time_start/end`, `cd_value` (custo), `saldo` (saldo Velip pós-chamada), `cd_resp1..12` (DTMF se um dia usarmos IVR). Tudo persistido em `voice_call_logs` + espelhado nos campos do target.
4. **Painel de histórico enriquecido**: colunas "Atendida", "Duração falada", "Custo", "Motivo" (traduzindo NA/EK/CK/BK/IK), badge de saldo Velip.
5. **Retentativas inteligentes**: `NA` (não atendeu) pode reagendar respeitando `max_attempts`; `EK/CK/BK/IK` marca `failed` sem retry.
6. **Campanhas em lote (novo!)**: opcional — usa `CreateDestinationBase` + `CreateCampaign`. Mantemos o modo "1-a-1" (via `PlayAudioFile`) como default; painel ganha toggle "Lote (Velip Campaign)".
7. **Pausar/retomar/cancelar campanha em lote** via `ChangeCampaign`.
8. **Consulta manual de status** (`GetCallStatus`) quando um target ficou preso em `dialing` sem callback por > 10 min.
9. **Health-check** na entrada da aba: chama `GetUserID` e mostra "Velip conectado ✅ Saldo R$ X,XX".
10. **Fallback de webhook**: se `cd_id` chegar sem `ctid` (edge case), tenta match por `dest + timestamp ±60s`.
11. **Feature-flag `VOICE_DRIVER=velip|twilio`** — permite rollback sem redeploy grande por 1 sprint.

Fora do escopo agora (mas com hooks prontos): `MakeSMS`, `MakeWhatsapp`, IVR conversacional Velip, transbordo para call center.

---

## 4. Secrets a configurar

Via `add_secret` (formulário seguro do Lovable — usuário cola valor):

| Secret | Origem | Uso |
|---|---|---|
| `VELIP_API_TOKEN` | Painel Velip → API → CONFIGURA → TOKENS (permanente) | Bearer em toda chamada `vox.velip.com.br/api/v2/*` |
| `VELIP_WEBHOOK_AUTH` | Gerar (`openssl rand -hex 32`) | Query `?auth=` na URL de callback cadastrada no painel |
| `VELIP_CALLER_ID` *(opcional)* | Painel Velip | BINA (se conta permitir) |
| `VOICE_DRIVER` *(opcional)* | Setar `velip` (default) ou `twilio` (rollback) | Feature-flag |

Secrets Twilio (`TWILIO_*`) permanecem no projeto por 1 sprint como fallback, depois deletamos.

---

## 5. Migração de schema (aditiva, não destrutiva)

```sql
alter table public.voice_audio_clips
  add column if not exists velip_audio_id text,
  add column if not exists velip_uploaded_at timestamptz;

alter table public.voice_templates
  add column if not exists velip_audio_id text,
  add column if not exists velip_uploaded_at timestamptz;

alter table public.voice_campaigns
  add column if not exists velip_campaign_id text,     -- só quando modo lote
  add column if not exists velip_mode text default 'single'  -- 'single' | 'batch'
    check (velip_mode in ('single','batch'));

alter table public.voice_campaign_targets
  add column if not exists velip_call_id text,
  add column if not exists velip_status text,     -- OK/NA/EK/CK/BK/IK
  add column if not exists velip_cost numeric(10,4),
  add column if not exists velip_saldo_after numeric(12,4);

alter table public.voice_call_logs
  add column if not exists velip_call_id text,
  add column if not exists velip_status text,
  add column if not exists velip_cost numeric(10,4),
  add column if not exists velip_saldo_after numeric(12,4),
  add column if not exists velip_time_sec integer,
  add column if not exists velip_dtmf jsonb,
  add column if not exists velip_raw jsonb;

create index if not exists voice_targets_velip_call_id_idx
  on public.voice_campaign_targets(velip_call_id);
create index if not exists voice_call_logs_velip_call_id_idx
  on public.voice_call_logs(velip_call_id);
```

Sem alteração de RLS (as políticas já cobrem consultant/service_role). Colunas `twilio_sid` permanecem para não perder histórico.

---

## 6. Arquitetura nova por arquivo

### 6.1 Novo driver — `supabase/functions/_shared/voice-dialer/velip.ts`
```ts
export function velipConfigured(): boolean
export function getVelipToken(): string
export function getVelipWebhookAuth(): string
export function toE164BR(raw): string | null   // reaproveitado

// Header padrão
function velipHeaders(): Record<string, string>

// Áudio
export async function uploadAudioFile(mp3Bytes: Uint8Array, name: string): Promise<{ok, audio_id?, error?}>
export async function listAudios(): Promise<{ok, items, error?}>

// Chamadas
export interface MakeCallOpts {
  to: string;              // E.164 sem "+"
  audioId?: string;        // preferido
  ttsText?: string;        // fallback
  ctid: string;            // = voice_campaign_targets.id (até 15 chars → usa slice)
  timeLimitSec?: number;
  scheduledAt?: string;    // 'YYYY-MM-DD HH:MM:SS'
}
export interface MakeCallResult { ok: boolean; cd_id?: string; status_code?: number; status?: string; raw?: any; error?: string }

export async function playAudioFile(opts: MakeCallOpts): Promise<MakeCallResult>
export async function makeTTSCall(opts: MakeCallOpts): Promise<MakeCallResult>

// Campanha em lote (opcional)
export async function createDestinationBase(items: Array<{dest:string, ctid?:string, name?:string, cod_cli?:string, extras?:string[]}>): Promise<{ok, base_id?, error?}>
export async function createCampaign(opts: {baseId:string, audioId:string, name:string, scheduledAt?:string, ctid?:string}): Promise<{ok, cp_id?, error?}>
export async function changeCampaign(cp_id: string, action: 'pause'|'resume'|'cancel'): Promise<{ok, error?}>
export async function getCampaignsList(): Promise<{ok, items, error?}>

// Utilidades
export async function getCallStatus(cd_id: string): Promise<{ok, status, raw?, error?}>
export async function getUserID(): Promise<{ok, saldo?, error?}>  // health-check

// Interpretadores
export type VelipOutcome = 'answered'|'no_answer'|'invalid_number'|'blocked'|'do_not_disturb'|'nonexistent'|'unknown'
export function interpretStatus(cd_called_status: string): VelipOutcome
export function isRetryable(outcome: VelipOutcome): boolean   // só 'no_answer'
```

Nada de assinatura HMAC (Velip não assina) — segurança do webhook = `?auth=` + validação opcional de IP contra `35.232.103.91`/`35.184.30.236`.

### 6.2 `voice-dialer-enqueue/index.ts` (reescrito)
- Recebe `{ clipId?, templateId?, phone(s), scheduledAt? }`.
- Se `clipId` não tem `velip_audio_id` → baixa MP3 do Storage → `uploadAudioFile` → salva `velip_audio_id`.
- Se `templateId` sem `velip_audio_id` → invoca `voice-template-stitch` (já existe) → sobe resultado à Velip → grava.
- Cria `voice_campaigns` (mode `single` por default; `batch` se >= 30 destinos e usuário marcou o toggle).
- Cria `voice_campaign_targets` `queued`.
- Se `single`: cron faz o disparo. Se `batch`: chama `createDestinationBase` + `createCampaign` e grava `velip_campaign_id`.

### 6.3 `voice-dialer-cron/index.ts` (reescrito)
- Mantém claim atômico `queued→dialing`.
- Para cada target claimed:
  - `to = toE164BR(target.phone)`, `ctid = target.id.slice(0,15)`.
  - `playAudioFile({ to, audioId: campaign.velip_audio_id, ctid, timeLimitSec: 40 })`.
  - Se `status_code === 0`: grava `velip_call_id` no target, insere `voice_call_logs` com estado `dialing`.
  - Se erro: `failed` + log.
- Passo extra: varre `dialing` há > 10 min sem callback → chama `getCallStatus(velip_call_id)` para reconciliar.

### 6.4 `voice-dialer-webhook/index.ts` (reescrito)
- Aceita **POST JSON e POST x-www-form-urlencoded** (Velip permite ambos).
- Exige `?auth=` = `VELIP_WEBHOOK_AUTH` (401 caso contrário).
- Opcional: valida `X-Forwarded-For` contra IPs Velip (soft-warn, não hard-fail).
- Parse payload → `cd_id`, `ctid`, `cd_called_status`, tempos, `cd_value`, `saldo`, `cd_resp*`.
- Match do target:
  1. Por `ctid` (path feliz).
  2. Fallback por `velip_call_id = cd_id`.
  3. Último fallback por `dest + created_at ±60s`.
- Atualiza `voice_campaign_targets`: `velip_status`, `velip_cost`, `velip_saldo_after`, `status = completed|failed|no_answer`.
- Insere/atualiza `voice_call_logs` com `velip_raw = payload`.
- Se `isRetryable(outcome) && attempts < max_attempts` → target volta para `queued` com `next_attempt_at = now()+15min`.
- Sempre retorna `200 OK {ack:true}` para Velip não re-tentar em loop.

### 6.5 `voice-template-stitch/index.ts` (patch mínimo)
- Após gerar MP3 final do template, chama `uploadAudioFile` → guarda `velip_audio_id` em `voice_templates`.
- Se já existe `velip_audio_id`, não reenvia.

### 6.6 `supabase/config.toml`
- `voice-dialer-cron` e `voice-dialer-webhook` seguem com `verify_jwt = false` (auth no código).
- `voice-dialer-enqueue` mantém JWT.

### 6.7 Frontend (`src/components/admin/voz/*`)
- `VozTab.tsx`: banner de health-check chamando um novo edge `voice-dialer-health` (que roda `getUserID`) — mostra "Velip conectada • Saldo R$ 12,34" ou instrução de configurar token.
- `VoiceDialerPanel.tsx`:
  - Rótulos "Twilio" → "Velip".
  - Botão **"Ligar teste"** intacto.
  - Novo toggle **"Modo lote (>30 destinos)"**.
  - Mensagens de erro humanizadas (`velip_not_configured`, `velip_upload_failed`, `velip_no_saldo`, `velip_invalid_number`).
- `VoiceCallHistoryPanel.tsx`:
  - Novas colunas: **Atendida** (badge verde/vermelha via `velip_status`), **Duração falada** (`velip_time_sec`), **Custo** (`velip_cost`), **Motivo** (tradução de NA/EK/CK/BK/IK), **Saldo pós-chamada** (opcional).
  - Filtro por `outcome` (atendidas / não atendidas / falhas).
- `VozCampaignShell.tsx`: quando escolhe lote Velip, expõe botões **Pausar / Retomar / Cancelar** ligados a um novo edge `voice-campaign-control` que chama `ChangeCampaign`.
- Sem alteração no `AudioWhatsAppCampaignPanel.tsx` (nada Velip ali).

### 6.8 Edges novas
- `voice-dialer-health` — GET; roda `getUserID`, devolve `{ ok, saldo, token_ok }`.
- `voice-campaign-control` — POST `{ campaignId, action }`; roda `ChangeCampaign`.

---

## 7. Mapeamento de status Velip → nosso modelo

| `cd_called_status` | `outcome` interno | `target.status` | Retry? |
|---|---|---|---|
| `OK` | `answered` | `completed` | não |
| `NA` | `no_answer` | `no_answer` | sim (até `max_attempts`) |
| `EK` | `invalid_number` | `failed` | não |
| `CK` | `blocked` | `failed` | não |
| `BK` | `do_not_disturb` | `failed` | não |
| `IK` | `nonexistent` | `failed` | não |
| outro / vazio | `unknown` | mantém `dialing` até reconciliação | — |

---

## 8. Fluxo end-to-end (visão única)

```text
UI  "Ligar teste"  ─▶  voice-dialer-enqueue (JWT)
                              │
                              ├─ garante velip_audio_id (upload lazy p/ Velip)
                              ├─ cria voice_campaigns (mode=single|batch)
                              └─ cria voice_campaign_targets (queued)
                                       │
                                       ▼
                          voice-dialer-cron  (pg_cron 5 min + trigger imediato p/ teste)
                                       │
                                       ├─ claim queued → dialing
                                       ├─ POST /api/v2/PlayAudioFile   (single)
                                       │      ou /api/v2/MakeTTSCall
                                       └─ grava velip_call_id
                                                        │
                    (Velip disca, toca áudio, cliente atende ou não)
                                                        │
                                                        ▼
                          voice-dialer-webhook  (POST JSON global do painel Velip)
                                       │
                                       ├─ valida ?auth=VELIP_WEBHOOK_AUTH
                                       ├─ match por ctid → velip_call_id → dest+time
                                       ├─ upsert voice_call_logs (raw, cost, saldo)
                                       ├─ target.status = completed|no_answer|failed
                                       └─ se no_answer & tem attempts → re-queue
```

Modo lote:
```text
enqueue ─▶ createDestinationBase ─▶ createCampaign (velip_campaign_id salvo)
UI (pausa/retoma/cancela) ─▶ voice-campaign-control ─▶ ChangeCampaign
callbacks chegam por target (mesmo webhook)
```

---

## 9. Checklist pós-deploy (para o usuário)

1. Criar conta na Velip, gerar **Token permanente** e me dizer p/ eu abrir `add_secret VELIP_API_TOKEN`.
2. Gerar `VELIP_WEBHOOK_AUTH` (`openssl rand -hex 32`) e colar no `add_secret`.
3. Painel Velip → **Integrações → URLs para Retorno**: cadastrar
   `https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/voice-dialer-webhook?auth=<VELIP_WEBHOOK_AUTH>`
   Formato: **JSON**, método **POST**.
4. Migração SQL + deploy das edges (automático no Lovable).
5. Admin → Ligação: banner deve mostrar **"Velip conectada • Saldo R$ X"**.
6. Gravar clipe de ~15-25s → **Ligar teste** para o próprio celular.
7. Após atender, conferir `voice_call_logs`: `velip_status=OK`, `velip_time_sec > 0`, `velip_cost` preenchido.

---

## 10. Riscos e mitigação

- **Callback global** (não por chamada): mitigado por 3 estratégias de match (`ctid` → `cd_id` → `dest+time`) + reconciliação via `GetCallStatus` no cron.
- **Sem AMD estilo Twilio**: mensagens curtas (≤ 25 s) e `TimeLimit`; classificamos `NA` como não-atendida.
- **`ctid` limite 15 chars**: usamos `target.id.slice(0,15)` (colisão desprezível dentro de janela de 24 h) + mapa `velip_call_id` como reforço.
- **Custo por chamada**: `velip_cost` + `velip_saldo_after` gravados p/ auditoria; painel exibe consumo do dia.
- **Rollback**: `VOICE_DRIVER=twilio` reativa o driver antigo (mantido no repo por 1 sprint) sem migração reversa.
- **Áudio grande**: `CreateAudioFile` tem limites — validamos MP3 ≤ 2 MB, ≤ 60 s antes do upload.
- **Rate-limit Velip**: envolvemos chamadas em backoff exponencial no cron (`429/5xx` → retry 3×).

---

## 11. Testes automatizados (Deno test)

- `voice-dialer-webhook.test.ts` — cases: `OK`, `NA`, `EK`, payload sem `ctid`, `auth` inválido, retry-cap.
- `voice-dialer-cron.test.ts` — claim atômico, falha de upload de áudio, reconciliação `dialing` stale.
- `velip.ts.test.ts` — mocks de `fetch`, parsing de `status_code`, `interpretStatus`, `toE164BR`.

---

## 12. Ordem de execução da build

1. `supabase--migration` (schema aditivo).
2. `add_secret VELIP_API_TOKEN`, `add_secret VELIP_WEBHOOK_AUTH`.
3. Criar `_shared/voice-dialer/velip.ts`.
4. Reescrever `voice-dialer-enqueue`, `voice-dialer-cron`, `voice-dialer-webhook`.
5. Criar edges `voice-dialer-health` e `voice-campaign-control`.
6. Patch em `voice-template-stitch` para subir MP3 final à Velip.
7. Atualizar UI (`VozTab`, `VoiceDialerPanel`, `VoiceCallHistoryPanel`, `VozCampaignShell`).
8. Atualizar `mem/features/voice-dialer.md` e `supabase/functions/.env.example`.
9. Deploy das edges + health-check no painel.

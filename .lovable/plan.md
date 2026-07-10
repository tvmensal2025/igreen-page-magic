
# Auditoria + expansão do módulo Ligação (Velip)

Auditei a doc oficial (https://api.velip.com.br) contra o que está no ar em `/admin?tab=voz`. Hoje usamos só ~30% do que a Velip oferece. Abaixo o que falta, o que está fraco e o que vou construir.

## 1. O que já temos hoje

- Discagem individual e em lote com áudio pré‑gravado (`PlayAudioFile` + `CreateCampaign`)
- Callback global (`voice-dialer-webhook`) com retry para "não atendeu"
- Banner de saldo/status (`voice-dialer-health`)
- Histórico simples (tabela)
- Templates de voz costurados (nome do lead)

## 2. O que a Velip oferece e ainda **NÃO** usamos

| API Velip | Função | Status atual |
|---|---|---|
| `MakeTTSCall` | Ligar com voz sintetizada (sem gravar) | ❌ não implementado |
| `CreateCampaign` com **data/hora programada** | Agendamento nativo de disparo | ❌ hoje só "agora" |
| `ChangeCampaign` | Pausar/retomar/editar campanha na Velip | ⚠️ parcial (só cancelar) |
| `GetCampaignsList` | Listar campanhas na Velip | ❌ |
| `CreateDestinationBase` / `GetDestinationsList` | Bases de contato reutilizáveis | ❌ |
| `GetAudiosList` | Biblioteca de áudios na Velip | ❌ |
| DTMF (`cd_resp1..12`) | Pesquisa por teclado (1=sim,2=não…) | ❌ callback ignora |
| `MakeSMS` | SMS individual / em lote | ❌ |
| `MakeWhatsapp` | WhatsApp pela Velip | ❌ (temos Whapi/Evo, opcional) |
| `CreateCenterQueue` / transbordo | Transferir atendimento vivo p/ humano | ❌ |
| Interconectar 2 destinos | Ponte com privacidade de número | ❌ |
| Relatórios consolidados | CSV / dashboard financeiro | ❌ |

## 3. Redesign do histórico (você reclamou)

Hoje é uma tabela plana e sem contexto. Vou trocar por:

- **Timeline agrupada por dia** com cartões clicáveis
- Barra de KPIs no topo (atendidas · não atendidas · falhas · custo total · duração média)
- Filtros: período, status, campanha, custo mínimo, DTMF respondido
- **Detalhe expandível** por chamada: cronologia (discagem → atende → desliga), custo, áudio tocado (play inline), DTMF, saldo pós‑chamada, número Velip (`cd_id`), telefone destino, campanha origem
- Botão "Rediscar" e "Enviar SMS de follow‑up" direto do cartão
- Exportar CSV do filtro atual

## 4. Novas abas no `/admin?tab=voz`

Vou reorganizar em 6 abas (hoje são 2):

```text
[Nova ligação] [Agendadas] [Campanhas] [Bases] [SMS] [Histórico] [Dashboard]
```

### 4.1 Nova ligação (upgrade)
- Toggle: **Áudio gravado** OU **TTS** (texto → voz Velip, escolhe voz masc/fem)
- Escolher **BINA** (número que aparece pro destinatário) dentre CallerIDs da conta
- **DTMF opcional**: adicionar até 12 perguntas com opções ("Tecle 1 para…")
- Preview de custo estimado por alvo (usa `cd_price` do último callback do DDD)

### 4.2 Agendadas (nova)
- Lista de campanhas com `scheduled_at` futuro
- Botão **editar horário** (chama `ChangeCampaign`)
- Cancelar antes de rodar

### 4.3 Campanhas (nova)
- Lista completa (ativas + concluídas) puxando também de `GetCampaignsList` da Velip
- Progresso em tempo real (queued/dialing/answered/failed)
- Pausar · Retomar · Cancelar · **Clonar** (recria com mesma base e áudio)
- Ver base de destino

### 4.4 Bases (nova)
- Biblioteca de listas de contatos reutilizáveis (`CreateDestinationBase`)
- Import CSV, colar lista, ou puxar do CRM (filtros: stage, cidade, campanha origem)
- Reusar em várias campanhas sem re‑upload

### 4.5 SMS (nova)
- Disparo individual e em lote (`MakeSMS`)
- Merge de campos ({{nome}}, {{cidade}}, {{protocolo}})
- Agendamento e janela de horário
- Callback separado (`command:"sms"`) já mapeado; status de entrega em até 48h
- Aparece no histórico unificado

### 4.6 Histórico (redesenhado — seção 3)

### 4.7 Dashboard (nova)
- Custo consumido no mês vs saldo
- % de atendimento por dia/hora (heatmap) — descobre melhor janela
- Respostas DTMF agregadas ("70% teclaram 1")
- Top motivos de falha (bloqueio operadora, não pertube, inexistente)
- Custo por lead atendido

## 5. Mudanças de banco (aditivas, sem quebrar nada)

```sql
-- Suporte a TTS, DTMF, SMS, agendamento nativo
alter table voice_campaigns add column dispatch_kind text default 'audio'; -- 'audio' | 'tts' | 'sms'
alter table voice_campaigns add column tts_text text;
alter table voice_campaigns add column tts_voice text;
alter table voice_campaigns add column caller_id text;
alter table voice_campaigns add column dtmf_questions jsonb default '[]'::jsonb;
alter table voice_campaigns add column velip_campaign_id text;

alter table voice_call_logs add column dtmf_responses jsonb default '{}'::jsonb;
alter table voice_call_logs add column price_per_min numeric;

-- Bases reutilizáveis
create table voice_contact_bases (
  id uuid primary key default gen_random_uuid(),
  consultant_id uuid not null,
  name text not null,
  velip_base_id text,
  total int default 0,
  created_at timestamptz default now()
);
create table voice_contact_base_items (
  id uuid primary key default gen_random_uuid(),
  base_id uuid references voice_contact_bases(id) on delete cascade,
  phone text not null,
  name text,
  vars jsonb default '{}'::jsonb
);

-- SMS
create table voice_sms_log (
  id uuid primary key default gen_random_uuid(),
  consultant_id uuid not null,
  campaign_id uuid,
  phone text not null,
  message text not null,
  velip_sms_id text,
  status text default 'queued',
  delivered_at timestamptz,
  cost numeric,
  created_at timestamptz default now()
);
-- + GRANTs + RLS scoped por consultant_id (padrão do projeto)
```

## 6. Edge functions novas / alteradas

| Função | Ação |
|---|---|
| `_shared/voice-dialer/velip.ts` | Adicionar `makeTTSCall`, `makeSMS`, `changeCampaign`, `getCampaignsList`, `getAudiosList`, `createDestinationBase`, `getUserBalance` detalhado |
| `voice-dialer-enqueue` | Aceitar `dispatch_kind`, `tts_text`, `dtmf_questions`, `scheduled_at`, `base_id`, `caller_id` |
| `voice-dialer-webhook` | Persistir `dtmf_responses`, `price_per_min`, saldo; roteador para SMS callbacks |
| `voice-sms-send` (nova) | Wrapper `MakeSMS` individual + lote |
| `voice-contact-base` (nova) | CRUD de bases + sync opcional para Velip |
| `voice-campaign-control` | Suportar `pause/resume` via `ChangeCampaign` (hoje só cancela) |
| `voice-dashboard-metrics` (nova) | Agregações para dashboard |

## 7. UI — arquivos novos

```text
src/components/admin/voz/
  ├─ VozTab.tsx                     (reorganiza em 7 abas)
  ├─ NewCallPanel.tsx               (era VoiceDialerPanel, com TTS+DTMF+BINA)
  ├─ ScheduledCampaignsPanel.tsx    (nova)
  ├─ CampaignsPanel.tsx             (nova — pausar/retomar/clonar)
  ├─ ContactBasesPanel.tsx          (nova)
  ├─ SmsPanel.tsx                   (nova)
  ├─ CallHistoryTimeline.tsx        (substitui VoiceCallHistoryPanel)
  │   ├─ HistoryKpiBar.tsx
  │   ├─ HistoryFilters.tsx
  │   └─ CallDetailDrawer.tsx
  ├─ VoiceDashboardPanel.tsx        (nova)
  └─ shared/DtmfBuilder.tsx         (editor de perguntas DTMF)
```

## 8. Ordem de entrega (proponho fazer tudo em sequência nesta thread)

1. Migração aditiva de banco + grants + RLS
2. Driver Velip completo (TTS, SMS, ChangeCampaign, Bases, GetCampaigns, GetAudios)
3. Edge functions novas + upgrade das existentes
4. UI: reorganização em 7 abas + `NewCallPanel` com TTS/DTMF/BINA/Agendamento
5. Redesign do histórico (timeline + KPIs + drawer)
6. Campanhas + Agendadas + Bases + SMS + Dashboard
7. Documentação em `mem/features/voice-dialer.md`

## 9. O que fica fora deste ciclo (você decide se entra)

- **MakeWhatsapp** da Velip — já temos Whapi/Evolution, seria redundante
- **CenterQueue** (call center receptivo) — só faz sentido se você quiser humano atendendo ligações **de entrada**
- **Interconectar 2 destinos** — útil se quiser ligar consultor↔cliente sem expor números; me diga se serve

---

**Confirma que sigo com tudo (itens 1–7)?**
Se quiser cortar SMS ou Dashboard pra ir mais rápido, me diz agora.

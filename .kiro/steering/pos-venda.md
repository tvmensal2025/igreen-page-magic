---
inclusion: fileMatch
name: pos-venda
description: Pós-venda WA D30–D210 + retentativa.
fileMatchPattern:
  - "supabase/functions/pos-venda-*/**"
  - "supabase/migrations/**pos_venda*"
  - "src/lib/posVenda*"
  - "src/lib/posVenda/**"
  - "src/components/whatsapp/PosVenda*"
  - "src/components/whatsapp/PendingApprovalDialog.tsx"
  - "supabase/functions/_shared/pos-venda-retentativa*"
  - "supabase/functions/_shared/pos-venda-audio-prep*"
  - "supabase/functions/_shared/pos-venda-tts*"
  - "supabase/functions/_shared/pos-venda-send-window*"
---

# Pós-venda (WA) — após aprovação iGreen

Domínio: `customers.customer_origin = igreen_sync` + kanban `stage_scope=pos_venda`.  
**Não** confundir com esteira `sale_stage_*` / `sales` (`src/features/produtos/esteira/`) nem com `crm-auto-progress` (legado unificado).

## Edges
| Função | Papel |
|---|---|
| `pos-venda-auto-progress` | Move `pos_venda_stage` + envia **imagem + áudio**; claim em `customer_auto_message_log` |
| `pos-venda-audio-prep` | Pré-gera TTS em `pos_venda_prepared_audio` (atrasados + 48h); **não envia**; roda fora da janela |
| `pos-venda-bucket-cron` | Só `rpc('recompute_pos_venda_stages')` — sem envio |
| `sync-igreen-customers` | Após sync chama `recompute_pos_venda_stages`; protege `pos_venda_recadastro_at` |

UI: `PosVendaKanban`, `PosVendaSetupWizard`, `PosVendaAutoConfigDialog`, `PendingApprovalDialog`, `PosVendaSendFailuresDialog` · schedule: #[[file:src/lib/posVendaSchedule.ts]]

## Colunas / tabelas
- `customers`: `pos_venda_stage`, `pos_venda_approved_at`, `pos_venda_rejected_at`, `pos_venda_recadastro_at`, `pos_venda_manual`, `pos_venda_pending_stage`, `pos_venda_reason`, `pos_venda_invalid`
- Kanban: keys `pv_espera|pv_aprovado|pv_reprovado|pv_retentativa|pv_d30|…|pv_d210`
- Mídia: `pos_venda_default_media`, `consultant_pos_venda_media`
- Prep: `pos_venda_prepared_audio` (customer+stage_key UNIQUE; `saudacao_bucket` manha|tarde|noite)
- Log idempotente: `customer_auto_message_log` (UNIQUE customer+stage_key). Statuses: `sent` · `failed` · `partial:audio*` · `no_channel:*` · `claimed`/`claimed_retry` · `skipped_prior` · **`dismissed`** (consultor esqueceu / tirou do PV — **não retenta**)
- Helper: `_shared/pos-venda-retentativa.ts` (botão `pv_retentativa_cadastro`) · `_shared/pos-venda-audio-prep.ts` · `_shared/pos-venda-tts.ts`

## Cadeados
1. Toggle `pos_venda_auto_messages` — **não** usa `bot_global_enabled`
2. **Janela de envio** seg–sáb **08:00–20:00 BRT** (`pos-venda-send-window.ts`). Domingo fechado (após 20:00 dom → segunda 08:05). Fora da janela o cron não dispara; o hub agenda no próximo slot (`clampToPosVendaSendWindow`).
3. Só envia se `pos_venda_manual=true` (consultor validou)
4. Canal via `resolveChannelForCustomerWithFailover` (Whapi primeiro)

## Fluxo
Sync/bucket recalcula estágio; se palpite aprovado/reprovado sem validação → `espera` + `pos_venda_pending_stage`; consultor confirma → `pos_venda_manual=true`; auto-progress manda `pv_aprovado`/`pv_reprovado` e avança D30→D210 a partir de **`pos_venda_approved_at`**.

**Multi-conta:** com `pos_venda_auto_messages` + `pos_venda_auto_validate` ligados, o fluxo vale para **todas** as `igreen_portal_accounts` do consultor (não só a principal). `recompute_pos_venda_stages` também preenche `pending` quando o cliente já está em `espera` com pending null (órfãos de subconta) — migration `20260728190000_recompute_pos_venda_fix_espera_pending`.

**Sync dashboard (`sync_all`):** puxa todas as contas → `recompute` → `auto_confirm_pending_pos_venda` (se Validar sozinho ON) → dispara `pos-venda-auto-progress` (fire-and-forget). Envio é **idempotente** por `(customer_id, stage_key)` — `sent`/`skipped_prior`/`dismissed`/`skipped_duplicate_phone` nunca reenviam o mesmo marco.

**Anti-duplicata Zap (obrigatório):** sync pode criar **2 rows** da mesma pessoa — número limpo + `5511…_igreenCode`, ambos com o mesmo `whatsapp_chat_id`. UNIQUE por `customer_id` **não** impede 2× (img+áudio) = **4 bolhas** no mesmo chat. O motor:
1. **Nunca** dispara de row com telefone de colisão (`…_igreenCode` **ou** dígitos colados >13) → status `skipped_duplicate_phone`
2. Se outro `customer_id` já tem log terminal no mesmo **phone base** (13 dígitos) + `stage_key` → pula (JID legado colado conta)
3. **Spacing ~25d** entre marcos `pv_d*` → `skipped_spacing` (evita D120+D150 no catch-up na virada de bucket)
4. Só lista `pos_venda_invalid=false`
5. `normalizePhone`/`toJid` **sempre** cortam sufixo `_codigo` (nunca colar no JID)

**Cliente ≠ lead:** telefone com colisão sync (`5511…_igreenCode`) resolve inbound pela carteira (`_shared/inbound-customer-resolve.ts`). Lead sombra no número limpo é absorvido (pausa+DNC). Origem `igreen_sync`/`igreen_extension` → canal novidades, nunca Grupo A.

### Validação (popup) — data iGreen obrigatória no marco
- Ao **Validar**, `confirm_pending_classification` carimba `pos_venda_approved_at` com a data iGreen (`data_ativo` → `data_validado` → `data_cadastro`, nunca futura) e calcula o bucket D* sozinho.
- Áudio/imagem já estão em `pos_venda_default_media`; o consultor não precisa “olhar” nem escolher 30/60/90.
- Marcos anteriores ao bucket atual entram em `customer_auto_message_log` como `skipped_prior` (hub não lista backlog fantasma).
- Helper UI: `src/lib/posVendaReferenceDate.ts`.
- Cliente carteira (`igreen_sync` / `igreen_extension`) **nunca** fala com Grupo A — origin-guard no webhook → **canal de novidades** (`cliente-canal-novidades.ts`); Cérebro só se o toggle do canal estiver OFF.
- UI: botão **Canal novidades** no Kanban (`ClienteCanalNovidadesDialog`) — edita texto, liga/desliga, reserva `cliente_canal_flow_id` (fluxo futuro, ainda não dispara).

### Modal de falhas de envio (`PosVendaSendFailuresDialog`)
- Abre sozinho no Kanban quando há log `failed` / `partial:*` / `no_channel:*` / `claimed_retry` (cliente `pos_venda_invalid=false`).
- Botão **Falhas no envio** no header (badge com contagem).
- Ações por cliente:
  1. **Esquecer** → `pos_venda_manual=false` + log `dismissed` (motor não retenta)
  2. **Editar número** → canonical BR em `phone_whatsapp` + `whatsapp_chat_id` (libera duplicata se preciso) + retry via `pos-venda-auto-progress` (fallback: próxima rodada do cron)
  3. **Excluir do pós-venda** → `pos_venda_invalid=true` + `pos_venda_manual=false` + log `dismissed` (**não** hard-delete da carteira)

### Retry de áudio (`partial:audio*`) — 2026-08-08
- Sintoma UI: **Imagem ok, áudio falhou** (`partial:audio_missing` + `[img:ok|audio:fail]`).
- Causa típica: Whapi falhou no MP3 longo (~1–2MB) depois da imagem; o claim ficava preso e o BATCH priorizava novos envios.
- Correções no motor:
  1. Cron **prioriza** `partial:*` / `failed` / `no_channel:*` / `deferred:*` **antes** de aprovado/D* novos
  2. `sendAudioWithRetry` = 3 tentativas com backoff; se prepared falhar no Zap, tenta stitch fresco
  3. MP3 grande → Whapi tenta `messages/audio` antes de PTT `messages/voice`
  4. `hourBRT` NaN não cai mais em “noite” (saudação/prepared errados)
- Preview guarda `audio_err:…` para diagnóstico.

### Toggle “Validar sozinho” (`pos_venda_auto_validate`)
- Coluna em `consultant_automation_prefs` — **default OFF**.
- UI: switch no Kanban pós-venda + no popup de validação.
- Ligado: RPC `auto_confirm_pending_pos_venda` confirma `aprovado`/`reprovado` pendentes (com data iGreen). `falta_assinatura` / `devolutiva` continuam manuais.
- Roda no sync (após recompute) e no `pos-venda-bucket-cron`. Ao ligar o toggle, processa a fila atual na hora.

### Retentativa (qualquer consultor)
1. Validar reprovado → carimba `pos_venda_rejected_at` + msg `pv_reprovado` (sem botão)
2. Após **60 dias** → move para `retentativa` + msg + escolha:
   - **Whapi:** botão `Quero tentar de novo` (`pv_retentativa_cadastro`)
   - **Evolution:** texto numerado `*1.* Quero tentar de novo` (canal sem botão real)
3. Clique / resposta `1` → `activatePosVendaRecadastro` (origem `whatsapp_lead`, Grupo A / cadastro); sync não re-flipa enquanto `pos_venda_recadastro_at` ativo

## Áudio = stitch Sofia (corpo fixo + nome reaproveitado)

Roteiro canônico em `message_text` (só texto; áudio é montado em peças):
1. `Olá, {{nome}} Tudo bem?` → clip `intro:ola:ptbr4:{nome}` (**reusa** biblioteca **pública** `is_public`; Maria etc. — Zap/ligação/PV compartilham; helper `_shared/ai-media-shared-intro.ts`)
2. `{{saudacao}}` → clip fixo `pv_saudacao:{manha|tarde|noite}:v1` (**público**, gera **1×**)
3. corpo do estágio → clip fixo `pv_body:{stage}:v1` (gera **1×** por marco; por consultor)

No Zap: **só imagem + áudio** (`forbidText: true`). Sem bolha de texto.

**PROIBIDO** regenerar o roteiro inteiro via `pv_tts_*` / `renderPersonalizedTtsAudio` no pós-venda.

### Prep antes do envio
1. Cron `pos-venda-audio-prep` monta stitch e grava em `pos_venda_prepared_audio`.
2. No envio: `prepared` se saudação bater; senão stitch na hora (ainda reusando peças).
3. Precedência: `prepared` > stitch (intro+saudação+corpo) > **nunca** TTS do texto completo.

**NÃO** recolocar `media_url` estático legado por cima do roteiro com `{{saudacao}}`.

## Deploy (checklist)
- Edges: `pos-venda-audio-prep`, `pos-venda-auto-progress` (bundla `_shared`)
- Migration: `pos_venda_prepared_audio` + cron `pos-venda-audio-prep-hourly`
- SQL já aplicado em prod via MCP; código precisa commit + push + workflow deploy

## NÃO FAÇA
Msg sem validação manual / sem toggle · misturar `sale_stage_*` · apagar edges/toggles · massa nova sem pedido · hardcode UUID de um consultor nos seeds (usar `CROSS JOIN consultants`) · gravar `media_url` legado por cima do roteiro com `{{saudacao}}`.

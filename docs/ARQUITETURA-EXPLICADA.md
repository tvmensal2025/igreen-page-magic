# Arquitetura explicada — iGreen Page Magic

Documento didático para desenvolvedores novos no projeto. Explica **o que cada
camada faz**, **como o dado flui** e **por que** as regras existem.
Complementa (não substitui) o `AGENTS.md` e os arquivos em `.kiro/steering/`.

---

## 1. Visão de negócio em um parágrafo

A plataforma capta **leads** de energia/telecom via anúncios Meta (Click-to-WhatsApp),
QR de parceiros e páginas públicas de consultor; conduz esse lead por um **funil
automatizado de WhatsApp** (bot "Sofia") que coleta conta de luz + documento,
faz OCR, e efetiva o **cadastro no Portal 2 da iGreen**; depois disso o contato
vira **cliente** e passa a viver só na esteira de **pós-venda**. Em volta disso
existem: CRM/Kanban, carteira financeira (Stripe), motor de voz/SMS (Velip),
gestão de anúncios Meta, Academia/ajuda e um módulo Solar 3D.

Regra mestra que organiza tudo:

> **Lead → sempre entra no Grupo A. Cliente → só pós-venda.**

---

## 2. Stack e topologia

| Camada | Tecnologia | Onde |
|---|---|---|
| Front-end | React 18 + Vite 5 + TypeScript + Tailwind + shadcn/ui | `src/` |
| Estado servidor | TanStack Query | `src/hooks/` |
| Backend | Supabase (Postgres + RLS + Edge Functions Deno) | `supabase/` |
| Workers externos | Node + Playwright + BullMQ/Redis (Easypanel) | `worker-portal-2/`, `worker-club/`, `worker-igreen-sync/` |
| Canais | Whapi (primário), Evolution API (legado), Velip (voz/SMS) | edge functions |
| Mídia | MinIO (privado) + Supabase Storage (fallback) | `src/services/minioUpload.ts` |

Há **221 Edge Functions**. Elas são o backend real: o front nunca fala com
Whapi/Meta/Velip/Portal diretamente — sempre via função, porque as chaves são
secrets do servidor.

---

## 3. Front-end

### 3.1 Bootstrap (`src/main.tsx`)
Além de montar o React, este arquivo é a **camada de sobrevivência do PWA**:

- `?nuke=1` — limpa Service Worker + caches + storage e recarrega (resgate de
  usuário preso numa versão antiga instalada).
- `nukeAndReload()` — dispara em `vite:preloadError` / "failed to fetch
  dynamically imported module" (chunk hash antigo depois de um deploy). Tem
  trava anti-loop de 10 min em `localStorage`.
- **Version gate** — compara `version.json` do servidor com `__BUILD_ID__`; se
  houver versão nova, agenda o reload mas **só executa quando o usuário não
  está digitando, com modal aberto ou gerando áudio** (`isUserBusyTyping`).
  Máximo 2 tentativas por versão-alvo, para nunca entrar em ciclo de reload.
- Sentry carregado de forma assíncrona (nunca bloqueia o boot).

### 3.2 App e rotas (`src/App.tsx`)
Providers na ordem: `QueryClientProvider` → `ThemeProvider` → `TooltipProvider`
→ `ConfirmDialogProvider` / `PromptDialogProvider` → `BrowserRouter`.
Todas as páginas são `lazy()` + `Suspense` (code splitting por rota).

Três famílias de rota:

1. **Privadas** (`<ProtectedRoute>`): `/admin/*`, `/consultor/*`, `/super-admin/*`.
   O guard lê a sessão Supabase e o papel do usuário; sem sessão → `/auth`.
2. **Públicas de consultor** (link comercial): `/licenciado/:licenca`,
   `/cadastro/:licenca`, `/conexao-*/:licenca`, `/premium/*`, `/proposta/:token`,
   `/r/:licenca/:code` (rodízio de parceiro), `/p/:token` (banner).
3. **Catch-all de vaidade** `/:initials/:igreenId/:spot?` — é o link curto do
   consultor. Por isso qualquer rota nova de 1 segmento precisa ser declarada
   **antes** dele, senão é engolida.

### 3.3 Organização do código

- `src/pages/` — uma página por rota (46).
- `src/components/` — UI por domínio (`whatsapp/`, `admin/`, `captacao/`, `ui/`).
- `src/features/` — módulos fechados com barrel export (`produtos/`, `solar-3d/`).
- `src/hooks/` — dados + regra de tela (`useKanbanDeals`, `useCaptureSession`,
  `useAcademyProgress`, `useAnalytics`…). É aqui que mora o TanStack Query.
- `src/lib/` — **helpers canônicos**, o coração das regras compartilhadas.
- `src/services/` — clientes de API/edge (`whapiApi`, `minioUpload`, `templateSender`).
- `src/integrations/supabase/client.ts` — client único, com timeout de 15s
  (90s para edge functions) e reescrita de URL para `/functions-proxy` em DEV,
  evitando CORS quando o Vite sobe em outra porta.

### 3.4 Helpers canônicos (por que nunca reimplementar)
Cada um destes existe porque uma reimplementação ingênua já causou bug em produção:

| Helper | Regra que protege |
|---|---|
| `safeFirstNameForAddress` | Só chama o lead pelo nome se a fonte for confiável; na dúvida, sem "Oi Nome" |
| `resolvePublicConsultantLabel` | Nome do consultor exibido ao lead (nunca `display_name \|\| name` cru) |
| `crmVsLeadAnalysis` | "CRM em análise" ≠ "lead em conversa" ≠ "Meta em análise" |
| `clienteCadenceGuard` | Cliente nunca recebe cadência de lead |
| `myClientsFilter` | Impede vazamento de carteira entre consultores |
| `resolveCanonicalFlowVariant` | Força sempre variante **A** |

---

## 4. Banco de dados

Tabelas centrais: `customers` (lead **e** cliente, distinguidos por
`customer_origin` + `pos_venda_stage`), `consultants`, `whatsapp_instances`,
`whatsapp_messages`, `facebook_campaigns`, `cadence_stage_config`,
`daily_reheat_settings`, `automation_skip_log`, `user_roles`, `wallet_*`.

Padrões obrigatórios:

- **RLS em tudo** + `GRANT` explícito por tabela (Supabase não concede default).
- **Papéis nunca na tabela de perfil** — ficam em `user_roles`, consultados por
  `has_role()` `SECURITY DEFINER` (evita recursão de RLS e escalada de privilégio).
- **Campanha/rodízio é UUID** (`facebook_campaigns.id` → `customers.source_campaign_id`),
  jamais texto de cidade ou keyword.
- Trigger `assign_flow_variant_on_insert` força `flow_variant = 'A'` em todo
  insert — inclusive nos leads criados manualmente pelo painel, que não passam
  por webhook.

---

## 5. Fluxo do lead (o coração do sistema)

### 5.1 Entrada
Anúncio CTWA / QR de parceiro / formulário público → mensagem chega no
**`whapi-webhook`** (ou `evolution-webhook`, mantido em paridade).

O webhook, em ordem:

1. **Dedupe** (`_shared/bot/dedupe.ts`) — descarta reentrega do mesmo
   `message_id`. É *fail-open* de propósito: melhor processar duas vezes
   (idempotência a jusante) do que perder um lead.
2. **Kill switch** (`_shared/bot/global-flag.ts` → `app_settings.bot_global_enabled`).
3. **Identificação/criação do lead**, atribuição de consultor (rodízio via RPC
   `rodizio_assign_lead` quando a campanha é de parceiro).
4. **Guardas de silêncio**: `assigned_human_id` (handoff humano), `do_not_contact`,
   `bot_paused`.
5. **Roteamento conversacional** (`handlers/conversational/`) — máquina de
   estados do cadastro.

### 5.2 Máquina de cadastro (Grupo A)
Sequência: saudação → qualificação (valor da conta) → pedido da **conta de luz**
→ OCR → pedido do **documento** (RG/CNH/CIN) → OCR → confirmação dos dados →
`finalize-capture` → fila do **worker-portal-2** → OTP por SMS → contrato.

Peças relevantes:

- `cadastro-input-classifier.ts` — decide se o que chegou é foto, número,
  pergunta, objeção ou ruído.
- `kb-answer.ts` — responde FAQ/atalhos do consultor em modo **determinístico**
  (`kbOnly`), sem IA livre: um "oi" ou um nome próprio nunca vira resposta inventada.
  Roda **antes** de empurrar o próximo passo, para o lead não ser atropelado.
- `ocr-fallback.ts` / `OcrReviewBanner.tsx` — quando o OCR fica duvidoso e o
  consultor está em modo manual, abre um modal **bloqueante** com timer de 60s;
  se ele não decidir, um cron libera automaticamente ("pedir ao cliente"), de
  modo que o lead nunca fica esperando.
- `low-bill-reentry.ts` — lead pausado por conta < R$100 volta ao Grupo A se
  reaparecer com valor ≥ R$100 ou intenção de cadastro. Handoff humano e
  `do_not_contact` nunca religam.

### 5.3 Cadência A/B/C (`_shared/cadence-engine.ts` + `cadence-tick`)
`STAGE_MAP` é uma tabela de estados: cada estágio declara `channel`,
`delayHours`, `next`, `requiresBusinessHours`, `skipIfEngaged`.

- **Grupo A** — chat quente. Silêncio → `A_NUDGE` (WA) → `A_SMS` → `A_CALL` →
  `A_CALL_RETRY` → cai para B. **Cap ilimitado**, é inbound.
- **Grupo B** — onda curta de reengajamento D+1…D10 (`COLD_*`, `SMS_*`, `CALL_*`).
  Cap diário `cap_b` (default 150).
- **Grupo C** — escada longa de recall (60d, 90d, 5m, 8m, 12m, anual). Cap `cap_c` (50).
- **Teto global B+C** `cap_global_outreach` (200) — proteção anti-ban.
  Estourou → **adia para a manhã seguinte (BRT), nunca descarta**; alertas em
  60/85/100% gravados em `automation_skip_log`.

`shouldDispatch()` respeita janela comercial; `computeNextActionAt()` calcula o
próximo `next_action_at`; `nextBusinessMorning()` faz o adiamento.

### 5.4 Anti-ban (`_shared/anti-ban.ts`)
Toda função que envia chama `checkSendQuota(instance)` antes e `registerSend()`
depois. A RPC `check_send_quota` aplica:

- **Warmup**: número novo começa em 20 msgs/dia e sobe até 600 em 14 dias.
  Reconexão do *mesmo* número preserva o ramp (`evolution-webhook/handlers/connection.ts`).
- Intervalo mínimo entre mensagens (60s → 18s conforme maturidade).
- Recovery mode (14 dias após ban/troca de chip) e circuit breaker por falhas recentes.
- **Fail-closed**: erro de RPC bloqueia o envio — pausar disparo é mais barato
  que queimar o chip do consultor.
- Evolution **não** envia botão nativo (maior causa de ban): `sendButtons` vira
  texto numerado e o inbound remapeia `1/2/3` para o `button.id`.

### 5.5 Conversão e pós-venda
Cadastro efetivado → `sync-igreen-customers` traz a carteira real da iGreen →
o contato passa a ter `customer_origin = igreen_sync` + `pos_venda_stage`.
A partir daí só o `pos-venda-auto-progress` (D30…D210) fala com ele.
`cadence-tick` e `daily-reheat` têm a mesma trava canônica de cliente, com log
`cliente_pos_venda` em `automation_skip_log`.

---

## 6. Outros subsistemas

| Subsistema | Entrada | Peças |
|---|---|---|
| **Meta Ads / Cérebro** | `facebook-*` (≈40 funções) | criação de campanha, rodízio, waste guard, CPL watchdog, CAPI |
| **Voz/SMS** | Velip | `voice-dialer-*`, `voice-sms-send`, DNC obrigatório via `assertCanContact` |
| **Carteira** | Stripe | `wallet-create-topup`, `wallet-stripe-webhook`, `wallet-manual-credit` (claim atômico `status='pending'` contra duplo clique) |
| **Solar 3D** | Google Solar API | `solar-*`, feature flag `solar_3d_enabled` por consultor, key só no servidor |
| **Suporte remoto** | código de acesso | `remote-support-*` |
| **Observabilidade** | crons | `super-admin-alerts` (avisa `identity_missing` / `send_failed` no WhatsApp do super admin), `production-health-snapshot`, `bot-loop-watchdog` |

---

## 7. Como o dado atravessa o sistema (resumo visual)

```
Meta Ads / QR parceiro / página pública
        │  (Click-to-WhatsApp)
        ▼
whapi-webhook ──dedupe──kill switch──rodízio──▶ customers (flow_variant = A)
        │
        ▼  máquina conversacional (FAQ/atalhos → passo do cadastro)
   OCR conta + documento ──▶ finalize-capture ──▶ worker-portal-2 (fila Redis)
        │                                              │
        │  silêncio                                    ▼ OTP + contrato
        ▼                                        cadastro iGreen
 cadence-tick (A → B → C, caps + anti-ban)             │
        │                                              ▼
        └──── engajou ────▶ volta ao Grupo A     sync-igreen-customers
                                                       │
                                                       ▼
                                            CLIENTE → só pós-venda D30…D210
```

---

## 8. Regras que quebram produção se ignoradas

1. Whapi é o canal primário; `whatsapp_instances.needs_reconnect` **não** significa offline.
2. Protocolo `2026-####` existe só no banco/admin — nunca vai em mensagem de WhatsApp.
3. Portal 2 é o único cadastro vivo (Portal 1 morto em 06/2026).
4. Não ligar motor/envio em massa novo sem pedido explícito; E2E com envio real
   sempre começa em `dryRun`.
5. Cores/sombras só via tokens semânticos do design system — nada de `text-white`
   ou `bg-[#hex]` em componente (quebra tema claro/escuro).
6. Rollback de emergência, nesta ordem: `live_dispatch` → `daily_reheat.enabled`
   → `cadence_engine` → `bot_global`.

---

## 9. Como validar antes de subir

```bash
npx tsgo --noEmit                 # tipos
npx eslint . --quiet              # erros de lint
npx vitest run                    # ~677 testes de front/libs
deno test supabase/functions/     # ~1585 testes de edge functions
npm run build                     # build de produção
```


## Diagnóstico

Hoje o hub (`AgendamentosTextosDialog`) tem 40 itens no catálogo, mas **11 deles apontam para tela externa** (`fonte: "externo"`) e vários grupos inteiros ficam de fora da edição inline:

| Fonte | Linhas no banco | Hoje no hub |
|---|---|---|
| `consultant_message_templates` | 20 chaves | ✅ inline |
| `cadence_stage_config` | 9 stages | ✅ inline |
| `reactivation_templates` | 1 | ✅ aba própria |
| `conversion_phrase_catalog` | 27 | ✅ aba própria |
| `kanban_stages` (pós-venda) | 95 | ✅ aba própria |
| **`bot_flow_steps.message_text`** | **197** | ❌ só link externo |
| **`bot_flow_qa` (perguntas/respostas)** | **535** | ❌ só link externo |
| **`voice_templates` (TTS/SMS por campanha)** | **1+** | ❌ só link externo |
| **`message_templates` (respostas rápidas do chat)** | **23** | ❌ só link externo |
| **`bulk_campaigns.message_text`** | várias | ❌ só link externo |
| **`scheduled_messages.message_text`** | várias | ❌ só link externo |

Ou seja: os 4 grupos mais volumosos (fluxos, FAQ, voz, chat/campanhas) ficam de fora — e são justamente os que o usuário está pedindo.

## Objetivo

Fazer com que **100% dos textos** que a plataforma pode enviar apareçam e sejam editáveis dentro do próprio hub, sem precisar sair para outra tela. Manter o comportamento atual: salvar sempre grava override do consultor, envio automático segue dependendo do toggle correspondente.

## O que muda

### 1. Novas abas no dialog (`AgendamentosTextosDialog.tsx`)

Adicionar, ao lado das abas existentes (Catálogo / Reaquecimento / Frases / Pós-venda):

- **Fluxos** — lista `bot_flow_steps` (agrupada por fluxo A/B/C/D e por `step_key`), textarea inline para `message_text`, salva no próprio row. Filtro por fluxo + busca.
- **FAQ** — lista `bot_flow_qa` (pergunta + resposta), edição inline dos dois campos, filtro por fluxo.
- **Voz/SMS** — lista `voice_templates` + `voice_campaigns.tts_text` / `sms_post_no_answer_text`, edição inline.
- **Chat rápido** — lista `message_templates` (respostas rápidas usadas no chat manual), edição inline.
- **Campanhas** — lista `bulk_campaigns.message_text` + `scheduled_messages.message_text` (últimos 90 dias / ativos), edição inline.

Cada aba segue o padrão já existente das abas Reaquecimento/Frases/Pós-venda: `Textarea` + botão **Salvar** + badge "não salvo", com `drafts` e `saving` já implementados.

### 2. Catálogo atualizado (`src/lib/agendamentosTextosCatalog.ts`)

- Trocar os itens hoje `fonte: "externo"` que passam a ter edição inline para novas fontes tipadas:
  - `ext_fluxos` → `bot_flow_steps`
  - `ext_faq` → `bot_flow_qa`
  - `ext_voz` / `ext_voice_templates` → `voice_templates`
  - `ext_chat_templates` → `message_templates`
  - `ext_bulk` / `ext_agenda` → `bulk_campaigns` / `scheduled_messages`
- Ampliar o `TextoFonte` union com as novas fontes.
- Manter `ext_motor_cadencia` como link externo (é um painel inteiro, não um texto).
- Contador do hub passa a mostrar total real (catálogo + linhas dinâmicas), ex.: "40 fixos + 883 dinâmicos".

### 3. Preservar segurança e escopo

- Todas as queries continuam com `.eq("consultant_id", consultantId)` (ou fallback global). Nenhum consultor edita texto de outro.
- Upserts seguem o padrão atual: quando o registro base é global, cria override do consultor; quando já é do consultor, atualiza direto.
- Nada de mexer em RLS/policies existentes — as tabelas já são acessíveis pelo consultor logado no CRM.

### 4. UX

- Header do dialog vira: **"Todos os textos ajustáveis — 100% do que a plataforma envia"**.
- Cada aba tem busca própria + contador.
- Ícone de aviso amarelo (`AlertTriangle`) quando `is_active = false` ou toggle correspondente está OFF, para o usuário saber que salvar não implica em envio.
- Textareas com contador de caracteres e placeholders com as variáveis suportadas.

## Fora do escopo

- Reescrever o editor de fluxo visual (mantém-se em `/admin/fluxos` para reordenar/duplicar passos).
- Criar novos textos que ainda não existem — o hub edita o que já existe; criação continua nas telas específicas.
- Mudanças em cron/toggles: seguem em `AdminAgendamentosCentral`.

## Arquivos envolvidos

- `src/components/whatsapp/AgendamentosTextosDialog.tsx` — 5 novas abas + loaders + savers.
- `src/lib/agendamentosTextosCatalog.ts` — expandir `TextoFonte`, reclassificar os itens hoje "externo".
- (Sem novas migrations, sem edge functions novas.)


# Auditoria + Correções — Fluxo do consultor `abelolympio`

## Evidências reais do banco (últimas 2 conversas — Silvia 5514981009266 e 5511989000650)

Bugs **confirmados** olhando as mensagens já enviadas pela IA:

| # | Bug | Onde aparece | Causa raiz |
|---|---|---|---|
| 1 | Botão "**Falar com Rafael**" continua aparecendo (linha 13, 71) mesmo no lead do **abelolympio** | step `c87d76f8-f4d2-48ec-ac08-4ef0b3c92834` (bot_flow_steps) e `26b106c7-…` (variante) | A migration de troca "Rafael" → `{{representante}}` ainda **não foi aprovada/executada** |
| 2 | "Já avisei o **abelolympio**" / "Já avisei o **silviaclaudiaalmeida**" | step `aguardando_humano` | Está renderizando username/slug em vez do **primeiro nome** do consultor (`consultants.name`) |
| 3 | Usuário pergunta "Como funciona" (opção 2) e bot responde "*Hoje já somos mais de 700 mil pessoas…*" → **não responde a dúvida** | flow router cai sempre no mesmo próximo step | Opção "Tenho uma pergunta" não tem branch — vai direto pro próximo passo de oferta |
| 4 | Formatação inconsistente: simulação rápida (linhas 48-67) tem **linha em branco entre cada `✅`**, simulação completa (15-26) vem agrupada | `bot_messages.message_text` do step `b1a52222-…` | Texto salvo com `\n\n` entre bullets, sem padrão |
| 5 | `message_type: buttons` enviado mas Evolution provavelmente cacheia como texto sem CTA real | step `d_resultado` | Verificar se `evolution-api.ts sendButtons` está mesmo gerando interactive ou caindo em fallback texto |
| 6 | **Nenhum lead chegou ao portal2 / OTP / assinatura facial** — todas as conversas terminaram em `aguardando_humano` ou paradas | Caminho `aguardando_conta → confirmando_dados → portal_submitting` nunca foi atingido nos testes | Validar fluxo end-to-end com mídia real |
| 7 | `customers.name` fica `nil` mesmo depois de o lead conversar | step de coleta de nome não está rodando | Verificar `name_ask_sent_at` + extractor |
| 8 | Alerta "Novo Lead" não traz qual **persona/IA** está atendendo o lead | `notify-consultant.ts` | Adicionar nome da persona ao payload |
| 9 | Emoji "Posso seguir com vc só clicar em uma opção, mas não tem botão" | Mensagens textuais com emoji `1️⃣ 2️⃣ 3️⃣` mas sem renderizar botão real | Mesmo caso do #5 — Evolution não suporta listas/botões em todos os tipos, precisa fallback claro |

## Plano de execução (3 fases)

### FASE 1 — Auditoria (read-only, ~10 min)

1. **Mapear cada step** que o abelolympio usa hoje (`bot_flow_steps` + `bot_messages`) e marcar:
   - quais textos têm "Rafael" ainda
   - quais usam `{{representante}}` mas não têm fallback
   - quais têm formatação ruim (`\n\n` entre bullets, falta de vírgula, negrito quebrado)
2. **Rastrear caminho até portal2**: ler `aguardando_conta` → OCR → `confirmando_dados_conta` → `portal_submitting` → `flow_template_submissions` → `worker-portal-2` → `igreen-sync` → callback OTP → envio link assinatura facial. Documentar cada gap.
3. **Conferir `notify-consultant.ts`**: confirmar formato do alerta atual e onde injetar persona.
4. **Conferir `evolution-api.ts sendButtons`**: ver se cai em fallback texto silenciosamente.
5. **Gerar relatório** `docs/auditoria/abelolympio-2026-06-26.md` listando: cada step, problema, fix proposto.

### FASE 2 — Correções de conteúdo (data fixes via SQL UPDATE)

1. **Trocar "Rafael" → `{{representante}}`** em todos `bot_flow_steps.message_text` E `bot_messages.message_text` (regexp_replace global). Inclui também as variantes recém-criadas (`b1a52222-…`, `c87d76f8-…`, `26b106c7-…`).
2. **Padronizar formatação** das listas de bullets: remover `\n` duplo entre `✅`, garantir vírgulas e negrito consistente em todos os textos do fluxo D.
3. **Adicionar branch "Tenho uma pergunta"** → roteia para FAQ/IA livre em vez de cair na próxima oferta.
4. **Normalizar mensagem de handoff**: `"Já avisei o {{representante}}. Em breve te chama 👍"` com `{{representante}}` = primeiro nome de `consultants.name`.

### FASE 3 — Correções de código (edge functions)

1. **`renderTemplate` / `render-vars.ts`**: garantir que `{{representante}}` sempre puxa de `consultants.name.split(" ")[0]` (nunca do `origin_instance_name` / username). Adicionar teste.
2. **`notify-consultant.ts`**: incluir `🤖 Atendido por: <persona>` no alerta de Novo Lead. Persona vem de `ai_agent_config.persona_name` (fallback "Aline").
3. **`evolution-api.ts`**: validar `sendButtons` — se Evolution não suportar interactive, logar warning + manter fallback texto com `1️⃣ 2️⃣ 3️⃣`. Documentar limitação.
4. **Coleta de nome**: revisar gatilho em `aguardando_conta` / `confirmando_dados_conta` — gravar `customers.name` quando o OCR ou usuário confirmar.
5. **Simulação E2E** (sem mandar WhatsApp real): rodar 3 cenários scriptados via `supabase--curl_edge_functions` no `evolution-webhook` em dryRun:
   - **Cenário A**: lead manda foto da conta → OCR → confirma → portal_submitting → checar `flow_template_submissions` criada
   - **Cenário B**: portal2 responde OK → checar disparo do OTP via `whapi-superadmin` → confirmar entrega
   - **Cenário C**: OTP confirmado → checar envio do **link de assinatura facial** (`portal_otp_watchdog` ou função equivalente)
   - Gerar `docs/auditoria/abelolympio-e2e-report.md` com latências, erros, screenshots dos payloads.

## Entregáveis ao final
- `docs/auditoria/abelolympio-2026-06-26.md` — mapa completo do fluxo + tabela de bugs
- `docs/auditoria/abelolympio-e2e-report.md` — resultado dos 3 cenários E2E
- 1 migration SQL (UPDATEs em `bot_flow_steps` + `bot_messages` + branch nova)
- Edits em: `notify-consultant`, `render-vars.ts`, `evolution-api.ts`, e step de coleta de nome
- Sem alterações de schema — só dados + edge functions

## Riscos
- Evolution pode não suportar botões interativos no plano atual — nesse caso a melhoria fica só na formatação textual `1️⃣ 2️⃣ 3️⃣` (sem botão clicável).
- Worker portal-2 e watchdog OTP rodam em containers externos; se estiverem offline o E2E falha mesmo com código certo — vou apontar isso no relatório, não tentar consertar infra.
- Mudança no `{{representante}}` afeta TODOS os consultores, não só abelolympio (é intencional).

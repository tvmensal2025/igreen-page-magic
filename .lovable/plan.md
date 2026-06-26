## Plano — pendências da auditoria `abelolympio`

Ordem: do mais barato (texto/SQL) para o mais caro (validação E2E com mídia real). Cada fase verifica antes de seguir.

---

### Fase 1 — Step `d_como_funciona` responder dúvida real

**Problema:** ID `c87d76f8-…` (`step_key = d_como_funciona`) tem `message_text = "Hoje já somos mais de 700 mil pessoas economizando todos os meses. 👇"` — empurra prova social em vez de responder "como funciona". Os botões já estão certos (`Quero me cadastrar`, `Tenho uma pergunta`, `Falar com {{representante}}`).

**Ação:**
1. Trocar `message_text` por uma explicação curta e real do modelo iGreen (3-4 linhas: você continua recebendo da mesma distribuidora, a iGreen aplica desconto via energia limpa, sem obra/troca de fiação, economia média 12-20%). Texto vai ser revisado pelo usuário antes do UPDATE.
2. Adicionar capture `ai_answer: true` no step para que, se o lead digitar texto livre em vez de escolher 1/2/3, a IA (handler `conversational`) responda a dúvida em vez de só re-listar botões. Padrão já usado no step `d_duvidas`.
3. UPDATE via tool `insert` (não é schema change).

**Verificação:** rodar a skill `vendedora-e2e-conversations` com um cenário que pergunta "como funciona?" e conferir que a resposta faz sentido + os 3 botões aparecem no final.

---

### Fase 2 — Separar `display_name` do `username` em `consultants`

**Problema:** `consultants.name = "abelolympio"` (slug de login) é usado como nome do representante. O fix atual em `render-vars.ts` só evita vazar — o ideal é ter o nome humano.

**Ação:**
1. Migration: adicionar coluna `display_name TEXT` em `consultants` (nullable, sem default).
2. Backfill: `UPDATE consultants SET display_name = name WHERE display_name IS NULL AND name ~ '\s'` (só copia onde já tem espaço, ou seja, já é nome humano). Casos slug-like ficam NULL para o admin preencher.
3. Atualizar `_shared/render-vars.ts`: ordem de preferência para `{{representante}}` vira `display_name` → `name` (se não for slug) → "consultor". A heurística slug-like fica só como fallback.
4. UI: adicionar campo "Nome de exibição" no formulário de edição do consultor (Super Admin). Mostrar dica: "Como o lead vai te chamar nas mensagens (ex.: Abel Olympio)".
5. Preencher manualmente `display_name = 'Abel Olympio'` para o consultor `f9594900-…` como exemplo.

**Verificação:** rodar nova simulação e conferir que botões mostram "Falar com Abel Olympio" e notificação NOVO LEAD mostra "Já avisei o Abel Olympio".

---

### Fase 3 — Validação E2E portal2 + OTP + link de assinatura facial

**Problema:** nenhum lead atingiu `portal_submitting` nos testes — não há prova de que o pipeline `flow_template_submissions → worker-portal-2 → iGreen API → callback OTP → portal_otp_watchdog → link assinatura facial` funciona ponta a ponta.

**Ação:**
1. Disparar conversa manual no número `14933005667` (ou número de teste do usuário) seguindo o fluxo: "1" (simular) → "1" (completa) → enviar foto real de conta de luz.
2. Acompanhar em tempo real:
   - `bot_flow_steps` transições via `bot_step_transitions` (lead deve passar por `aguardando_conta` → `confirmando_dados_conta` → `portal_submitting`).
   - Logs da edge `evolution-webhook` (confirma OCR + insert em `flow_template_submissions`).
   - Tabela `flow_template_submissions` (row criada, `status` evolui).
   - Logs do `worker-portal-2` (container externo) — se offline, parar e avisar.
   - `portal2_audit_traces` (passo a passo do worker no portal).
   - Recebimento de OTP via `whapi-superadmin` (mensagem para o lead).
   - Após digitar OTP: `portal_otp_watchdog` dispara → mensagem com link de assinatura facial chega no WhatsApp do lead.
3. Documentar cada gargalo encontrado em `docs/auditoria/abelolympio-2026-06-26.md` (seção nova "Validação E2E 2026-06-XX").
4. Se algum passo falhar: abrir issue separada com logs e propor fix.

**Verificação:** screenshot da conversa do lead recebendo OTP + link de assinatura facial + row em `flow_template_submissions` com `status = completed` (ou equivalente).

---

## Detalhes técnicos

- **Tabelas tocadas:** `bot_flow_steps` (UPDATE row `c87d76f8…`), `consultants` (ALTER + UPDATE).
- **Código tocado:** `supabase/functions/_shared/render-vars.ts`, UI do Super Admin (form do consultor — arquivo a ser localizado em `src/pages/super-admin/`).
- **Sem mudança em RLS** — `consultants` já tem políticas.
- **Risco fase 3:** worker externo `worker-portal-2` pode estar offline; nesse caso documentamos e paramos sem propor fix no código (é infra).
- **Sem novas migrations destrutivas.**

## Saída

- 1 migration (Fase 2 — ALTER TABLE).
- 2 UPDATEs via insert tool (Fase 1 message_text + Fase 2 backfill/exemplo).
- 1 PR de código (render-vars + UI).
- Relatório de auditoria atualizado.

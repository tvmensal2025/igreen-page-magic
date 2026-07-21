# Validação Geral — Deixar o Sistema 100% Funcional

Objetivo: rodar uma **auditoria viva** (dados reais + código real) em tudo que mexemos nas últimas sessões, gerar um **relatório de status por área** e corrigir apenas o que estiver comprovadamente quebrado. Nada de mudança especulativa.

---

## 1. Áreas a validar

Cada área tem: **o que checar**, **como checar** e **critério de OK**.

### A. Motor de Cadência (A → B → C)

- `daily_reheat_settings.enabled` e `live_dispatch_enabled` = true
- `automation_toggles` dos 9 estágios (CALL_1..RECALL_YEARLY) ligados
- `cadence_stage_config` sem `enabled=false` onde o toggle está ON
- `lead_cadence_state`: contagem por `next_stage`, `next_run_at` dentro da janela 08–20 BRT seg–sex
- `journey_runs`: leads em A avançam para B após simulação, B → C após cadastro
- **OK se:** dry-run do `cadence-tick` retorna leads elegíveis em cada estágio e nada fora da janela.

### B. Textos & Áudios (Grupo A e Grupo B)

- `cadence_stage_config.message_text` reflete o que está salvo no `MultichannelTextsPanel`
- `voice_audio_clip_id` presente para todos os estágios de voz (CALL_1, CALL_2, CALL_3, recalls)
- `bot_flow_steps` (Grupo A) espelha o painel via `syncCadenceLibraryToStageConfig`
- `{{consultor_phone}}` renderiza `wa.me/…` no cadence-tick
- **OK se:** `loadCadenceGaps()` retorna array vazio E os textos exibidos no `/admin/textos` batem com o banco.

### C. Agendamentos / Pizza

- `AgendamentosHub` mostra os mesmos N leads que a Pizza (`cycleEligibility`)
- Preview mostra texto + áudio + botões de WhatsApp
- Nenhum agendamento em horário proibido (`clamp_to_business_window_brt` ativo)
- **OK se:** soma de canais na Pizza = total do Hub, e amostras de 5 agendamentos abrem preview completo.

### D. Fluxo Sofia (Portal → OTP → Facial)

- Confirmação de dados é sempre do cliente (nunca do consultor)
- OCR com 3 retries
- `tryInterceptOtp` dispara link facial automaticamente após `validating_otp`
- Watchdog não pula etapas
- **OK se:** um lead real (ex.: 11971254913) percorre A→B→C sem takeover indevido.

### E. Meta / Ads

- `platform_facebook_account` conectado, token não expirado
- `facebook_metrics_daily` populando `messaging_conversations_started`
- Card "Leads / Conversas Meta" com valor > 0 nos últimos 7 dias
- **OK se:** CPL calculado bate com gasto/conversas.

### F. Tema Claro & Contraste

- `ThemeContext` travado em `light`
- Sem uso de `bg-black`, `text-white`, `dark:` hardcoded em componentes tocados
- Banners de alerta com contraste AA (amber-50/900, emerald-50/900)
- **OK se:** varredura `rg "dark:|text-white|bg-black"` em src/components/admin retorna apenas ocorrências legítimas.

### G. Mobile / ForceDesktopLayout

- Cockpit de Conversão renderiza em 1280px virtual e escala para viewport real
- KPIs, abas e cards sem sobreposição no preview mobile
- **OK se:** screenshot Playwright 360×800 mostra layout íntegro (sem colisão).

### H. Checklist do Dashboard

- `runZeroLeadAutoAudit` marca automaticamente itens já resolvidos
- Percentual > 0% (hoje aparece 0% mesmo com muita coisa pronta)
- **OK se:** ao abrir `/admin/checklist`, o % reflete o estado real do banco.

---

## 2. Método de execução

1. **Leitura de dados reais** via `supabase--read_query` para cada área acima (queries pequenas e diretas, sem alterar nada).
2. **Dry-run** do `cadence-tick` (edge function) para ver leads elegíveis.
3. **Playwright headless** em `/admin/agendamentos`, `/admin/conversao` (mobile e desktop), `/admin/checklist` — screenshots + leitura de DOM.
4. **Cross-check** entre o que a UI mostra e o que o banco tem.
5. Consolidar em um **relatório** com: ✅ OK / ⚠️ divergência / ❌ quebrado, com evidência (query result ou screenshot) em cada linha.

## 3. Correções

Só depois do relatório, listo os itens ❌/⚠️ com **fix mínimo** para cada um e aplico em uma única rodada, sem tocar em nada verde.

## 4. Entregável final

- Relatório de status por área (A–H) no chat.
- Lista de correções aplicadas, com o arquivo/tabela tocado.
- Confirmação final: "sistema 100% pronto para produção" ou lista curta de pendências que dependem de decisão sua (ex.: subir áudio faltante, aprovar texto).

## 5. Fora do escopo desta rodada

- Novos features.
- Refactor amplo (ex.: unificar `daily_reheat` vs `cadence_engine`) — só sinalizo se aparecer como bloqueio real.
- Mudanças de design/tema além de contraste comprovadamente quebrado.

---

Confirma que sigo com essa validação? Se quiser priorizar uma área (ex.: começar por Agendamentos/Pizza), me diz e ajusto a ordem.  
  
LISTAR PRIEMIR PARA VALIDAR, ASSIM QUE LISTOU, ENTRA E VERIFICA A INFORAMCAO
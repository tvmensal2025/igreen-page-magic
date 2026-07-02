# Auditoria profunda do sistema — 02/07/2026

Varri banco, crons, logs de Edge Functions, AI Gateway, portal iGreen e instâncias WhatsApp. Resultado abaixo. Não é 100% ainda — tem 3 pontos que precisam de mão antes de abrir para muitos consultores novos.

## Verde (funcionando)

- **Kill switch global**: `bot_global_enabled = true`, `super_admin_phone` preenchido (`5511989000650`), `super_admin_instance_name = Consutor-alertas`.
- **Crons pg_cron**: 39 jobs agendados, todos `active=true`. Nenhuma execução com `status != succeeded` nas últimas 2 h.
- **AI Gateway**: 0 requests com erro nos últimos 7 dias. Custo 24h ≈ US$ 0 (2 chamadas).
- **Sync iGreen**: última run OK em 01/07 23:16 (~2 h atrás).
- **Portal iGreen 48h**: 2 sucessos, 1 falha — e a falha é "instalação já cadastrada" (comportamento esperado, tratado como validation_error sem retry infinito).
- **Mídia inbound**: 0 falhas nas últimas 24 h; nenhum retry pendente.
- **Engine v3 / Fluxo D**: sem erros em `engine_logs` recentes.
- **CORS, cache-bust, Guard de Retomada, meta-ctwa-fallback, anexo garantido**: todos deployados.

## Amarelo (funciona, mas incomoda)

- **2 leads "parados" há >1 h** com bot ativo em step diferente de welcome/end. Watchdog `bot-stuck-recovery-5min` deveria destravá-los; vale conferir manualmente.
- **Watchdog `portal-otp-watchdog**`: loga `quota bloqueada whapi-superadmin: instance_not_found` a cada 30 s. É ruído — a instância `Consutor-alertas` do super admin está `connected`, mas o watchdog procura o nome errado. Ajustar o lookup evita poluir os logs (custo baixo, cosmético).

## Vermelho (bloqueadores para escalar)

1. **Instância do Rafael (`igreen-0c2711ad4836`) em `needs_reconnect` desde 25/06**. Enquanto não reconectar, o Super Admin **não envia mensagens** — leads chegam, mas ninguém responde pelo canal principal. Precisa reescanear o QR em `/admin/whatsapp`.
2. **Instância órfã `igreen-f9594900e75b` com `fatal_lock_until = 2126-06-28**` (100 anos no futuro). É a mesma da auditoria anterior; segue lá. Enquanto não limpar, essa instância nunca volta.
3. **Instância `igreen-4aa4c026d754` em status `unknown**` há 4 dias. Provavelmente ficou órfã — sem `instance-health-cron` conseguir classificar. Precisa validar se ainda pertence a algum consultor ativo ou se pode ser removida.

## O que fazer para ficar 100%

Em ordem de impacto:

```text
[1] Rafael reconecta WhatsApp em /admin/whatsapp     (usuário)
[2] Limpar fatal_lock da instância f9594900e75b       (SQL 1 linha)
[3] Reclassificar/remover instância 4aa4c026d754      (revisão manual)
[4] Corrigir lookup do portal-otp-watchdog           (patch edge fn)
[5] Investigar os 2 leads parados >1h                 (verificação pontual)
```

Detalhes técnicos por item:

- **[2]** `UPDATE whatsapp_instances SET fatal_lock_until = NULL WHERE instance_name = 'igreen-f9594900e75b';` (migration).
- **[3]** Confirmar dono via `consultants.instance_name`; se ninguém, `status='disabled'` e sair do pool.
- **[4]** Em `supabase/functions/portal-otp-watchdog/index.ts`, resolver o nome da instância do super admin a partir de `app_settings.super_admin_instance_name` em vez do literal `whapi-superadmin`.
- **[5]** `SELECT id, conversation_step FROM customers WHERE bot_paused=false AND updated_at < now()-interval '1 hour' AND updated_at > now()-interval '24 hours' AND conversation_step NOT IN ('welcome','end','completed');` — ver se são leads reais ou sandbox.

## Resposta direta

**Não está 100%**. Está ~90%. O único bloqueador operacional real é o [1] (Rafael reconectar). Os itens [2]–[5] são higienização; podem entrar num único PR.

Aprove esse plano que eu já entro em build mode e resolvo [2], [4] e [5] (código + SQL). [1] e [3] dependem de você/consultor.  
  
irei conectar depois

&nbsp;
# Auditoria — Sincronização iGreen por consultor

## O que já está 100% certo

1. **Credenciais por consultor (isolado)**
  `IGreenConnectionCard` (Admin → Configurações) grava `igreen_portal_email` + `igreen_portal_password` na linha do próprio `consultants.id`. A senha nunca é lida de volta (REVOKE SELECT para `authenticated`/`anon`, GRANT apenas INSERT/UPDATE) — o worker lê via `service_role` na edge.
2. **Fluxo de sync individual**
  Botão "Sincronizar agora" → `runIgreenSync(userId,"sync_all")` → edge `sync-igreen-customers` → lê credenciais do próprio consultor pelo `consultant_id` → chama worker green (`worker-igreen-sync`) → persiste tudo com `consultant_id` fixo em cada upsert. Isolamento por consultor confirmado em todas as tabelas.
3. **Persistência completa (`sync_all`)** grava em:
  - `customers` (`onConflict: phone_whatsapp,consultant_id`) — 562 hoje.
  - `igreen_customer_boletos` (`consultant_id,idcliente,mes_referencia`) — 21.
  - `igreen_customer_devolutivas` (`consultant_id,idcliente,campo,categoria`).
  - `igreen_telecom_customers` (`consultant_id,idcnxtelecom`).
  - `igreen_seguros_customers` (`consultant_id,seguro_id`).
  - `igreen_consultant_metrics` (`consultant_id,mes_ref`).
  - `consultant_network` (`consultant_id,igreen_id`).
  - `igreen_automation_settings` (flags de captura, todas `true` por padrão).
  - `settings.last_igreen_sync`.
4. **Cron diário** `sync-igreen-customers-daily` (09:00 UTC) roda `sync_all` para **todos os consultores aprovados que têm email+senha**, em background (`EdgeRuntime.waitUntil`, evitando `504 IDLE_TIMEOUT`).
5. **Fallback OCR / erros do portal** classificados corretamente (`not_configured`, `waf_blocked`, `invalid_credentials`), com mensagens amigáveis no toast.

## O que NÃO está 100% (achados)

**A. Só 1 dos 8 consultores tem credenciais salvas.**  
Verificado no banco: apenas *Rafael Ferreira* possui `igreen_portal_email`/`password`. Os outros 7 (Abel, Bruna, Bryan, elizavip4545, henzofelipef, olimpiajanete15, silviaclaudiaalmeida) nunca configuraram — logo o cron pula eles e a carteira deles fica vazia. **Não é bug**, mas a UI não avisa proativamente.

**B. Card fica escondido em "Configurações".**  
Consultores novos não descobrem sozinhos que precisam ligar o iGreen. Sem badge de status no Admin/Clientes/Central de Agendamentos.

**C. Sem histórico por sync (só `last_igreen_sync` global).**  
Hoje só sabemos o último timestamp global. Não temos, por consultor: quando rodou, quantos boletos/clientes/devolutivas vieram, se falhou (WAF/credenciais). O `igreen_automation_settings.last_sync_*` já tem colunas mas o worker/edge **não estão atualizando elas**.

**D. Nenhum retry automático quando falha.**  
Se o Cloudflare bloqueia (`waf_blocked`) ou o login expira, a edge só devolve erro. Não há reagendamento nem alerta no painel.

**E. Diagnóstico de endpoints exposto só ao Rafael logado.**  
`EndpointDiscoveryCard` só mostra dados globais — não filtra por `consultant_id`, então o admin não sabe *para qual consultor* um endpoint falhou.

**F. Sem validação no `save()`.**  
O card grava email/senha sem testar login antes. Consultor pode salvar credencial errada e só descobrir horas depois no primeiro sync (ou pelo cron silencioso).

**G. Secrets iGreen no consultor, não no vault.**  
`igreen_portal_password` está em coluna `text` (com REVOKE SELECT). Funciona, mas ideal seria criptografar com `pgsodium`/`vault` para defesa em profundidade.

## Plano de melhoria (proposto — pequeno e incremental)

**PR 1 — Status visível por consultor**  

- Novo componente `IGreenSyncStatusBadge` no header do Admin (aba Clientes) e ao lado do botão "Sincronizar":
  - Se sem credencial → CTA vermelho "Ligar iGreen" que abre Configurações no card certo (deep-link `?section=igreen`).
  - Se com credencial → mostra último sync por tabela (boletos/clientes/devolutivas) + contadores.

**PR 2 — Persistir métricas por sync**  

- No worker, ao final de cada bloco (`persistBoletos`, `persistTelecom`, `persistSeguros`, `persistCustomers`, `persistNetwork`, `persistDevolutivas`), atualizar as colunas `last_sync_*` de `igreen_automation_settings` (upsert por `consultant_id`) com timestamp + count.
- Criar tabela leve `igreen_sync_runs (consultant_id, started_at, finished_at, mode, status, counts jsonb, error text)` para histórico dos últimos 30 dias.

**PR 3 — Validação de credenciais no salvar**  

- Adicionar endpoint `POST /validate-credentials` no worker (só login, sem sync).
- No `IGreenConnectionCard.save()`, após salvar chamar `sync-igreen-customers` com `mode:"validate"`; se falhar, exibir toast com motivo específico e marcar `igreen_credential_status` na linha do consultor (`valid|invalid|waf`).

**PR 4 — Retry inteligente + alerta**  

- Se sync falhar por `waf_blocked`, reagendar automaticamente em 15/45/120 min (via `pg_cron` one-shot ou `scheduled_messages`-like).
- Se falhar por `invalid_credentials`, disparar notificação in-app para o consultor + email opcional.

**PR 5 — Diagnóstico por consultor**  

- Filtrar `EndpointDiscoveryCard` por `consultant_id` selecionado; superadmin escolhe consultor no dropdown.
- Adicionar coluna `consultant_id` em `igreen_endpoint_discovery` (se ainda não tiver).

**PR 6 (opcional) — Vault para senha**  

- Migrar `igreen_portal_password` para `vault.secrets` referenciado por `consultants.igreen_password_secret_id`.
- Worker/edge passam a resolver via `vault.decrypted_secrets`.

## Arquivos afetados

- `src/components/admin/IGreenConnectionCard.tsx` (validação inline + deep-link).
- `src/pages/Admin.tsx` (badge de status na aba Clientes).
- `supabase/functions/sync-igreen-customers/index.ts` (modo `validate`, atualização de `last_sync_*`, gravação em `igreen_sync_runs`).
- `worker-igreen-sync/server.mjs` (endpoint `/validate-credentials`, retorno de counts).
- Migração SQL: nova tabela `igreen_sync_runs` + colunas `igreen_credential_status`, `igreen_credential_checked_at` em `consultants`.
- Novo `src/components/admin/IGreenSyncStatusBadge.tsx`.

Nenhuma mudança quebra o fluxo atual — tudo é aditivo. Após o PR 1+2 já teremos visibilidade total do que cada consultor está capturando.  
  
EU AINDA NAO ENSINEI OS OUTROS CONSUTLOTRES, POR ISSO NINGUEM COLOCOU OS DADOS AINDA.
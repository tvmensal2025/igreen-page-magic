# Plano completo de correção das automações sem desligamento

**Projeto:** iGreen Page Magic  
**Data-base da auditoria:** 18/07/2026  
**Objetivo:** corrigir segurança, concorrência, idempotência, autenticação, segmentação, conteúdo e observabilidade mantendo as automações disponíveis durante todo o rollout.

> Aviso técnico: nenhum sistema distribuído pode receber garantia matemática de “zero erro” diante de falha de provedor, rede ou infraestrutura. Neste plano, “100% seguro” significa: nenhum envio sem autorização; no máximo um efeito por ação lógica; falhas fechadas antes do envio; retries controlados; recuperação auditável; nenhuma perda silenciosa; e rollback testado.

## 1. Resultado obrigatório

Ao final, o sistema deve cumprir simultaneamente:

1. Uma ação lógica gera no máximo um envio, ligação, SMS ou notificação.
2. Dois crons concorrentes nunca processam o mesmo item.
3. Motores diferentes nunca tocam o mesmo lead dentro do cooldown configurado.
4. Todo canal respeita kill switch, DNC, pausa humana, origem permitida, janela e público autorizado.
5. Cadência do piloto processa somente DDD 34; telefone inválido vai para revisão, nunca para envio.
6. Toda função interna rejeita chamadas não autenticadas.
7. Todo webhook externo valida assinatura ou segredo antes de produzir efeitos.
8. Toda falha pode ser repetida sem duplicar o efeito externo.
9. Todo envio possui `run_id`, `claim_token`, chave idempotente, origem, resultado e referência do provedor.
10. Nenhum template ativo contém variável não resolvida, identidade errada, mídia ausente ou afirmação comercial não aprovada.
11. Nenhuma automação precisa ser desligada durante a implantação: mudanças entram em shadow, canário e enforcement gradual.
12. O rollback não exige apagar dados nem reverter migrations destrutivamente.

## 2. Regras obrigatórias para a IA executora

- Não alterar produção silenciosamente.
- Não desligar toggles globais para fazer o rollout.
- Não executar deploy local de Edge Functions.
- Aplicar migrations pelo MCP Supabase.
- Implantar Edge Functions pelo GitHub Actions após commit e push autorizados.
- Não commitar `.kiro/settings/mcp.json`.
- Não usar o repositório antigo `igreen-official-portal`.
- Repositório correto: `tvmensal2025/igreen-page-magic`.
- Toda migration deve ser aditiva, idempotente e com rollback lógico.
- Claims e slots de outbound devem falhar fechados: erro de banco significa “não enviar”.
- Nunca registrar telefone, segredo ou texto integral em logs operacionais.
## 3. Diagnóstico que este plano precisa corrigir

A implementação atual possui boas proteções isoladas, mas ainda não forma uma garantia única de ponta a ponta. Os principais problemas são:

- vários workers fazem `SELECT`, enviam ao provedor e só depois atualizam o banco;
- o orquestrador consulta o histórico, mas não reserva atomicamente o lead;
- o helper atual de idempotência é fail-open: erro no banco libera o envio;
- o WhatsApp tem mais travas que voz e SMS;
- alguns callbacks podem ser repetidos e gerar novamente efeitos derivados;
- cadência, reaquecimento, reativação, follow-up, recuperação e watchdog podem disputar o mesmo lead;
- autenticação de cron e webhook ainda possui modo de tolerância;
- há RPCs administrativas com grants mais amplos que o necessário;
- há crons duplicados e funções internas com autenticação própria inconsistente;
- o filtro piloto DDD 34 não está aplicado em todos os caminhos do backend;
- o envio e o registro de auditoria não são uma única operação recuperável;
- parte dos templates ativos possui texto, variável, mídia ou identidade que exige correção comercial;
- instâncias desconectadas ainda precisam de um critério único de exclusão e failover.

A ordem deste documento é obrigatória: primeiro observar, depois reservar, depois impedir duplicidade, depois restringir autenticação e público, e somente então consolidar crons e ampliar o canário.

## 4. Arquitetura-alvo compartilhada

### 4.1 Princípio de segurança

Todo motor deve executar o mesmo protocolo:

1. autenticar a chamada;
2. abrir um `automation_run`;
3. selecionar e reivindicar itens por RPC transacional;
4. revalidar DNC, pausa, origem, público, janela, instância e cooldown;
5. reservar o efeito externo com chave idempotente estável;
6. chamar o provedor somente se a reserva foi adquirida;
7. salvar a referência do provedor e o resultado;
8. finalizar claim e estado de negócio usando o mesmo `claim_token`;
9. enviar falhas definitivas para dead letter;
10. reconciliar leases e resultados ambíguos sem repetir cegamente o envio.

Erro de banco antes do provedor sempre significa **não enviar**. Timeout depois de chamar o provedor significa `unknown`, nunca “falhou, tente de novo”. O reconciliador consulta o provedor quando houver API para isso; sem confirmação, exige revisão manual.

### 4.2 `automation_runs`

Criar tabela compartilhada com:

- `id uuid primary key` (`run_id`);
- `engine_key text not null`;
- `trigger_kind text` (`cron`, `manual`, `retry`, `reconcile`, `shadow`);
- `mode text` (`shadow`, `canary`, `enforced`);
- `auth_reason text` sem gravar o segredo;
- `worker_id text`, `started_at`, `heartbeat_at`, `finished_at`;
- `status text` (`running`, `completed`, `partial`, `failed`, `aborted`);
- contadores `scanned`, `claimed`, `sent`, `skipped`, `failed`, `unknown`, `dead_lettered`;
- `config_snapshot jsonb` somente com configurações não sigilosas;
- `error_code text` e `meta jsonb` sanitizado.

Índices: `(engine_key, started_at desc)`, `(status, heartbeat_at)` e GIN em `meta` apenas se consultas reais justificarem. Retenção: métricas detalhadas por 90 dias e agregados por prazo definido pelo negócio.

### 4.3 `automation_claims`

Usar uma tabela genérica para motores sem fila própria; filas próprias recebem as mesmas colunas. Campos:

- `id uuid`, `engine_key`, `logical_key`, `customer_id`, `source_row_id`;
- `run_id`, `claim_token uuid`, `worker_id`;
- `status` (`claimed`, `processing`, `completed`, `released`, `failed`, `unknown`, `dead_letter`);
- `claimed_at`, `lease_expires_at`, `heartbeat_at`, `completed_at`;
- `attempt_no`, `max_attempts`, `last_error_code`, `next_attempt_at`, `meta`;
- `unique(engine_key, logical_key)` para a ação lógica que não pode se repetir.

A RPC de claim deve usar `FOR UPDATE SKIP LOCKED`, gerar token no banco e retornar somente linhas realmente reivindicadas. A finalização deve exigir `WHERE claim_token = p_claim_token AND status IN ('claimed','processing')`. Um worker nunca pode finalizar claim de outro.

Duração inicial recomendada:

- WhatsApp/SMS simples: 10 minutos;
- chamadas e composição de áudio: 20 minutos;
- daily reheat com cadeia de ações: 20 minutos por passo;
- pós-venda com mídia: 15 minutos;
- callbacks: não usam lease; usam evento idempotente permanente.

O valor final deve ser maior que o p99 medido mais margem de 100%. Heartbeat renova lease somente para o token atual.

### 4.4 `outbound_effects`

Criar o registro canônico de todo efeito externo:

- `id uuid`, `idempotency_key text unique not null`;
- `run_id`, `claim_id`, `customer_id`, `consultant_id`;
- `engine_key`, `action_key`, `channel`, `provider`, `destination_hash`;
- `payload_hash`, `template_key`, `template_version`;
- `status` (`reserved`, `sending`, `sent`, `delivered`, `failed_retryable`, `failed_final`, `unknown`, `suppressed`);
- `reserved_at`, `sending_at`, `sent_at`, `delivered_at`, `updated_at`;
- `provider_request_id`, `provider_message_id`, `provider_status`;
- `attempt_count`, `next_reconcile_at`, `error_code`, `meta` sanitizado.

Não salvar telefone puro nem texto integral nessa tabela. A chave é lógica, não temporal. Exemplos:

- cadência: `cadence:{customer_id}:{stage}:{stage_sequence}`;
- follow-up: `process_followups:{customer_id}:{scheduled_followup_version}`;
- reativação: `reactivation:{customer_id}:{template_id}:{sequence_no}`;
- daily reheat: `daily_reheat:{customer_id}:{cycle_date}:{queue}:{step}:{action}`;
- pós-venda: `post_sale:{customer_id}:{stage_key}`;
- pesquisa de encerramento: `attendance_close:{customer_id}:{attendance_session_id}`;
- fallback SMS: `voice_fallback_sms:{target_id}:{terminal_attempt}`;
- notificação de parceiro: `partner_lead:{customer_id}:{partner_id}:{assignment_version}`;
- fluxo de chamada: `make_call:{customer_id}:{step_key}:{business_shift}`.

`business_shift` deve ser calculado em `America/Sao_Paulo` e persistido; não usar `Date.now()` na chave. Se o provedor aceitar chave idempotente, enviar a mesma chave em todas as tentativas.

### 4.5 `automation_dead_letter`

Criar fila de falhas definitivas com `engine_key`, `logical_key`, `claim_id`, `effect_id`, `customer_id`, `reason_code`, `attempts`, `first_failed_at`, `last_failed_at`, `payload_ref`, `status` (`open`, `reviewing`, `requeued`, `resolved`, `discarded`), `resolved_by`, `resolved_at` e `resolution_note`.

Reenfileirar exige admin ou `service_role`, cria novo `run_id`, conserva a mesma chave idempotente e nunca apaga a ocorrência original.

### 4.6 Orquestrador atômico

Substituir `gateProactiveTouch()` + `recordProactiveTouch()` por `reserve_proactive_touch(...)`:

- bloquear a linha lógica do cliente durante a decisão;
- ler cooldown e prioridade na mesma transação;
- considerar claims ativos, efeitos `reserved/sending/unknown/sent` e toques concluídos;
- não ignorar automaticamente o mesmo `source_key`;
- inserir a reserva antes de retornar `allowed=true`;
- retornar `reservation_id`, `claim_token`, `blocked_by`, `reason` e `cooldown_until`;
- finalizar como `sent`, `failed`, `released` ou `unknown`;
- erro SQL retorna bloqueio, nunca permissão.

Modo `shadow`: calcula a decisão nova e a compara com a decisão legada, mas não bloqueia. Modo `enforced`: somente a reserva nova permite envio.

### 4.7 Estados e transições permitidas

Fluxo normal:

`eligible → claimed → effect_reserved → sending → sent → completed`

Fluxos alternativos:

- guard bloqueou: `claimed → suppressed → completed`;
- erro antes do provedor: `claimed → released` ou `failed_retryable`;
- timeout ambíguo: `sending → unknown → reconciled_sent | failed_final | manual_review`;
- lease expirado sem efeito reservado: `claimed → released → novo claim`;
- lease expirado com efeito `sending/unknown`: nunca liberar para novo envio; reconciliar primeiro;
- máximo de tentativas: `failed_retryable → dead_letter`.

Nenhum update direto pode pular essas transições. RPCs de transição devem validar estado anterior e token.

## 5. Migrations aditivas, na ordem obrigatória

Cada migration deve ter `BEGIN/COMMIT`, nomes estáveis, comentários, `IF NOT EXISTS` quando aplicável, `SECURITY DEFINER SET search_path = public`, grants explícitos e consultas de aceite. Não remover colunas, tabelas ou dados durante o rollout.

### M01 — Observabilidade e correlação

Criar `automation_runs`, `automation_claims`, `outbound_effects` e `automation_dead_letter`, seus enums/checks e índices descritos na seção 4. Criar RPCs `start_automation_run`, `heartbeat_automation_run` e `finish_automation_run`.

- Grants: escrita somente `service_role`; leitura para admin por RLS; nada para `anon`.
- Rollback lógico: Edge Functions deixam de escrever nas tabelas; estruturas permanecem.
- Aceite SQL: iniciar/finalizar um run de teste em transação revertida; provar que `anon` não insere; verificar `destination_hash` e ausência de payload sensível.

### M02 — Hardening de grants e RPCs

Inventariar `information_schema.routine_privileges` e revogar `EXECUTE` de `PUBLIC`, `anon` e `authenticated` em RPCs operacionais/administrativas, incluindo claims, reconciliação, quotas e rotinas de classificação que não sejam chamadas diretamente pela UI. Conceder somente a `service_role`. Para RPCs legitimamente usadas pela UI, criar wrapper autenticado com checagem de papel e escopo do consultor.

- Não mudar tudo às cegas: gerar lista antes/depois e testar cada consumidor.
- Toda `SECURITY DEFINER` deve declarar `SET search_path = public` e qualificar objetos sensíveis.
- Rollback lógico: grant anterior pode ser restaurado por migration corretiva documentada, sem apagar objetos.
- Aceite SQL: `has_function_privilege('anon', ..., 'EXECUTE') = false`; chamada com service role funciona; usuário comum não atravessa escopo.

### M03 — Reserva atômica do orquestrador

Estender `proactive_touch_log` ou criar `proactive_touch_reservations` com `reservation_id`, `claim_token`, `status`, `lease_expires_at`, `priority`, `run_id` e `effect_id`. Criar `reserve_proactive_touch`, `finish_proactive_touch` e `reconcile_proactive_touch_reservations`.

- Índices: cliente + status + lease; cliente + concluído recentemente.
- Mesmo source não é exceção automática.
- Lease inicial: 15 minutos.
- Rollback: configuração `retention_orchestrator_mode='shadow'`; código legado continua observável, sem excluir reservas.
- Aceite: duas sessões simultâneas para o mesmo cliente; somente uma recebe `allowed=true`.

### M04 — Claim da cadência e segmentação piloto

Adicionar em `lead_cadence_state`: `claim_token`, `claimed_at`, `lease_expires_at`, `claim_run_id`, `action_sequence`, `last_effect_id`, `review_reason`. Criar `claim_due_cadence(p_run_id,p_limit,p_allowed_ddds,p_shadow)`, `finish_cadence_claim` e `reconcile_stuck_cadence_claims`.

- A RPC seleciona vencidos com `FOR UPDATE SKIP LOCKED`, revalida pausa e retorna telefone para validação no código.
- `action_sequence` aumenta somente ao avançar de ação lógica; retry conserva sequência.
- Índice parcial em `next_action_at` para estados processáveis.
- Lease: 15 minutos para WA/SMS; 25 para voz.
- DDD inválido marca `review_reason='invalid_phone'`, sem avançar ou descartar.
- Rollback: `cadence_claim_mode='shadow'`; colunas ficam sem efeito.
- Aceite: dois claims concorrentes não repetem linha; finalização com token errado afeta zero linhas; DDD 34 entra e DDD diferente fica fora no enforcement.

### M05 — Claims de follow-up, recovery, FAQ e watchdog

Preferir `automation_claims` para não sobrecarregar `customers` com um conjunto de colunas por motor. Criar RPC parametrizada com lista controlada de `engine_key`, mas com query específica por motor dentro do banco; não aceitar SQL ou nome de coluna dinâmico vindo do cliente.

- Logical keys devem incluir a versão do agendamento/evento, não apenas o cliente.
- `process_followups`: versão derivada de `next_followup_at` persistida/normalizada.
- `bot_stuck_recovery`: cliente + step + número da tentativa.
- `bot_followup_checker`: cliente + follow-up ordinal.
- `faq-reengagement-nudge`: cliente + FAQ turn/event id.
- `bot-loop-watchdog`: cliente + lint finding + janela de 6h; alerta e aviso ao lead são efeitos distintos.
- Lease: 10 minutos; watchdog 15 minutos.
- Aceite: duas execuções simultâneas produzem um claim e um efeito por logical key.

### M06 — Claim de reativação

Adicionar sequência explícita a `reactivation_sends`, chave idempotente única e estados `reserved/sending/sent/failed/unknown`. Criar RPC `claim_reactivation_candidates` que aplica limite, debounce, captura manual, origem, pausa e janela antes de reservar.

- Unique recomendado: `(customer_id, template_id, sequence_no, trigger_type)`.
- Não contar linha reservada/failed como envio concluído; contar tentativa separadamente.
- Fuso inválido retorna `invalid_timezone` e não reivindica.
- Lease: 15 minutos.
- Rollback: modo shadow e seleção legada, mantendo índices.
- Aceite: crons de 15 e 60 minutos podem coexistir sem duplicar; depois da estabilidade, consolidar em um.

### M07 — Claim do daily reheat

Estender `daily_reheat_queue` com `claim_token`, `claimed_at`, `lease_expires_at`, `attempt_count`, `last_effect_id`, `last_error_code`, `dead_lettered_at`. Criar `claim_due_daily_reheat`, `finish_daily_reheat_step` e reconciliador.

- Claim somente de `planned`; nunca selecionar `claimed` como se fosse livre.
- Finalização exige token e step original.
- Cada ação do passo possui `outbound_effects` próprio; `start_flow` também precisa de efeito interno auditável.
- Lease: 20 minutos; máximo 3 tentativas antes de dead letter.
- Cap diário deve ser reservado no banco, não contado e decidido em processos separados.
- Aceite: duas instâncias do cron não recebem o mesmo item; um passo parcialmente executado não repete ação já `sent`.

### M08 — Pós-venda e fechamento de atendimento

Para pós-venda, evoluir `customer_auto_message_log` para reserva prévia ou apontá-lo para `outbound_effects`. Unique permanente por `(customer_id, stage_key, stage_version)`. Criar `claim_post_sale_messages`.

Para fechamento, criar `attendance_close_jobs` ou claim por `attendance_session_id`, copiando atomicamente `attendance_auto_close_at` para o job antes de pedir avaliação. Não limpar a origem antes de resultado persistido.

- Leases: 15 minutos.
- Estado `unknown` bloqueia nova pesquisa até reconciliação.
- Aceite: dois crons geram uma mensagem D30 e uma pesquisa por sessão.

### M09 — Voz, callbacks e `make_call`

Adicionar:

- `provider_event_id`/`event_hash` único em tabela `voice_webhook_events`;
- `customer_id` selecionável e indexado em `voice_campaign_targets`;
- `fallback_sms_effect_id` único por target/tentativa terminal;
- `logical_key` único em campanhas originadas por fluxo;
- transições CAS (compare-and-set) para callback, retry e reconciliação.

Criar `ingest_voice_webhook_event`, que insere o evento e informa se é novo; e RPC transacional para aplicar a transição uma única vez.

- `make_call` usa `customer + step + turno` e retorna campanha existente em conflito.
- Callback repetido retorna 200 com `duplicate=true` sem SMS, sem incremento e sem novo log lógico.
- Aceite: replay 10 vezes do mesmo callback altera o target uma vez e produz no máximo um fallback SMS.

### M10 — Notificação idempotente de parceiros

Criar `partner_lead_notifications` com unique `(customer_id, partner_id, assignment_version)`, estados de efeito, ator e `force_reason`. A mudança de parceiro incrementa `assignment_version`; mero retry não incrementa.

- Reserva antes de `sendRawToNumber`.
- `force` cria uma nova revisão somente com justificativa e admin/service; não ignora a chave silenciosamente.
- `dry_run` não reserva efeito, mas exige autenticação e escopo.
- Aceite: chamadas concorrentes produzem um envio; consultor não lê ou notifica lead alheio.

### M11 — Segmentação DDD e quarentena

Criar configuração `automation_audience_rules` com `engine_key`, `mode` (`off`, `shadow`, `enforced`), `allowed_ddds text[]`, `invalid_phone_action`, `consultant_ids`, vigência e ator. Criar `automation_audience_review` para telefones inválidos ou ambíguos, armazenando hash e últimos quatro dígitos, não o telefone integral.

- Seed inicial para `cadence_engine`: `mode='shadow'`, `allowed_ddds=['34']`.
- Backend usa `extractDDD`; não duplicar parser em SQL e TypeScript sem testes equivalentes.
- Rollback: alterar modo para `shadow`, nunca apagar leads.
- Aceite: formatos `+55`, `55`, máscara, JID e número nacional válido resultam em 34 quando correto; inválidos entram em revisão; outros DDDs são observados no shadow e bloqueados no enforced.

## 6. Correções por motor

As mudanças abaixo são cumulativas. “Rollback” significa voltar o motor novo para `shadow` ou usar a implementação anterior sem remover dados.

### 6.1 `cadence-tick`

- **Arquivo/funções:** `supabase/functions/cadence-tick/index.ts`; handler principal, `dispatchWhatsApp`, `dispatchVoiceCall` e `dispatchSMS`.
- **Problema:** seleção não atômica; envio ocorre antes da atualização final; DDD 34 não é filtro de backend; voz/SMS não usam todas as travas globais do WhatsApp; `ctid` usa tempo; falhas podem avançar ou repetir estágio.
- **Banco:** M03, M04 e `outbound_effects`.
- **Implementação:** substituir query `due` por `claim_due_cadence`; revalidar audience e todos os guards depois do claim; reservar efeito por estágio/sequência; passar `run_id`, token e idempotency key aos adapters; avançar estado somente pela RPC final.
- **Canais:** voz e SMS devem chamar a mesma política global de contato, DNC, pausa humana, origem, janela e orquestrador. Um canal bloqueado não autoriza fallback automático sem efeito específico.
- **Timeout/retry:** antes do provider, liberar/reagendar; depois do provider, `unknown` e reconciliar. Máximo 3 tentativas técnicas sem novo efeito lógico.
- **Dead letter:** áudio ausente, telefone inválido persistente, template inválido, provider desconhecido após prazo.
- **Observabilidade:** stage, sequence, channel, guard reason, audience decision, provider ID e próximo estágio.
- **Teste/canário:** duas invocações simultâneas; falha entre send e finish; DDD 34/fora/invalid; WA/voz/SMS com DNC. Canário por consultor e no máximo 5 efeitos/dia inicialmente.
- **Aceite:** uma linha vencida gera no máximo um efeito; somente DDD 34 no enforced; nenhum avanço sem resultado persistido.

### 6.2 `retention-orchestrator`

- **Arquivo:** `supabase/functions/_shared/retention-orchestrator.ts`.
- **Problema:** check e insert separados; mesmo `source_key` é ignorado; erro no registro é absorvido.
- **Implementação:** novo helper retorna reserva, não booleano; falha fechada; `recordProactiveTouch` vira finalização tokenizada; chamadas legadas geram alerta em CI.
- **Chave/lease:** cliente + janela de cooldown; 15 minutos durante envio.
- **Teste:** duas fontes e duas instâncias da mesma fonte em barreira concorrente.
- **Canário/rollback:** comparar decisão legada/nova por 24h; enforcement por consultor; rollback para shadow.
- **Aceite:** uma única reserva ativa por cliente e conflito explicado por `blocked_by`.

### 6.3 `daily-reheat`

- **Arquivos:** `_shared/daily-reheat/plan.ts`, `_shared/daily-reheat/dispatch.ts`, `daily-reheat-cron/index.ts`.
- **Problema:** `loadDueQueuePlans` aceita `planned` e `claimed`; update para claimed não comprova aquisição; cadeia parcial pode repetir; chaves usam `Date.now()`; autenticação difere do helper padrão.
- **Implementação:** `assertCronAuth`; claim RPC de M07; um efeito por ação; não despachar plano sem token; cap da fila B reservado atomicamente; finalizar cada ação e depois o passo.
- **DNC:** calcular guard por ação/canal, não usar apenas canal inferido do plano. Chamada e SMS consultam suas listas e política global.
- **Retry:** continuar do primeiro efeito não concluído; `unknown` bloqueia cadeia; três falhas antes de dead letter.
- **Canário:** manter gates existentes; shadow com live desligado, depois um consultor, fila A limitada e fila B mínima.
- **Aceite:** nenhum `claimed` volta à seleção normal; restart no meio da cadeia não repete áudio, ligação ou SMS.

### 6.4 `reactivation-cron`

- **Arquivo/funções:** `reactivation-cron/index.ts`; `isInsideWindow`, `processAutoReactivation`, `fetchCandidates`.
- **Problema:** dois crons concorrentes; seleção/contagem/envio/insert separados; fuso inválido atualmente permite envio; logs são inseridos depois do provider.
- **Implementação:** fuso inválido retorna false e revisão; claim M06; reserva antes do sender; classificação de outcomes separada do envio; `assertCronAuth` registra reason.
- **Chave/lease:** cliente + template + sequência; 15 minutos.
- **Retry/dead letter:** preservar sequência; timeout vira unknown; máximo configurado usa apenas efeitos enviados, tentativas ficam separadas.
- **Canário:** auto_enabled de um consultor, 5 leads/dia; depois consolidar cron de 15/60 minutos sem depender disso para segurança.
- **Aceite:** duas agendas simultâneas resultam em um envio e fuso inválido em zero envio.

### 6.5 `process-followups`

- **Arquivo:** `supabase/functions/process-followups/index.ts`.
- **Problema:** query em `customers` sem claim; IA e envio podem ocorrer duas vezes; auth manual em vez do padrão; update final não usa versão do agendamento.
- **Implementação:** `assertCronAuth`; claim pela versão de `next_followup_at`; reservar efeito antes do sender; CAS ao limpar schedule, exigindo token e timestamp original.
- **Chave/lease:** cliente + versão do follow-up; 10 minutos, renovável enquanto a IA responde.
- **Retry:** falha de IA pode reagendar sem reservar envio; timeout do sender vira unknown; não incrementar tentativa duas vezes.
- **Aceite:** duas execuções produzem uma chamada lógica à IA e um envio; novo agendamento posterior possui nova versão.

### 6.6 `bot-stuck-recovery`

- **Arquivo:** `supabase/functions/bot-stuck-recovery/index.ts`.
- **Problema:** cooldown não é lock; abandono e status podem disputar com outro worker; envio e incremento são separados.
- **Implementação:** claim cliente + step + tentativa; revalidar `last_bot_reply_at` após claim; reservar efeito; CAS no incremento. A rota manual exige admin e ainda usa claim.
- **Lease:** 10 minutos; heartbeat durante cérebro IA.
- **Dead letter:** três falhas reais ou resposta IA inválida repetida; encaminhar à fila humana sem mensagem duplicada.
- **Aceite:** inbound entre seleção e envio cancela/release o claim; duas instâncias não resgatam juntas.

### 6.7 `bot-followup-checker`

- **Arquivo:** `supabase/functions/bot-followup-checker/index.ts`.
- **Problema:** `followup_count=0` não é reserva; sender pode retornar sem confirmação robusta; histórico e contador são posteriores.
- **Implementação:** claim ordinal; efeito reservado; usar adapter padronizado com resultado explícito; finalizar contador por CAS. Marcação `frio` deve ter ação interna idempotente separada.
- **Chave:** cliente + `followup_ordinal`; lease 10 minutos.
- **Aceite:** replay não envia e não marca frio antes do prazo correto.

### 6.8 `faq-reengagement-nudge`

- **Arquivo:** `supabase/functions/faq-reengagement-nudge/index.ts`.
- **Problema:** disputa com demais follow-ups e pode repetir a mesma dúvida.
- **Implementação:** claim pelo evento/turno FAQ; reserva no orquestrador; efeito antes do envio; cancelar se houver inbound posterior ao evento.
- **Chave:** cliente + `faq_event_id`; lease 10 minutos.
- **Aceite:** um nudge por evento e nenhum nudge depois de resposta humana/lead.

### 6.9 `bot-loop-watchdog`

- **Arquivo:** `supabase/functions/bot-loop-watchdog/index.ts`.
- **Problema:** pausa, conversa queued, fetch, atualização por `customer_id + message_text` e alerta não são uma unidade; textos iguais podem atualizar várias conversas; envio direto contorna gate compartilhado.
- **Implementação:** claim finding; inserir conversa com `.select('id')`; reservar aviso; usar adapter/gate; atualizar delivery estritamente pelo ID retornado; alerta e notificação do consultor com chaves próprias.
- **Chaves:** finding `customer + category + step + janela6h`; aviso `finding + lead_notice`; alerta `finding + handoff`.
- **Timeout:** aviso unknown não deve ser reenviado; pausa e handoff permanecem, com status visível.
- **Aceite:** apenas a conversa criada muda para sent; repetição do lint não duplica alerta nem aviso.

### 6.10 `pos-venda-auto-progress`

- **Arquivo/função:** `supabase/functions/pos-venda-auto-progress/index.ts`; `processCustomer`.
- **Problema:** checa log, envia e insere log depois; duas execuções podem enviar juntas; não usa auth interna padrão nem gate universal completo.
- **Implementação:** `assertCronAuth`; reservar unique antes do canal; revalidar DNC, pausa, owner e instância; mover estágio e reservar mensagem de modo transacional quando possível.
- **Chave:** cliente + stage + versão de aprovação; lease 15 minutos.
- **Conteúdo:** D30/D60/D90/D120 só entram em enforced após revisão comercial específica.
- **Aceite:** dois crons produzem um efeito por marco; `no_channel` é falha recuperável, não prova de envio.

### 6.11 `close-attendance-scheduled`

- **Arquivo:** `supabase/functions/close-attendance-scheduled/index.ts`.
- **Problema:** não autentica com padrão interno; seleciona e pede avaliação antes de reivindicar `attendance_auto_close_at`; soft-fail limpa a flag e pode perder o evento.
- **Implementação:** `assertCronAuth`; criar claim/job por sessão; CAS que consome o timestamp original; reservar pesquisa; limpar agenda só em sent/suppressed definitivo.
- **Chave:** cliente + attendance_session_id; lease 15 minutos.
- **Retry:** rede/timeout unknown; retry apenas após reconciliação; dead letter em 24h não deve ser descarte silencioso.
- **Aceite:** duas execuções enviam uma pesquisa; falha fica rastreável e recuperável.

### 6.12 `speed-to-lead-check`

- **Arquivo:** `supabase/functions/speed-to-lead-check/index.ts`.
- **Problema:** função sem efeito ao cliente ainda pode duplicar alertas e precisa de auth.
- **Implementação:** `assertCronAuth`; unique por cliente + violação SLA; resolver alerta quando houver primeiro atendimento; registrar run.
- **Aceite:** um alerta aberto por violação e nenhum acesso anônimo.

### 6.13 `send-scheduled-messages`

- **Arquivo:** `supabase/functions/send-scheduled-messages/index.ts`; migration existente `20260712233000_auditoria_agendamentos_claim_rastreio.sql`.
- **Situação:** já possui `FOR UPDATE SKIP LOCKED`, mas precisa integrar efeito compartilhado e token por claim.
- **Implementação:** não substituir proteção existente; acrescentar `claim_token`, finalizar por token e reservar `outbound_effects` antes do adapter. Reconciliador não libera item com efeito unknown.
- **Chave:** `scheduled_message:{id}`; lease 15 minutos.
- **Aceite:** worker morto após provider não gera segundo envio automático.

### 6.14 `bulk-scheduler`

- **Arquivo:** `supabase/functions/bulk-scheduler/index.ts`; reconciliador existente na migration de auditoria.
- **Situação:** CAS `queued → sending` é boa base, mas falta efeito canônico e regra para ambiguidade.
- **Implementação:** reservar efeito por target; `claimed_at` e token; reconciliação separa “nunca chamou provider” de “resultado unknown”.
- **Chave:** campanha + target + revision; lease 20 minutos.
- **Aceite:** concorrência não duplica target e stuck reconciliado não repete unknown.

### 6.15 `voice-dialer-cron`

- **Arquivo:** `supabase/functions/voice-dialer-cron/index.ts`.
- **Situação:** CAS para `dialing` já reduz concorrência.
- **Problema:** autenticação não usa helper comum; falha depois do CAS pode ficar ambígua; reconciliação e callback podem disputar transição.
- **Implementação:** padronizar auth; gravar effect/ctid estável antes da chamada; transições por RPC/CAS; incluir `customer_id` em leituras; aplicar gate global completo antes de discar.
- **Chave:** target + attempt ordinal; lease 20 minutos.
- **Aceite:** callback e reconciliador concorrentes resultam numa transição terminal.

### 6.16 `voice-dialer-webhook`

- **Arquivo/funções:** `supabase/functions/voice-dialer-webhook/index.ts`; `MatchResult`, `matchTarget`, handler SMS/voz.
- **Problemas específicos:** `MatchResult` não seleciona `customer_id`, portanto a pausa de cadência recebe null; callback não é idempotente; SMS fallback pode repetir; comparação do segredo não é constante e segredo em query pode vazar em logs.
- **Implementação:** incluir `customer_id` em todos os selects; registrar evento único antes de efeitos; aplicar transição uma vez; reservar fallback SMS; usar `timingSafeEqualStr`; preferir header configurado no provedor e manter query apenas durante transição monitorada.
- **Evento:** ID do provedor quando confiável; caso contrário hash canônico do payload normalizado + tipo.
- **Aceite:** replay retorna 200 duplicate; pausa correta do cliente; um SMS fallback; segredo inválido 401.

### 6.17 `make-call-step`

- **Arquivo:** `supabase/functions/_shared/bot/make-call-step.ts`; `enqueueSingleCampaign`.
- **Problema:** toda execução insere campanha/target novos; não existe chave de negócio.
- **Implementação:** calcular `make_call:{customer}:{step}:{business_shift}`; upsert/claim transacional; em conflito retornar campaign existente; campanha e target devem ser criados na mesma RPC.
- **Turno:** configuração explícita em BRT, por exemplo manhã/tarde, e persistida; não inferir por minuto.
- **Aceite:** 20 chamadas paralelas retornam o mesmo campaign ID e um target.

### 6.18 `notify-partner-leads-batch`

- **Arquivo:** `supabase/functions/notify-partner-leads-batch/index.ts`.
- **Problemas específicos:** token ausente não é rejeitado; owner pode ser inferido do lead mesmo sem usuário; `dry_run` também fica exposto; `force` não exige admin; envio é anterior ao marcador.
- **Implementação:** autenticar primeiro; service role ou usuário válido; dry-run exige login e escopo; consultant só acessa seus leads; `force` somente admin/service com motivo; reservar notificação antes do envio.
- **Chave:** cliente + parceiro + versão da atribuição.
- **Aceite:** sem token 401; consultor alheio 403; concorrência envia uma vez; force auditado.

### 6.19 Webhooks Evolution e Whapi

- **Arquivos:** `supabase/functions/evolution-webhook/index.ts`, `whapi-webhook/index.ts` e `_shared/webhook-auth.ts`.
- **Problema:** `verify_jwt=false` é necessário para provedores, mas a validação de origem pode operar em grace/fail-open.
- **Implementação:** segredo distinto por provedor; assinatura nativa quando disponível; timestamp/nonce contra replay; evento inbound único por provider message ID; medir missing/mismatch em shadow; enforcement depois de confirmar configuração.
- **Segurança:** não confiar em campos de consultant/customer do payload sem resolver vínculo local da instância.
- **Aceite:** payload válido uma vez; replay sem novo turno; segredo ausente/errado 401 no enforced; instância desconhecida é quarentena.

## 7. Autenticação e autorização

### 7.1 Crons

Todas as funções cron devem chamar `assertCronAuth` imediatamente após criar o client administrativo e antes de ler body que possa alterar escopo. Registrar apenas `auth_reason`.

Sequência segura:

1. inventariar jobs `cron.job` e headers;
2. garantir `x-internal-secret` ou `x-service-secret` em todos;
3. observar por 24 horas sem `missing/mismatch`;
4. testar manualmente uma credencial inválida;
5. configurar `ENFORCE_CRON_AUTH=true`;
6. confirmar 2xx dos jobs legítimos e 401 dos demais.

Remover o caminho `legacy_unconfigured` apenas em mudança posterior, após soak. Não expor service role em logs, responses ou arquivos.

### 7.2 Funções manuais

- `dry_run`, `preview` e endpoints de diagnóstico também exigem autenticação.
- Admin pode operar qualquer consultor somente quando a finalidade exigir.
- Consultor só opera registros cujo `consultant_id` corresponda ao seu usuário.
- Parâmetros `force`, requeue, unlock e override exigem admin/service e justificativa auditada.

### 7.3 Webhooks

- Validar assinatura/segredo em tempo constante.
- Preferir header; query string apenas se o provedor não suportar header.
- Aplicar limite de tamanho, content type, método e rate limit.
- Salvar hash do evento, não segredo nem payload bruto com dados pessoais.
- Responder 2xx a duplicatas válidas para impedir tempestade de retry; responder 401 a origem inválida.

## 8. Política única de público, DNC e canais

Criar um helper compartilhado que retorne decisão estruturada: `allowed`, `reason`, `audience_mode`, `ddd`, `origin`, `pause_state`, `dnc_source`, `window`, `instance_health`.

A ordem deve ser:

1. kill switch e modo do motor;
2. autenticação já validada;
3. origem elegível;
4. DDD/público;
5. DNC global e do canal;
6. pausa do bot, pausa temporária e atendimento humano;
7. status terminal e resposta recente;
8. janela comercial/quiet hours;
9. reserva do orquestrador;
10. saúde/cota da instância;
11. reserva do efeito.

WhatsApp, voz, SMS e notificações devem usar a mesma política base, com extensões do canal. DNC de voz não substitui DNC global. Telefone inválido nunca recebe fallback por outro canal.

## 9. Templates e conteúdo

### 9.1 Inventário e versionamento

Criar um inventário exportável de todos os templates em `cadence_stage_config`, `reactivation_templates`, `consultant_message_templates`, `stage_auto_messages`, `pos_venda_default_media`, kits daily reheat e campanhas de voz/SMS. Cada publicação deve gerar `template_version` imutável.

### 9.2 Validador obrigatório antes de ativar

O lint deve bloquear publicação quando houver:

- placeholder fora da allowlist do template;
- placeholder não resolvido no preview;
- texto vazio depois da renderização;
- identidade fixa incompatível com o consultor;
- link `wa.me` sem telefone válido;
- mídia obrigatória ausente ou inacessível;
- áudio de chamada ativo sem `voice_audio_clip_id`/Velip preparado;
- marcação de WhatsApp em SMS;
- afirmação comercial sem aprovação ou validade;
- tamanho acima do limite do canal.

Allowlist mínima: `nome`, `consultor`, `consultor_phone`, `link_wa`, `frase_disponibilidade`, `protocolo`, `valor_conta` somente onde os dados existem.

### 9.3 Correções conhecidas

- corrigir a marcação quebrada de `COLD_1`;
- validar comercialmente “Última semana” de `COLD_3` ou remover urgência;
- remover marcação própria de WhatsApp dos textos SMS;
- corrigir `RECALL_60D_CALL`, que fala “oito meses”;
- trocar identidade fixa “Rafael” por variável dinâmica e fallback institucional aprovado;
- exigir clip/áudio válido em `CALL_1`, `CALL_2` e `CALL_3` antes de enforcement;
- escrever conteúdo específico e aprovado para D30/D60/D90/D120;
- revisar os seis templates institucionais de pós-venda e suas mídias.

### 9.4 Preview e aprovação

Preview deve testar nome presente/ausente, telefone presente/ausente, consultor sem instância e mídia. Aprovação exige autor, revisor comercial, data, hash e versão. Alterar template ativo cria nova versão; efeitos já reservados conservam a versão anterior.

## 10. Instâncias WhatsApp

Implementar um estado operacional único por instância:

- `connected_healthy`: elegível;
- `warming_up`: elegível dentro da cota;
- `degraded`: sem novos envios proativos, apenas reconciliação;
- `needs_reconnect`, `awaiting_qr`, `disabled`, `manual_review`: inelegível;
- `circuit_open`: inelegível até cooldown e revisão.

Regras:

1. health check verifica conexão real, latência, falhas e último inbound/outbound;
2. selector nunca usa instância desconectada;
3. failover somente para instância autorizada do mesmo consultor/tenant;
4. failover não cria nova idempotency key;
5. warmup usa cap e intervalo BRT já corrigidos;
6. três reconexões/6h ou dez falhas/6h abrem circuito conforme regra atual;
7. reabilitação após ban/reconnect exige confirmação manual e smoke controlado;
8. consultor só entra no canário com instância saudável, kit/template válido e telefone conectado confirmado.

Antes de expansão, resolver as instâncias observadas como `needs_reconnect`/`awaiting_qr`; elas não devem ser mascaradas por fallback global.

## 11. Rollout sem desligar as automações

### Onda 0 — Baseline

Sem mudar decisões. Registrar por pelo menos 24h: runs, candidatos, efeitos por canal, duplicatas lógicas detectadas, auth reason, DNC, público, latência p50/p95/p99, falhas, unknown, claims potenciais e saúde das instâncias. Congelar os critérios de comparação.

### Onda 1 — Observabilidade

Aplicar M01. Edge Functions escrevem runs e decisões, mas não mudam envio. Validar que logging não aumenta erro ou latência acima de 10% e não contém PII/segredo.

### Onda 2 — Segurança e grants

Aplicar M02; padronizar auth em código em grace; confirmar todos os crons legítimos. Restringir primeiro RPCs sem consumidor UI; promover lotes pequenos. Enforcement de auth só após zero mismatch legítimo.

### Onda 3 — Claims em shadow

Aplicar M03–M10. Cada motor executa claim simulado/real sem bloquear o legado, mas não pode reservar efeito externo em duplicidade no shadow. Comparar candidato legado versus claim novo. Divergência deve ter reason explícito.

### Onda 4 — Claims enforced

Por motor e consultor, fazer o claim novo ser a única autorização de envio. Ordem recomendada: scheduled, bulk, voice worker, watchdog, follow-ups, reativação, daily reheat, cadência, pós-venda e fechamento. Nunca promover dois motores novos no mesmo dia para o mesmo público.

### Onda 5 — Orquestrador atômico

Ativar reserva compartilhada para o canário. Confirmar que bloqueios esperados não viram perda silenciosa: cada bloqueado recebe `cooldown_until` e volta a ser elegível depois.

### Onda 6 — DDD 34

Rodar M11 em shadow por 24h; revisar falsos inválidos; ativar enforced somente na cadência piloto. Não apagar nem encerrar DDD diferente: apenas não enviar e registrar reason. Expandir para outros motores somente por decisão comercial explícita.

### Onda 7 — Voz e SMS

Ativar efeito compartilhado, callback idempotente e DNC universal. Fazer chamadas de canário para números controlados; replay de callbacks; só então permitir leads reais em lote pequeno.

### Onda 8 — Templates

Publicar versões corrigidas após lint e revisão. Ativar chamadas apenas com mídia válida. Não misturar mudança de texto com mudança de concorrência no mesmo canário.

### Onda 9 — Expansão e soak

Expandir 5% → 10% → 25% → 50% → 100% dos consultores elegíveis. Permanecer no mínimo 24h e pelo menos 100 execuções/efeitos relevantes por degrau; para motores raros, usar no mínimo 7 dias ou testes controlados suficientes.

### 11.1 Gates de promoção

Promover somente se todos forem verdadeiros:

- zero duplicidade lógica confirmada;
- zero envio fora do DDD/público enforced;
- zero envio a DNC, pausado, atendimento humano ou origem proibida;
- zero chamada interna não autenticada aceita no enforcement;
- claims expirados abaixo de 0,5% e todos reconciliados;
- `unknown` abaixo de 0,2%, sem retry cego;
- taxa de erro do provider não piora mais de 20% sobre baseline;
- latência p95 não piora mais de 20%;
- dead letters possuem dono e prazo;
- divergência shadow sem explicação = zero.

### 11.2 Rollback automático

Voltar o motor afetado para implementação anterior ou `shadow`, sem desligar o toggle global, quando qualquer limite acima for excedido, quando houver duplicidade, público indevido ou auth bloqueando tráfego legítimo. O rollback deve ser configuração versionada, auditada e reversível. Não reverter migration nem apagar claims/effects.

## 12. Plano de testes para a implementação futura

### 12.1 Unidade e propriedades

- funções de chave idempotente: mesma ação produz mesma chave; ações distintas não colidem;
- máquina de estados rejeita transições inválidas;
- parser DDD com `+55`, `55`, máscara, JID, 10/11 dígitos, curto, estrangeiro e caracteres;
- timezone válido, DST de outros fusos e timezone inválido fail-closed;
- placeholder allowlist, nome vazio, mídia e links;
- prioridade/cooldown do orquestrador;
- property-based tests com `fast-check` para chaves, telefones, ordem de callbacks e retries.

### 12.2 Concorrência real no Postgres

Usar duas conexões e barreira para chamar simultaneamente cada RPC de claim. Provar:

- um vencedor por logical key;
- `SKIP LOCKED` não bloqueia o lote inteiro;
- token errado não finaliza;
- lease expirado sem efeito pode ser recuperado;
- lease com efeito unknown não é reenviado;
- orquestrador permite somente a maior prioridade conforme regra;
- limite/cap diário não é ultrapassado por corrida.

### 12.3 Falhas injetadas

Para cada canal, simular:

1. erro antes da reserva;
2. erro após reserva e antes do provider;
3. provider responde erro definitivo;
4. provider responde 200 e banco falha depois;
5. timeout ambíguo;
6. processo morre após envio;
7. callback chega antes da atualização do worker;
8. callback duplicado, fora de ordem e atrasado;
9. reconciliador e callback simultâneos.

Resultado esperado deve ser no máximo um efeito e nenhuma perda silenciosa.

### 12.4 Autenticação e autorização

- cron sem header, errado e correto;
- webhook sem segredo, errado, correto e replay;
- chamada como `anon` às RPCs restritas;
- consultor tentando lead de outro consultor;
- dry-run anônimo;
- `force` como consultor e como admin;
- service role somente no ambiente seguro.

### 12.5 Providers e smoke

Usar mocks/fakes locais por padrão. Smoke sem envio real valida seleção, claim, render e payload. Envio real somente a números de teste autorizados, com limite 1, marcação de canário e confirmação humana.

## 13. Validação técnica obrigatória

Executar na raiz, conforme arquivos alterados:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
npx tsc --noEmit
npx vite build
```

Para Edge Functions, executar `deno check` em cada `index.ts` e helper alterado e a suíte Deno usada pela CI. A CI atual valida frontend, módulos Deno selecionados, webhooks, testes unitários/PBT, pureza do engine e formato das specs; ampliar a lista de `deno-check` para todos os motores corrigidos.

Validar migrations em banco descartável/snapshot antes da produção:

- aplicar todas em ordem sobre schema atual;
- aplicar novamente onde a migration promete idempotência;
- executar consultas de grants;
- executar testes concorrentes;
- medir locks e plano dos índices;
- confirmar que nenhum DDL reescreve tabela quente de forma longa;
- revisar advisories de segurança e performance.

Não considerar `build` como prova de concorrência; os testes SQL e replay são obrigatórios.

## 14. Deploy e operação

### 14.1 Antes de produção

1. salvar evidências de baseline;
2. revisar diff e garantir que `.kiro/settings/mcp.json` não está incluído;
3. validar frontend com `npx tsc --noEmit` e `npx vite build`;
4. validar Deno e testes afetados;
5. obter autorização explícita para commit/push/deploy;
6. documentar onda, canário, métricas e rollback.

### 14.2 Banco

Aplicar migrations via MCP Supabase, uma onda por vez. Depois de cada DDL, verificar tabelas, funções, grants, RLS, índices e advisors. Não usar o CLI local para migrations de produção quando o processo definido for MCP.

### 14.3 Edge Functions

O deploy ocorre no repositório `tvmensal2025/igreen-page-magic`, via `.github/workflows/deploy-edge-functions.yml`, após commit e push autorizados para `origin main`. Não usar `supabase functions deploy` local. Mudança em `_shared` pede deploy de todas as funções consumidoras ou `all` conforme workflow.

O `gh workflow run` não é o caminho confiável deste repositório. Usar o dispatch REST já documentado no steering, obtendo credencial pelo helper sem imprimir o token. Depois acompanhar o run e confirmar no Supabase que `updated_at` das funções é recente.

### 14.4 Ordem operacional por onda

1. migration aditiva;
2. verificação SQL;
3. deploy de código em shadow;
4. smoke sem envio;
5. observação;
6. canário por configuração;
7. observação mínima;
8. promoção ou rollback lógico;
9. só depois consolidar cron duplicado.

Nunca remover um cron duplicado antes de claims estarem enforced. Claims tornam a duplicidade inofensiva; a consolidação posterior reduz carga.

## 15. Consultas e evidências mínimas de aceite

A IA executora deve adaptar nomes finais, mas entregar evidências equivalentes:

```sql
-- Nenhuma logical key duplicada
select engine_key, logical_key, count(*)
from public.automation_claims
group by 1,2 having count(*) > 1;

-- Nenhuma chave de efeito duplicada
select idempotency_key, count(*)
from public.outbound_effects
group by 1 having count(*) > 1;

-- Claims vencidos
select engine_key, status, count(*)
from public.automation_claims
where status in ('claimed','processing') and lease_expires_at < now()
group by 1,2;

-- Efeitos ambíguos aguardando reconciliação
select engine_key, channel, count(*)
from public.outbound_effects
where status = 'unknown'
group by 1,2;

-- Verificação de grants (repetir para cada RPC sensível)
select has_function_privilege('anon', 'public.claim_due_cadence(uuid,integer,text[],boolean)', 'EXECUTE');

-- Público do piloto: deve retornar zero no enforced
select count(*)
from public.outbound_effects e
join public.customers c on c.id = e.customer_id
where e.engine_key = 'cadence_engine'
  and e.status in ('sending','sent','delivered')
  and public.extract_ddd_equivalent(c.phone_whatsapp) is distinct from '34';
```

Se não for criada função SQL de DDD, executar a última checagem por script TypeScript/Python usando exatamente o parser de produção. Não introduzir parser SQL só para a consulta.

Relatório por onda deve conter: commit, migrations, functions/deploy run, intervalo observado, consultores do canário, números agregados, queries de aceite, falhas, dead letters, decisão de promoção e responsável.

## 16. Checklist final de produção

### Banco e concorrência

- [ ] Todas as ações externas possuem chave idempotente estável e unique.
- [ ] Todos os motores concorrentes usam claim atômico.
- [ ] Finalização exige token.
- [ ] Reconciliador distingue não enviado de unknown.
- [ ] Dead letter está operacional e possui responsável.
- [ ] RPCs sensíveis não são executáveis por `PUBLIC`, `anon` ou usuário comum.

### Segurança

- [ ] `ENFORCE_CRON_AUTH=true` após zero mismatch legítimo.
- [ ] Webhooks Evolution, Whapi e Velip rejeitam origem inválida.
- [ ] Replay de webhook é idempotente.
- [ ] Dry-run/preview exigem autenticação.
- [ ] Force/requeue exigem admin/service e justificativa.
- [ ] Logs não contêm segredo, telefone puro ou mensagem integral.

### Público e contato

- [ ] Cadência piloto enforced somente para DDD 34.
- [ ] Telefones inválidos estão em revisão, não descartados.
- [ ] WhatsApp, voz e SMS respeitam DNC, pausa, origem, janela e humano.
- [ ] Orquestrador reserva lead atomicamente.
- [ ] Nenhuma instância desconectada é selecionada.

### Conteúdo

- [ ] Templates passaram por lint e preview.
- [ ] Identidade é dinâmica e aprovada.
- [ ] CALL_1/2/3 têm áudio válido.
- [ ] COLD_1, COLD_3, SMS e RECALL_60D_CALL foram corrigidos.
- [ ] Pós-venda D30/60/90/120 foi aprovado comercialmente.

### Operação

- [ ] Testes de concorrência, falha e replay passaram.
- [ ] `npm run lint`, typecheck, tests e builds passaram.
- [ ] Deno check/tests passaram.
- [ ] Migrations passaram em banco descartável.
- [ ] Canário e soak cumpriram tempo e volume mínimos.
- [ ] Dashboard e alertas cobrem duplicate, unknown, stuck e auth mismatch.
- [ ] Rollback lógico foi ensaiado.
- [ ] Nenhum arquivo secreto entrou no commit.

## 17. Matriz de rastreabilidade

| Risco auditado | Correção principal | Teste obrigatório | Evidência de produção |
|---|---|---|---|
| Cadência concorrente | M04 + effect unique | duas sessões no mesmo due | zero logical key duplicada |
| Orquestrador não atômico | M03 + reserva transacional | fontes concorrentes | uma reserva ativa/cliente |
| Voz/SMS fora dos gates | política única seção 8 | DNC/pausa por canal | zero suppressed enviado |
| DDD fora do piloto | M11 + `extractDDD` | matriz de formatos | zero envio fora do 34 |
| Dois crons de reativação | M06 | disparos simultâneos | um efeito/sequence |
| Dois crons de pós-venda | M08 | marco D30 concorrente | um efeito/stage/version |
| Daily reheat `planned/claimed` | M07 | worker duplo/restart | claimed não reselecionado |
| Velip sem `customer_id` | seção 6.16 | callback answered | cadência pausada no cliente correto |
| Callback Velip repetido | M09 | replay 10x | um event/transição |
| SMS fallback duplicado | M09 + effect unique | replay terminal | um SMS/target/attempt |
| `make_call` duplicado | M09 | 20 chamadas paralelas | uma campanha/target |
| Parceiro sem auth | M10 + auth | anônimo/escopo/force | 401/403 e um envio |
| Pós-venda registra depois | M08 | crash após provider | sent/unknown, nunca novo efeito |
| Fechamento sem claim | M08 | dois crons | uma pesquisa/sessão |
| Watchdog atualiza por texto | ID da conversa + claim | textos iguais | uma linha atualizada |
| Timezone inválido permite | fail-closed | timezone inválido | zero envio + review |
| Cron em grace | seção 7.1 | headers válidos/inválidos | 401 inválido, 2xx legítimo |
| Webhook em grace | seção 7.3 | segredo/replay | mismatch zero legítimo |
| RPCs públicas | M02 | teste como anon | privilege false |
| Template incorreto | seção 9 | lint/preview | versão aprovada/hash |
| Instância desconectada | seção 10 | health/failover | zero efeito por instância inelegível |
| Timeout ambíguo | `unknown` + reconciliador | falha pós-provider | zero retry cego |

## 18. Definição de concluído

O trabalho só está concluído quando:

1. todas as migrations e mudanças de código possuem revisão e evidência;
2. todos os motores listados usam o protocolo comum ou têm justificativa documentada;
3. duplicidade, público indevido, DNC e autenticação foram testados de forma negativa;
4. canário e soak atingiram os gates;
5. não há `unknown` ou dead letter sem dono;
6. o sistema continuou disponível durante o rollout;
7. os crons duplicados foram consolidados apenas depois do enforcement seguro;
8. o relatório final liga cada risco à correção, teste e evidência.

Este plano não autoriza alterações de produção por si só. Cada migration, commit, push, mudança de secret, enforcement e deploy exige a autorização e o processo operacional definidos para o projeto.

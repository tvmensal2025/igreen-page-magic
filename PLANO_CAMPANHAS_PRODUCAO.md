# Plano oficial — Campanhas Meta e Disparo PRO

> Status: planejamento validado em código e banco em 14/07/2026.
> Regra: executar em fatias pequenas, com toggles desligados e sem apagar histórico.
> Escopo: anúncios Meta, carteira, métricas, importação e campanhas WhatsApp.

## 1. Objetivo e limites

Tornar o módulo seguro para vários consultores, impedindo mistura de dados, gasto indevido, campanhas duplicadas e disparos não autorizados. “100%” significa cumprir todos os critérios verificáveis deste plano; indisponibilidades da Meta, WhatsApp ou Evolution devem falhar com segurança, sem duplicar efeitos.

Não reativar campanhas existentes durante a implementação. Pausar e encerrar continuam sempre permitidos como ações de contenção.

## 2. Estado confirmado antes da implementação

- 4 campanhas Meta, todas pausadas; nenhuma com orçamento diário ativo.
- Nenhum `fb_campaign_id` duplicado ou associado a consultores diferentes no banco atual.
- Conta Meta da plataforma é compartilhada entre consultores.
- `meta-ads-import` pode atribuir campanhas dessa conta ao usuário chamador.
- `facebook-toggle-campaign` confia na propriedade da linha local.
- Criação e ativação Meta não usam o kill switch universal.
- A tela continua publicando mesmo quando o pré-voo retorna bloqueadores.
- Status `active` local é gravado após solicitar `ACTIVE`, sem confirmar `effective_status`.
- Reserva financeira cobre poucos dias, mas campanha fixa pode comprometer todo o período.
- `facebook-sync-metrics` aceita cron pela mera presença de `apikey`.
- RLS permite escrita direta do dono em campanhas e alvos.
- Disparo PRO possui toggle, proteção de telefone, anti-ban e claim atômico; faltam idempotência e deduplicação estrutural.
- Métrica `leads` usa conversa iniciada como fallback; isso deve ser separado no painel.

## 3. Invariantes que nunca podem quebrar

1. Um ID Meta pertence a exatamente um consultor.
2. Consultor A nunca lê, importa, cobra, ativa ou pausa recurso de B.
3. Nenhuma operação mutável ocorre sem autenticação, propriedade e toggle permitido.
4. Toggle desligado bloqueia criar/ativar/importar/enviar; pausa, stop e leitura continuam disponíveis.
5. O mesmo pedido lógico gera no máximo uma campanha, um débito e um envio por alvo.
6. Saldo disponível nunca fica negativo nem é reservado por duas campanhas.
7. Estado local distingue `draft`, `creating`, `pending_review`, `active`, `paused`, `rejected`, `completed`, `failed` e `reconciliation_pending`.
8. `active` só é exibido após confirmação de `effective_status` da Meta.
9. Conversa, lead identificado, qualificado, proposta e venda são métricas distintas.
10. Toda mudança é aditiva e reversível até a fatia final; nenhum histórico é apagado.

## 4. Estratégia de execução

Cada fatia segue: inventário somente leitura → migration aditiva → código em modo sombra → testes → deploy com toggle OFF → validação → piloto controlado → liberação gradual. Não agrupar várias fatias críticas no mesmo deploy.
## 5. Fatias de implementação

### F0 — Congelamento e linha de base

**Mudança:** nenhuma mutação funcional. Manter campanhas e automações pausadas; gerar consultas de baseline para campanhas, métricas, carteiras, transações, crons e policies.

**Validação:** confirmar zero campanha ativa; toggles de envio OFF; registrar contagens e somas financeiras. Não exportar tokens ou PII.

**Rollback:** não aplicável.

### F1 — Propriedade autoritativa Meta (P0)

**Banco, de forma aditiva:**
- Criar `facebook_campaign_ownership` com `fb_campaign_id`, `ad_account_id`, `consultant_id`, `local_campaign_id`, `source`, timestamps e auditoria.
- `UNIQUE (fb_campaign_id)` global; FKs para campanha e consultor.
- RLS somente leitura para o dono; escrita apenas por service role/RPC validada.
- Fazer backfill dos 4 vínculos atuais, abortando migration se houver ambiguidade.

**Backend:**
- Criar helper único `assertMetaCampaignOwnership`.
- Usar em create, toggle, delete, extend, targeting, rodízio, sync, status, auto-pause e métricas.
- `meta-ads-import`: somente super admin; importar apenas após associação explícita ou label/protocolo autoritativo. Nunca usar fallback compartilhado para determinar dono.

**Compatibilidade:** manter `facebook_campaigns.consultant_id`; a tabela nova inicialmente valida em modo sombra. Só depois vira autoridade.

**Aceite:** dois consultores na mesma ad account não acessam recursos um do outro; conflito de `fb_campaign_id` retorna 409 antes de chamar a Meta.

**Rollback:** desabilitar enforcement novo, preservar tabela e vínculos para diagnóstico.

### F2 — Gates e autenticação interna (P0)

**Toggles novos, default OFF:** `facebook_campaign_create`, `facebook_campaign_activate`, `facebook_campaign_import`, `facebook_metrics_sync`, `facebook_automatic_optimization`.

**Backend:** aplicar `isAutomationEnabled` antes da primeira mutação e antes da ativação. Pausa/stop nunca dependem do gate. Criar autenticação interna por segredo dedicado para crons e rejeitar somente `apikey`; consultor autenticado só sincroniza o próprio ID.

**Crons:** migrar comandos sem colocar segredo literal em migration ou Git; usar mecanismo seguro do projeto/Vault. Primeiro criar cron paralelo desativado, validar, depois substituir o antigo.

**Aceite:** toggle OFF produz zero POST mutável à Meta; anon key não inicia sync global; segredo inválido retorna 401/403; pausa continua funcionando.

**Rollback:** desligar novos toggles e retornar o cron ao job anterior somente se necessário; manter campanhas pausadas.

### F3 — Pré-voo bloqueante e estados reais (P0/P1)

**Frontend:** se `preflight.ok=false`, não fazer upload nem chamar create; mostrar bloqueadores e manter formulário. Remover “publicar direto pela conta principal”.

**Backend:** repetir autenticação, propriedade, token, conta, WABA, telefone, carteira, criativo, localização, orçamento e gates. Salvar `draft/creating`; criar objetos PAUSED; persistir IDs; ativar; consultar `effective_status`; gravar `pending_review`, `active` ou `rejected` conforme a Meta.

**UI:** mostrar status local e efetivo; “enviada à Meta” até confirmação. Nunca afirmar “no ar” apenas pelo sucesso do POST.

**Aceite:** cada bloqueador impede criação; falha parcial deixa IDs recuperáveis e Meta pausada; banco e Meta convergem após reconciliação.

**Rollback:** feature flag volta à interface antiga, mas gate backend permanece fail-closed.

### F4 — Idempotência e recuperação (P1)

**Banco:** criar `campaign_operations` com `idempotency_key`, hash do payload, estado, IDs parciais, resultado/erro; `UNIQUE (consultant_id, operation_type, idempotency_key)`. Adicionar idempotency key também a `bulk_campaigns`.

**Fluxo:** cliente gera UUID uma vez. Retry reutiliza a mesma chave. Mesma chave e payload retorna o resultado anterior; payload diferente retorna 409. Em timeout após chamada Meta, marcar `reconciliation_pending` e consultar o externo antes de repetir.

**Disparo PRO:** índice único por `(campaign_id, normalized_phone)`; normalizar telefone no backend; criação transacional de campanha e alvos.

**Aceite:** 20 chamadas concorrentes geram um efeito; clique duplo e timeout não duplicam campanha; alvo repetido recebe uma mensagem.

**Rollback:** manter registros de operação, desabilitar consumo no código; não remover constraints sem análise de dados.

### F5 — Reserva financeira e cobrança (P1)

**Banco:** criar `wallet_reservations` e RPCs transacionais `reserve`, `consume`, `release` com lock da carteira. Chave financeira única por campanha/data/faixa cumulativa.

**Regras:** campanha fixa reserva mídia total + taxa antes de ativar. Contínua reserva janela definida e `spend_cap` nunca excede o reservado. Soma de saldo livre + reservas + gasto deve fechar contabilmente. Reserva não é liberada enquanto gasto externo for possível.

**Compatibilidade:** executar cálculo novo em modo sombra e comparar ao atual antes de bloquear/alterar saldo.

**Aceite:** duas campanhas concorrentes não reservam o mesmo dinheiro; sync repetido sem gasto novo debita R$0; falha após reserva não perde nem duplica saldo.

**Rollback:** desligar enforcement e manter ledger para reconciliação manual; nunca apagar reserva/transação.

### F6 — RLS e API de mutação (P1)

Substituir policies `FOR ALL` por SELECT do próprio consultor. Escritas passam por Edge Functions/RPCs com validação. Aplicar a `facebook_campaigns`, ownership, `bulk_campaigns`, targets, wallet/reservas e atribuições. Não alterar leitura da UI antes de mapear todas as chamadas diretas.

**Aceite:** frontend continua listando dados; INSERT/UPDATE/DELETE direto retorna permissão negada; funções autorizadas continuam operando.

**Rollback:** restaurar temporariamente policies anteriores por migration corretiva, nunca editar migration já aplicada.
### F7 — Métricas e snapshot do anúncio (P1/P2)

- Parar de preencher `leads` com fallback de conversas; manter colunas separadas.
- Relacionar campanha → anúncio → conversa → cliente → proposta → venda com prova de atribuição.
- Salvar snapshot imutável: copy, headline, descrição, CTA, mídia, placements, público, telefone, orçamento, duração, protocolo, distribuidora, template e rodízio.
- Migrar UI com leitura compatível: se snapshot não existir em campanha antiga, mostrar “não registrado”.

**Aceite:** cenário com 10 conversas e 7 clientes distintos mostra exatamente 10 conversas e 7 leads; campanha antiga continua abrindo sem erro.

### F8 — Piloto e liberação gradual

1. Deploy de código com todos os toggles OFF.
2. Homologação com objetos Meta PAUSED e sem envio.
3. Ativar apenas leitura/sync do consultor piloto.
4. Criar campanha piloto com orçamento total pequeno e duração curta.
5. Confirmar Meta, banco, reserva, cobrança, conversa, atribuição e pausa.
6. Coortes: piloto → 5% → 25% → 100%, no mínimo 24 h por etapa.
7. Rollback se houver cross-tenant, duplicidade, saldo negativo, cron sem segredo, gate violado ou aumento de falhas >2 pontos percentuais por 15 min.

## 6. Matriz mínima de testes

| Área | Cenário | Resultado obrigatório |
|---|---|---|
| Tenant | A consulta ID de B | 403/404, zero efeito |
| Importação | campanha sem vínculo | bloqueada |
| Gate | create/activate OFF | zero chamada mutável Meta |
| Contenção | pause com gate OFF | permitido |
| Pré-voo | token/WABA/saldo inválido | nada criado |
| Status | POST ACTIVE aceito, revisão Meta | `pending_review` |
| Idempotência | clique duplo/20 requests | 1 campanha |
| Timeout | resposta perdida após create | reconcilia, não recria |
| Financeiro | duas reservas concorrentes | saldo não reutilizado |
| Cobrança | sync repetido | nenhum débito extra |
| Cron | só anon `apikey` | 401/403 |
| Bulk | telefone duplicado | 1 alvo |
| Bulk | toggle/telefone incorreto | zero envio |
| Métricas | 10 conversas/7 leads | valores separados |
| Legado | 4 campanhas existentes | histórico intacto |

## 7. Validação obrigatória por fatia

### Estática e build

```bash
npx tsc --noEmit
npx vite build
npm run lint
```

Executar testes direcionados adicionados para o comportamento alterado e, antes do piloto, `npm test`. Não iniciar servidor/watch automaticamente.

### Banco (somente leitura após migration)

- Duplicidades globais de `fb_campaign_id`: zero.
- Ownership sem campanha/consultor: zero.
- Reservas ativas acima do saldo: zero.
- Transações com chave financeira duplicada: zero.
- Alvos normalizados duplicados: zero.
- RLS/advisors sem regressão crítica.

### Produção sem efeito externo

- Conferir versão implantada das Edge Functions.
- Testar 401/403, gates OFF e preflight bloqueado.
- Não usar `dryRun=false`, não ativar campanha e não enviar WhatsApp nesta etapa.

## 8. Ordem de arquivos prevista

1. Migrations aditivas em `supabase/migrations/`.
2. Helpers novos em `supabase/functions/_shared/`.
3. `facebook-create-campaign`, `facebook-toggle-campaign`, `meta-ads-import`, `facebook-sync-metrics`.
4. Demais mutadores Meta e crons.
5. `leads-to-campaign` e `bulk-scheduler`.
6. `src/services/facebookAds.ts`, `usePublish.ts` e telas de status/métricas.
7. Tipos Supabase regenerados apenas após schema estabilizar.

## 9. Regras de implantação

- Migrations são aplicadas via MCP Supabase, uma por fatia.
- Edge Functions são implantadas pelo GitHub Actions do repositório `tvmensal2025/igreen-page-magic`.
- Validar TypeScript e Vite antes de commit.
- Nunca commitar `.kiro/settings/mcp.json`, tokens, anon keys copiadas de crons ou segredos.
- Não fazer push/deploy/ativação sem aprovação explícita.
- Após deploy, confirmar `updated_at`/versão no Supabase e manter toggles OFF.

## 10. Definição de concluído

O módulo só está pronto quando todos os testes da matriz passam, os P0/P1 estão implantados, o piloto completa o ciclo sem mistura, duplicidade ou divergência financeira, e as coortes são liberadas sem violar invariantes. Melhorias de criativo são P2 e não substituem segurança operacional.

## 11. Primeira implementação recomendada

Começar exclusivamente por **F1 — propriedade autoritativa Meta**, em migration aditiva e modo sombra. Não combinar reserva, RLS ou mudança visual nesse primeiro patch. Isso reduz o maior risco sem interromper leitura, histórico, métricas ou campanhas pausadas existentes.

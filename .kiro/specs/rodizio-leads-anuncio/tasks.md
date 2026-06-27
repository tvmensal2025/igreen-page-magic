# Implementation Plan: Rodízio de Leads de Anúncio

## Overview

Este plano transforma o design em passos de código incrementais. A ordem segue o
fluxo da feature: primeiro o banco (tabelas e função SQL), depois o backend
(edge functions de criação de campanha e webhooks), depois o front (wizard) e,
por fim, os testes que faltam amarrar. Cada tarefa se apoia nas anteriores, sem
deixar código solto que não seja integrado.

Princípio central do design: **REUSO**. A regra de `idconsultor`/`indcli` em
`_shared/portal-worker.ts` (`buildPortal2Payload`) e o aviso
`notifyPartnerNewLead` NÃO são reimplementados — apenas acionados ao setar
`customers.referral_partner_id`.

As migrations de banco são aplicadas via MCP do Supabase (`apply_migration`),
que vale na hora. As edge functions sobem via GitHub Actions (não pelo CLI
local) — isso é apenas uma observação para o disparo manual ao final, e NÃO está
automatizado nas tarefas.

## Tasks

- [x] 1. Adaptar `rodizio_pools` + remover a `rodizio-redirect` descartada (Migração 1)
  - Aplicar migração via MCP Supabase (`apply_migration`)
  - Adicionar coluna `campaign_id uuid` com FK para `facebook_campaigns(id) on delete cascade`
  - Criar unique index parcial `rodizio_pools_campaign_id_uniq` em `campaign_id where campaign_id is not null` (uma pool por campanha)
  - Tornar `slug`, `phones` e `message` opcionais (`drop not null`; `phones set default '{}'`) sem DROP — colunas do antigo "link de rodízio" deixam de ser usadas
  - Adicionar policy de dono em `rodizio_pools` (`consultant_id = auth.uid()`) além da `super_admin` atual, para o painel do consultor listar suas pools
  - **Remover a abordagem de link descartada nesta sessão:** apagar `supabase/functions/rodizio-redirect/index.ts` e a entrada `[functions.rodizio-redirect]` no `supabase/config.toml` (dependiam de `rodizio_next(p_slug)` + `phones`/`message`)
  - _Requisitos: 6.1, 6.4_

- [x] 2. Criar tabela `rodizio_pool_members` e RLS (Migração 2)
  - [x] 2.1 Criar a tabela e índices
    - Aplicar migração via MCP Supabase (`apply_migration`)
    - Criar `rodizio_pool_members` com `id`, `pool_id` (FK pool, cascade), `partner_id` (FK `referral_partners`, cascade), `position int`, `lead_count bigint default 0`, `created_at`
    - Criar unique index `rodizio_pool_members_pool_pos_uniq` em `(pool_id, position)` (ordem sem buracos)
    - Criar unique index `rodizio_pool_members_pool_partner_uniq` em `(pool_id, partner_id)` (sem repetição na mesma pool)
    - Criar index `rodizio_pool_members_pool_idx` em `(pool_id)`
    - _Requisitos: 6.2, 9.1, 10.1_

  - [x] 2.2 Habilitar RLS e criar policies
    - `enable row level security` na nova tabela
    - Policy `rodizio_members_owner` (dono, via `exists` na pool com `consultant_id = auth.uid()`)
    - Policy `rodizio_members_service` (`service_role` faz tudo)
    - _Requisitos: 6.2, 10.2_

- [x] 3. Adaptar a função SQL `rodizio_next` para receber `campaign_id` e retornar `partner_id` atômico
  - Aplicar migração via MCP Supabase (`apply_migration`)
  - Trocar assinatura para `rodizio_next(p_campaign_id uuid) returns table(partner_id uuid, position int, pool_id uuid)` — busca a pool por `campaign_id` (NÃO por slug); o webhook passa o `source_campaign_id` do lead
  - Avançar `counter` da pool com `UPDATE ... RETURNING` (atômico) somente se `is_active` e a pool tiver ao menos 1 membro
  - Calcular posição circular `(counter-1) % len`, incrementar `lead_count` do membro da vez e retornar `partner_id`
  - Retornar vazio quando pool inexistente/inativa/vazia ou `partner_id` nulo (sinal de fallback)
  - _Requisitos: 7.1, 9.1, 9.2, 9.3, 10.1, 11.1, 11.2, 11.3_

- [x]* 3.1 Escrever teste de propriedade do seletor circular puro — ordem circular
  - Modelar função TS pura `(counter, len) -> position` espelhando `rodizio_next`
  - Usar fast-check, mínimo 100 iterações; tag `// Feature: rodizio-leads-anuncio, Property 1`
  - **Property 1: Ordem circular** — posições retornadas seguem `0,1,...,P-1,0,1,...`
  - **Valida: Requisitos 9.2**

- [x]* 3.2 Escrever teste de propriedade do seletor circular puro — distribuição justa
  - Usar fast-check, mínimo 100 iterações; tag `// Feature: rodizio-leads-anuncio, Property 2`
  - **Property 2: Distribuição justa (desvio máximo 1)** — diferença entre quem mais e menos recebeu ≤ 1; soma dos `lead_count` = N
  - **Valida: Requisitos 9.3, 10.1**

- [x]* 3.3 Escrever teste de integração da `rodizio_next` real — sem repetição sob concorrência
  - Disparar K chamadas concorrentes (K ≤ P) contra a `rodizio_next` real no Postgres
  - tag `// Feature: rodizio-leads-anuncio, Property 3`
  - **Property 3: Sem repetição na mesma volta sob concorrência** — participantes retornados são distintos
  - **Valida: Requisitos 9.1**

- [x] 4. Checkpoint — Banco pronto
  - Confirmar que as três migrations foram aplicadas (MCP `list_migrations`) e que a `rodizio_next` retorna `partner_id`.
  - Garantir que os testes de propriedade do seletor circular passam, perguntar ao usuário em caso de dúvida.

- [x] 5. Adaptar `facebook-create-campaign` para criar a pool de rodízio
  - [x] 5.1 Aceitar novos campos no corpo da requisição
    - Adicionar `rodizio_enabled: boolean` e `rodizio_partner_ids: string[]` ao `Body` da edge function
    - _Requisitos: 6.1_

  - [x] 5.2 Criar pool e membros após inserir `facebook_campaigns`
    - Quando `rodizio_enabled` e `partner_ids.length >= 2`, criar `rodizio_pools` ligada ao `campaign_id` e com `consultant_id = auth.id` (dono da campanha, resolvido por `authConsultant(req)`)
    - Inserir `rodizio_pool_members` na ordem recebida com `lead_count=0` e `position` 0..n
    - Quando `rodizio_enabled` for falso, não criar pool (comportamento atual)
    - Fail-open: se a criação da pool falhar após a campanha criada, logar e avisar via `notifyConsultant`, sem reverter a campanha
    - _Requisitos: 6.1, 6.2, 6.3, 6.4_

  - [x]* 5.3 Escrever testes de exemplo da criação de pool
    - Com `rodizio_enabled`: cria 1 pool ligada à campanha, membros na ordem certa e `lead_count=0`
    - Sem `rodizio_enabled`: nenhuma pool criada
    - _Requisitos: 6.1, 6.2, 6.3_

- [x] 6. Inserir atribuição por rodízio no `evolution-webhook`
  - [x] 6.1 Adicionar bloco de rodízio antes do match por keyword
    - Usar o `source_campaign_id` já resolvido (~linha 786) para chamar `rodizio_next(p_campaign_id)` (passa o id da campanha direto, sem slug)
    - Quando retornar `partner_id` válido, setar `customers.referral_partner_id`
    - Manter `customers.consultant_id` como o da instância central
    - Quando o rodízio for aplicado, ignorar o match por keyword daquele lead (prioridade)
    - _Requisitos: 7.1, 7.2, 7.4, 8.1, 8.2_

  - [x] 6.2 Acionar aviso ao participante da vez
    - Reusar `notifyPartnerNewLead` para o telefone de aviso do participante (best-effort, com `.catch`)
    - NÃO duplicar a regra de `idconsultor`/`indcli`: deixar o pipeline existente (`buildPortal2Payload`) resolver
    - _Requisitos: 7.3, 12.4_

  - [x] 6.3 Fallback fail-open
    - Envolver o bloco de rodízio em `try/catch` que apenas loga e segue (sem `throw`), como o bloco de keyword
    - Quando `rodizio_next` retorna vazio/inválido, não setar `referral_partner_id` (cai no consultor dono) preservando `source_campaign_id`
    - _Requisitos: 11.1, 11.2, 11.3, 11.4_

  - [x]* 6.4 Escrever teste de propriedade do ramo de atribuição — reflete o participante da vez
    - Mockar Supabase e `rodizio_next`; tag `// Feature: rodizio-leads-anuncio, Property 4`
    - **Property 4: Atribuição reflete o participante da vez** — `referral_partner_id` = `partner_id` retornado; `consultant_id` permanece o da instância central
    - **Valida: Requisitos 7.2, 7.4**

  - [x]* 6.5 Escrever teste de propriedade do ramo de atribuição — prioridade sobre keyword
    - Gerar mensagens com keyword de outro participante; tag `// Feature: rodizio-leads-anuncio, Property 5`
    - **Property 5: Prioridade do rodízio sobre keyword** — resultado é o participante do rodízio, ignorando keyword
    - **Valida: Requisitos 8.1, 8.2**

  - [x]* 6.6 Escrever teste de propriedade do ramo de atribuição — fallback nunca perde o lead
    - Gerar estados de pool variados (vazia/inativa/inexistente/retorno inválido); tag `// Feature: rodizio-leads-anuncio, Property 6`
    - **Property 6: Fallback seguro nunca perde o lead** — lead registrado com `referral_partner_id` nulo e `source_campaign_id` preservado
    - **Valida: Requisitos 11.1, 11.2, 11.3, 11.4**

- [x] 7. Espelhar a atribuição por rodízio no `whapi-webhook` (MVP: tratamento mínimo)
  - **MVP:** no bloco de keyword (~linha 726), pular o match quando a campanha do lead tiver pool ativa (consultar a origem CTWA só o suficiente para saber se há pool), preservando a prioridade do rodízio
  - **Refator completo (tarefa separada, maior risco):** antecipar a resolução de `source_campaign_id` (casar campanha por `ad_id`/`ctwa_clid`) para antes do bloco de keyword e inserir o mesmo bloco de rodízio (atribuição + aviso + fail-open) do evolution
  - _Requisitos: 7.1, 7.2, 7.3, 7.4, 8.1, 8.2, 11.1, 11.2, 11.3, 11.4_

- [x]* 8. Escrever teste de propriedade da regra de idconsultor/indcli (reuso)
  - Testar `buildPortal2Payload` existente com participantes gerados (variando `partner_igreen_id` e `cli`), Supabase mockado
  - tag `// Feature: rodizio-leads-anuncio, Property 7`; mínimo 100 iterações
  - **Property 7: Resolução de idconsultor/indcli pelo tipo do participante** — `idconsultor` = `partner_igreen_id` quando > 0, senão o do dono; `indcli` = `cli` ou 0
  - **Valida: Requisitos 12.1, 12.2, 12.3**

- [x] 9. Checkpoint — Backend pronto
  - Garantir que os testes de webhook/payload passam, perguntar ao usuário em caso de dúvida.

- [x] 10. Criar serviço de acesso a `referral_partners` no front
  - Criar `src/services/referralPartners.ts` com funções de listar (ativos do dono) e criar participante via `supabase-js` (RLS já cobre)
  - Setar `consultant_id` com o id do consultor logado (dono do número central)
  - Criar como CONSULTOR: `partner_igreen_id` preenchido; `cli` = valor informado OU `'0'` (NUNCA null — coluna `cli` é NOT NULL)
  - Criar como PARCEIRO/INDICADOR: `partner_igreen_id` vazio/null, `cli` = valor informado (obrigatório)
  - _Requisitos: 2.1, 3.4, 4.4_

- [x] 11. Adicionar campos de rodízio ao estado do wizard
  - Adicionar a `WizardState` (em `useWizardState.ts`): `rodizioEnabled`, `rodizioPartners`, `rodizioPartnersLoading`, `rodizioInlineForm`
  - Definir tipos `RodizioPartnerDraft` e `RodizioInlineForm`
  - Atualizar `INITIAL_STATE` com os valores iniciais (toggle desligado, lista vazia)
  - _Requisitos: 1.1, 1.4_

- [x] 12. Implementar a lógica do rodízio em hook
  - [x] 12.1 Criar `useRodizioLogic.ts`
    - Carregar `referral_partners` do dono via `referralPartners.ts`
    - Adicionar/remover participante da lista ordenada; impedir duplicado com aviso
    - Validar form inline: CONSULTOR exige `partner_igreen_id`; PARCEIRO exige `cli`; ambos exigem nome e telefone de aviso
    - Criar participante e adicioná-lo automaticamente à lista ordenada
    - Validar mínimo de 2 participantes quando o rodízio está ligado
    - _Requisitos: 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.5, 4.1, 4.2, 4.3, 4.5, 5.1, 5.2_

  - [x]* 12.2 Escrever testes unitários do hook
    - Validações do form inline (CONSULTOR/PARCEIRO), bloqueio de duplicado, mínimo de 2
    - Toggle liga/desliga descarta seleção
    - _Requisitos: 1.2, 1.3, 2.4, 3.2, 3.3, 4.2, 4.3, 5.2_

- [x] 13. Criar componentes de UI do bloco de rodízio
  - [x] 13.1 Criar `RodizioBlock.tsx`
    - Toggle (`Switch` shadcn) "Distribuir leads entre vários participantes (rodízio)", inicial desligado
    - Ao ligar, exibir bloco de participantes; ao desligar, ocultar e descartar seleção
    - Multi-select de participantes existentes (combobox) + lista ordenada + botão "criar participante"
    - Manter arquivo ≤ 250 linhas (lógica fica no hook)
    - _Requisitos: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3_

  - [x] 13.2 Criar `RodizioInlineForm.tsx`
    - Form de criar participante para os dois tipos (CONSULTOR exige `partner_igreen_id`; PARCEIRO exige `cli`)
    - Campos nome, telefone de aviso e específicos do tipo, com mensagens de validação
    - Manter arquivo ≤ 250 linhas
    - _Requisitos: 3.1, 3.2, 3.3, 4.1, 4.2, 4.3_

  - [x] 13.3 Renderizar `RodizioBlock` no `StepBudget`
    - Inserir `<RodizioBlock state={state} patch={patch} />` colapsável abaixo do bloco "Onde publicar"
    - _Requisitos: 1.1, 1.2_

- [x] 14. Passar os dados do rodízio para a criação de campanha
  - Adicionar `rodizio_enabled?` e `rodizio_partner_ids?` ao `CreateCampaignBody` em `src/services/facebookAds.ts`
  - Em `usePublish.ts`, incluir `rodizio_enabled: true` e `rodizio_partner_ids` (ordem da lista) quando `state.rodizioEnabled`
  - Bloquear publicação quando rodízio ligado e lista < 2 participantes
  - _Requisitos: 5.2, 6.1, 6.3_

- [x] 15. Checkpoint final — validar front e amarrar tudo
  - Rodar `npx tsc --noEmit` (exit 0) e `npx vite build` (exit 0)
  - Garantir que todos os testes passam, perguntar ao usuário em caso de dúvida.
  - Observação (manual, fora das tarefas): as edge functions sobem via GitHub Actions; o usuário dispara o deploy após commit/push. As migrations já valem via MCP.

## Notes

- Tarefas marcadas com `*` são opcionais (testes) e podem ser puladas para um MVP mais rápido.
- Cada tarefa referencia requisitos específicos para rastreabilidade.
- Os checkpoints garantem validação incremental.
- Testes baseados em propriedade (PBT) usam **fast-check** (mínimo 100 iterações) e validam as propriedades de correção do design; cada um carrega a tag `// Feature: rodizio-leads-anuncio, Property {n}`.
- A regra de `idconsultor`/`indcli` é REUSADA de `_shared/portal-worker.ts` — não é duplicada.
- Deploy de edge functions é disparado manualmente pelo usuário (GitHub Actions), não automatizado aqui.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2.1"] },
    { "id": 2, "tasks": ["2.2", "3"] },
    { "id": 3, "tasks": ["3.1", "3.2", "3.3", "5.1"] },
    { "id": 4, "tasks": ["5.2", "10", "11"] },
    { "id": 5, "tasks": ["5.3", "6.1", "12.1", "13.2"] },
    { "id": 6, "tasks": ["6.2", "6.3", "7", "12.2", "13.1"] },
    { "id": 7, "tasks": ["6.4", "6.5", "6.6", "8", "13.3", "14"] }
  ]
}
```

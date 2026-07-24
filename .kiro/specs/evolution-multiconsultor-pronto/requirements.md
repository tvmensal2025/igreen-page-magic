> ⚠️ FONTE DE VERDADE WA = **Whapi** (não Evolution). Este spec pode estar defasado — siga `.kiro/steering/regras-duras.md` + `wa-webhook.md`. Ver `.kiro/specs/STATUS.md`.

# Requirements Document

## Introduction

Este spec é **enxuto e cirúrgico**. Ele cobre **somente** o que é necessário para que **novos consultores** consigam entrar em operação no canal **Evolution** (cada um conectando sua própria instância via QR code) **sem que o sistema quebre ou se comporte de forma errada**.

Contexto verificado em sessão contra o banco Supabase de produção do iGreen e contra o código-fonte (tratado como verdade de base):

- O iGreen é um SaaS multi-tenant: frontend Vite + React + TypeScript (somente chave anon no cliente), Supabase Postgres com ~100 Edge Functions Deno, e **dois canais WhatsApp** — `evolution-webhook` e `whapi-webhook`.
- Hoje existe **apenas 1 consultor** em produção (Rafael, super-admin, id `0c2711ad-4836-41e6-afba-edd94f698ae3`), operando via **Whapi**.
- **Novos consultores estão prestes a ser onboardados** e cada um conectará a **sua própria instância Evolution** via QR code (uma instância por consultor, na tabela `whatsapp_instances`). Com isso, o **Evolution passa a ser o canal de produção** dos novos consultores.
- Cada consultor decide quantos fluxos terá; o **fluxo padrão de negócio pretendido é a variante "D"**.

**Premissa registrada:** o consultor existente (Rafael) roda as variantes A/B/D no Whapi e **não pode ser perturbado** por nenhuma mudança deste spec.

### Fora de escopo (explícito)

Os itens abaixo são de **conformidade/segurança ampla** e **não** fazem parte deste spec enxuto. Eles permanecem rastreados separadamente no spec arquivado **`security-hardening-lgpd`**:

- Privacidade do bucket de documentos pessoais.
- Credenciais de portal em texto plano.
- Revogação em massa de funções `SECURITY DEFINER`.
- PII (dados pessoais) em logs.
- Proteção contra senha vazada (leaked-password protection).

Este documento cobre **exatamente 5 requisitos funcionais** mais **1 grupo de requisitos não-funcionais e de processo**.

### Princípios norteadores

- **Necessário e barato primeiro:** só entra o que impede quebra ou mau comportamento no onboarding via Evolution.
- **Isolamento multi-tenant preservado:** com múltiplos consultores reais, nenhum consultor pode ler ou alterar dados de outro.
- **Reversibilidade:** toda mudança de banco/RLS é uma migração única e focada, com backup prévio e rollback documentado.
- **Não auto-aplicável:** nenhuma migração de banco, política RLS ou webhook é aplicada automaticamente — exige aprovação humana explícita.
- **Sem regressão no Whapi:** mudanças de webhook são validadas no canal Evolution e não podem regredir o comportamento do Whapi.

## Glossary

- **Evolution**: provedor/canal WhatsApp (`evolution-webhook`) que passa a ser o canal de produção dos novos consultores. Cada consultor conecta sua própria instância.
- **Whapi**: provedor/canal WhatsApp adicional (`whapi-webhook`) usado hoje pelo único consultor existente (Rafael).
- **Instância / QR code**: conexão WhatsApp de um consultor no Evolution, registrada na tabela `whatsapp_instances`. Cada novo consultor pareia sua própria instância escaneando um QR code. Há **uma instância por consultor**.
- **Variante de fluxo (A/B/D)**: rótulo que identifica qual fluxo de conversa (`bot_flows.variant`) atende um lead. O roteamento usa `consultants.active_variants` e a variante do cliente. A **variante padrão de negócio pretendida é "D"**.
- **Kill switch (interruptor global)**: chave de configuração global (`bot_global_enabled`, lida por `isBotGloballyEnabled`) que, quando desligada, silencia globalmente todas as respostas automáticas do bot.
- **RLS (Row Level Security)**: mecanismo do PostgreSQL que aplica políticas por linha, restringindo quais registros cada role pode ler ou gravar.
- **USING / WITH CHECK**: em RLS, a cláusula `USING` filtra quais linhas existentes são visíveis/afetáveis; a cláusula `WITH CHECK` valida os valores das linhas após `INSERT`/`UPDATE`. Sem `WITH CHECK`, um `UPDATE` pode mover uma linha para um estado que o usuário não poderia ter criado.
- **service_role**: role privilegiada do Supabase cujas operações **ignoram (bypass) o RLS**. Usada por Edge Functions de back-end; sua chave nunca deve ser exposta ao cliente.
- **JWT autenticado**: token de um usuário logado (role `authenticated`) que identifica o consultor chamador.
- **IDOR (Insecure Direct Object Reference)**: falha em que um chamador acessa ou manipula um recurso de outra entidade apenas informando o identificador dele (ex.: `customer_id`/`consultant_id`) sem verificação de autorização/posse.
- **seed / trigger**: gatilho de banco que provisiona dados iniciais. Aqui, `seed_default_camila_flow` cria automaticamente o fluxo padrão de um consultor recém-criado.
- **fail-open**: postura de degradação em que, se a leitura da configuração de controle (kill switch) falhar, o bot é tratado como **habilitado**, preservando o atendimento.

## Requirements

### Requisito 1 — Kill switch global no Evolution

**História de Usuário:** Como operador da plataforma, quero um interruptor global de emergência que silencie o bot também no canal Evolution, para que eu possa parar imediatamente todas as respostas automáticas dos novos consultores em caso de incidente, do mesmo jeito que já consigo no Whapi.

**Contexto verificado:** `isBotGloballyEnabled` / `bot_global_enabled` é checado no `whapi-webhook`, mas tem **zero ocorrências** no `evolution-webhook` (confirmado por grep). Como o Evolution passa a ser o canal de produção de todos os novos consultores, precisa haver um desligamento global de emergência também nele.

#### Critérios de Aceitação

1. WHILE `bot_global_enabled` é `false`, THE evolution-webhook SHALL não enviar respostas automáticas e SHALL retornar uma resposta de sucesso neutra à requisição de entrada.
2. WHILE `bot_global_enabled` é `true`, THE evolution-webhook SHALL processar o evento normalmente, mantendo o comportamento funcional atual.
3. IF a leitura da flag `bot_global_enabled` falhar, THEN THE evolution-webhook SHALL tratar o bot como habilitado (fail-open) e processar o evento normalmente.
4. THE evolution-webhook SHALL aplicar a verificação do kill switch espelhando o comportamento já existente no whapi-webhook (mesmo ponto de decisão e mesma semântica de fail-open).

### Requisito 2 — Consultor novo nasce no fluxo padrão correto (D)

**História de Usuário:** Como operador da plataforma, quero que todo consultor recém-criado já nasça provisionado na variante de fluxo padrão de negócio (D), para que os leads do novo consultor sejam roteados para o fluxo correto desde o primeiro contato.

**Contexto verificado:** o default de `consultants.active_variants` é `ARRAY['A']`, o default de `bot_flows.variant` é `'A'`, e o trigger `seed_default_camila_flow` cria o fluxo **sem** especificar a variante (logo ele nasce como `'A'`). O padrão de negócio pretendido é `'D'`. Hoje um consultor novo nasce no fluxo A, não no D.

#### Critérios de Aceitação

1. WHEN um novo consultor é criado, THE system SHALL provisionar o consultor na variante padrão pretendida (D), gravando a variante `D` no `bot_flow` semeado.
2. WHEN um novo consultor é criado, THE system SHALL definir `consultants.active_variants` de modo a incluir a variante padrão pretendida (D), para que os leads sejam roteados ao fluxo correto.
3. THE system SHALL preservar a configuração A/B/D já existente do consultor atual (Rafael), sem forçar alteração de dados existentes.
4. THE system SHALL implementar a mudança do padrão de provisionamento de forma reversível (rollback documentado para o comportamento anterior).

### Requisito 3 — Resolução de fluxo ativo robusta

**História de Usuário:** Como consultor novo, quero que o sistema escolha de forma determinística qual dos meus fluxos ativos atende cada lead, para que o lead caia no fluxo certo e não no fluxo de boas-vindas legado por engano.

**Contexto verificado:** o `evolution-webhook` resolve o fluxo ativo (aproximadamente nos índices 1057 e 1305) com `.from("bot_flows").eq(consultant_id).eq("is_active", true).maybeSingle()`, **sem filtrar por variante**. Quando um consultor tem múltiplos fluxos ativos simultâneos (A/B/D, como o Rafael), `.maybeSingle()` retorna erro → `activeFlow` vira `null` (dentro de try/catch, então degrada silenciosamente, sem crash duro) → a etapa de abertura configurada **não** é detectada e o lead pode cair no fluxo de boas-vindas legado em vez do fluxo certo.

#### Critérios de Aceitação

1. WHEN um consultor possui um ou mais fluxos ativos, THE evolution-webhook SHALL resolver de forma determinística um único fluxo ativo, sem gerar erro.
2. WHEN existe mais de um fluxo ativo para o consultor, THE evolution-webhook SHALL selecionar o fluxo aplicável usando a variante do cliente e/ou uma ordenação determinística com limite de um resultado.
3. WHEN o fluxo ativo aplicável é resolvido, THE evolution-webhook SHALL detectar a etapa de abertura configurada desse fluxo.
4. THE evolution-webhook SHALL resolver o fluxo ativo de forma equivalente à já adotada pelo whapi-webhook.

### Requisito 4 — Isolamento no UPDATE de customers (WITH CHECK)

**História de Usuário:** Como operador da plataforma, quero que um consultor não consiga reatribuir um lead para si nem para outro consultor ao atualizar um registro de cliente, para que o isolamento multi-tenant seja garantido agora que existem múltiplos consultores reais.

**Contexto verificado:** a política RLS `Owner update customers` em `public.customers` tem `USING (consultant_id = auth.uid())`, mas `WITH CHECK = NULL`. Com múltiplos consultores reais, um dono poderia alterar `consultant_id` e reatribuir/roubar o lead de outro consultor.

#### Critérios de Aceitação

1. WHEN um consultor autenticado executa um UPDATE em uma linha de `customers`, THE RLS_Policy SHALL impor `WITH CHECK` de modo que o `consultant_id` resultante permaneça igual a `auth.uid()`.
2. IF um UPDATE tenta definir `consultant_id` para outro consultor, THEN THE RLS_Policy SHALL rejeitar a operação.
3. THE RLS_Policy SHALL preservar o acesso já existente de administrador, líder e consultor designado (assigned consultant) aos registros de clientes.
4. THE Plataforma SHALL aplicar esta mudança como uma única migração focada, com backup prévio, rollback documentado e aprovação humana explícita (não auto-aplicada).

### Requisito 5 — Isolamento em Edge Functions com service_role (IDOR)

**História de Usuário:** Como responsável de segurança da plataforma, quero que as Edge Functions que rodam com service_role autentiquem o chamador e verifiquem a posse do recurso, para que, com múltiplos consultores reais, nenhum consultor consiga ler ou modificar o cliente de outro informando apenas o identificador.

**Contexto verificado:** as funções `capture-extract`, `upload-documents-minio`, `ai-agent-router`, `ai-sales-agent` e `facebook-capi` rodam com `service_role` (ignoram RLS), com `verify_jwt = false`, e aceitam `customer_id`/`consultant_id` vindos do corpo sem verificação de posse. Com múltiplos consultores reais, isso permite ler o cliente de outro consultor por id. Algumas dessas funções são invocadas internamente por outras (ex.: `evolution-webhook` → `ai-agent-router`), então a solução precisa suportar tanto chamadas internas (segredo de serviço) quanto chamadas via JWT (verificação de posse).

#### Critérios de Aceitação

1. WHEN qualquer uma das funções `capture-extract`, `upload-documents-minio`, `ai-agent-router`, `ai-sales-agent` ou `facebook-capi` recebe uma requisição, THE Edge_Function SHALL autenticar o chamador por JWT válido com role `authenticated` OU por segredo compartilhado de serviço em cabeçalho, antes de ler, gravar ou produzir qualquer efeito colateral.
2. WHEN um chamador autenticado por JWT informa um `customer_id` ou `consultant_id` no corpo, THE Edge_Function SHALL verificar que o chamador é dono do recurso (ou possui papel administrativo) antes de ler ou modificar o recurso.
3. WHERE a função é invocada por um processo de back-end confiável (outra Edge Function ou cron) apresentando um segredo compartilhado de serviço válido, THE Edge_Function SHALL aceitar a chamada como autenticada e dispensar a verificação de posse do Critério 2.
4. IF a autenticação falhar (JWT ausente ou inválido E segredo de serviço ausente ou inválido), THEN THE Edge_Function SHALL retornar status HTTP 401 sem produzir efeito colateral.
5. IF a verificação de posse falhar (recurso pertence a outro consultor), THEN THE Edge_Function SHALL retornar status HTTP 403 sem ler nem modificar o recurso.
6. IF o `customer_id` ou `consultant_id` informado estiver ausente ou malformado, THEN THE Edge_Function SHALL retornar status HTTP 400 sem produzir efeito colateral.
7. WHEN o chamador é autenticado e autorizado, THE Edge_Function SHALL preservar o comportamento funcional atual para chamadas legítimas.
8. THE Plataforma SHALL armazenar o segredo compartilhado de serviço como segredo de ambiente, sem expô-lo no código-fonte nem em logs.

### Requisito 6 — Requisitos não-funcionais e de processo (transversal)

**História de Usuário:** Como operador da plataforma, quero que toda mudança deste spec seja focada, reversível e aprovada por uma pessoa antes de ir para produção, para que o onboarding no Evolution aconteça sem risco de quebrar o isolamento multi-tenant nem o canal Whapi do consultor existente.

#### Critérios de Aceitação

1. THE Plataforma SHALL implementar cada mudança de banco de dados ou política RLS como uma única migração focada, sem misturar alterações não relacionadas.
2. THE Plataforma SHALL exigir backup do estado anterior e um plano de rollback documentado antes de aplicar qualquer mudança de banco, política RLS ou webhook.
3. THE Plataforma SHALL exigir aprovação humana explícita antes de aplicar qualquer mudança de banco, política RLS ou webhook, sem aplicação automática.
4. THE Plataforma SHALL preservar o isolamento multi-tenant em todas as mudanças, de modo que nenhum consultor leia ou altere dados de outro consultor.
5. WHEN uma mudança de webhook é proposta, THE Plataforma SHALL validar a mudança no canal Evolution e SHALL confirmar a ausência de regressão no canal Whapi antes do rollout em produção.
6. THE Plataforma SHALL preservar o comportamento atual do consultor existente (Rafael), que opera as variantes A/B/D no Whapi.

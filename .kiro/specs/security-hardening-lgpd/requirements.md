# Requirements Document

## Introduction

Esta é a **Fase 1** de um roteiro de remediação de 6 fases derivado de uma auditoria completa de segurança e arquitetura do SaaS multi-tenant iGreen (frontend Vite + React + TypeScript, Supabase Postgres + ~100 Edge Functions, dois canais WhatsApp — Evolution e Whapi —, carteira Stripe e Meta Ads).

O escopo desta fase é **exclusivamente** a correção de riscos de **segurança** e de **conformidade com a LGPD** (Lei Geral de Proteção de Dados, equivalente brasileiro ao GDPR). Itens de motor de fluxo (flow-engine), captação, UX de administração e desempenho **não** fazem parte desta fase — eles serão tratados nas Fases 2 a 6.

Cada requisito abaixo corresponde a um achado de auditoria verificado contra o código-fonte e o banco de dados em produção. O documento é o **plano**; nenhuma mudança é aplicada automaticamente. Toda alteração de banco de dados, política RLS, bucket de armazenamento ou webhook exige backup prévio e aprovação humana explícita antes de ser aplicada (ver Requisito 11 — Requisitos Não-Funcionais e de Processo).

### Princípios norteadores

- **Read-only-first (somente-leitura primeiro):** o levantamento e a verificação não alteram o sistema; a aplicação de qualquer correção depende de aprovação.
- **Isolamento multi-tenant preservado:** nenhum consultor pode ler clientes, parceiros ou credenciais de outro consultor.
- **Reversibilidade:** toda mudança deve ter um plano de rollback e não pode misturar alterações não relacionadas em uma mesma migração.
- **Não-destrutivo sempre que possível:** quando uma operação for destrutiva ou de difícil reversão, ela deve ser explicitamente sinalizada como exigindo backup e aprovação.

## Glossary

- **LGPD**: Lei Geral de Proteção de Dados (Lei nº 13.709/2018). Legislação brasileira de proteção de dados pessoais, equivalente ao GDPR europeu. Documentos como RG, CNH e conta de luz são dados pessoais sob a LGPD.
- **RLS (Row Level Security)**: mecanismo do PostgreSQL que aplica políticas por linha, restringindo quais registros cada usuário/role pode ler ou gravar.
- **Política USING / WITH CHECK**: em RLS, a cláusula `USING` filtra quais linhas existentes são visíveis/afetáveis; a cláusula `WITH CHECK` valida os valores das linhas após um `INSERT`/`UPDATE`. Sem `WITH CHECK`, um `UPDATE` pode alterar uma linha para um estado que o usuário não poderia ter criado.
- **service_role**: role privilegiada do Supabase cujas operações **ignoram (bypass) o RLS**. É usada por Edge Functions de back-end; chaves dessa role nunca devem ser expostas ao cliente.
- **anon**: role anônima do Supabase usada por requisições não autenticadas (sem login). Tem acesso somente ao que as políticas RLS e os grants explicitamente permitirem.
- **authenticated**: role do Supabase atribuída a usuários que fizeram login (possuem um JWT válido).
- **CAPI (Conversions API)**: API de Conversões do Meta/Facebook que envia eventos de conversão (Lead, Purchase, etc.) servidor-a-servidor para um pixel.
- **Signed URL (URL assinada)**: URL temporária e assinada criptograficamente que concede acesso a um objeto de um bucket privado por tempo limitado, sem tornar o bucket público.
- **Kill switch (interruptor global)**: chave de configuração (`app_settings.bot_global_enabled`) que, quando desligada, deve silenciar globalmente todas as respostas automáticas do bot.
- **IDOR (Insecure Direct Object Reference)**: falha em que um chamador acessa ou manipula um objeto de outra entidade apenas informando o identificador dele (ex.: `customer_id`/`consultant_id`) sem verificação de autorização/posse.
- **SECURITY DEFINER**: função/visão do PostgreSQL executada com os privilégios de quem a **criou** (não de quem a chama). Pode contornar RLS e elevar privilégios se exposta indevidamente.
- **SECURITY INVOKER**: função/visão executada com os privilégios de **quem a chama**, respeitando o RLS do chamador. É o modo seguro padrão para visões expostas.
- **HMAC**: código de autenticação de mensagem baseado em hash com chave secreta, usado para validar que uma requisição (ex.: webhook) veio de uma origem confiável e não foi adulterada.
- **Evolution / Whapi**: os dois provedores/canais de WhatsApp integrados. O canal Evolution é usado por **todos** os consultores; o Whapi é um canal adicional.
- **PII (Personally Identifiable Information)**: dados pessoais identificáveis, como CPF, telefone, e-mail e códigos OTP.
- **OTP (One-Time Password)**: código de uso único enviado para validação (ex.: confirmação no portal iGreen).

## Requirements

### Requisito 1 — Armazenamento privado de documentos pessoais (maior risco LGPD)

**História de Usuário:** Como responsável de segurança da plataforma, quero que documentos pessoais dos clientes (RG/CNH e conta de luz) deixem de residir em bucket público e listável, para que dados sensíveis sob a LGPD não fiquem acessíveis ou enumeráveis por terceiros não autorizados.

**Contexto verificado:** `src/components/captacao/CaptureDocumentTiles.tsx` envia os arquivos `document_front_url`, `document_back_url` e `electricity_bill_photo_url` para o bucket **público** `whatsapp-media` e usa `getPublicUrl`. O advisor de segurança confirma que os buckets públicos `whatsapp-media`, `consultant-photos`, `ai-agent-media`, `IMAGE` e `video igreen` possuem políticas SELECT amplas que permitem **listar** todos os arquivos. A Edge Function `upload-documents-minio` segue padrão equivalente.

#### Critérios de Aceitação

1. THE Plataforma SHALL armazenar novos documentos pessoais de clientes (RG/CNH frente, RG/CNH verso e conta de luz) em um bucket de armazenamento privado, não listável publicamente.
2. WHEN um documento pessoal precisa ser exibido a um usuário autorizado (consultor dono do registro ou papel administrativo), THE Plataforma SHALL gerar uma URL assinada com prazo de expiração não superior a 300 segundos (5 minutos), em vez de uma URL pública permanente.
3. THE Plataforma SHALL restringir a leitura (SELECT) e a listagem de objetos do bucket de documentos pessoais apenas a chamadores autorizados (service_role ou consultor dono do registro), removendo as políticas SELECT amplas que permitem listagem anônima.
4. WHILE existirem URLs públicas de documentos já enviadas antes da migração, THE Plataforma SHALL manter um plano de migração que preserve o acesso a esses documentos por usuários autorizados sem quebrar referências existentes.
5. IF a geração de uma URL assinada falhar, THEN THE Plataforma SHALL registrar o erro com um identificador interno não sensível, retornar uma mensagem de falha ao usuário sem expor o caminho interno do objeto e negar o acesso ao objeto (sem retornar conteúdo).
6. THE Plataforma SHALL tratar a reconfiguração de buckets e políticas de armazenamento como operação que exige backup do inventário atual de objetos/políticas e aprovação humana explícita antes da aplicação.
7. IF um chamador não autorizado (não dono e sem papel administrativo) solicitar um documento pessoal, THEN THE Plataforma SHALL negar o acesso, não gerar URL assinada e não retornar o conteúdo.
8. IF o upload de um documento pessoal ao bucket privado falhar, THEN THE Plataforma SHALL retornar uma mensagem de falha, não persistir referência a URL pública e preservar o estado anterior do registro.

### Requisito 2 — Validação de origem dos webhooks

**História de Usuário:** Como operador da plataforma, quero que os webhooks de entrada dos provedores WhatsApp validem a origem antes de processar, para que requisições forjadas não consigam injetar mensagens ou acionar o bot.

**Contexto verificado:** `supabase/functions/evolution-webhook` e `supabase/functions/whapi-webhook` estão com `verify_jwt = false` em `config.toml` e aceitam qualquer `POST` sem HMAC, token ou assinatura do provedor.

#### Critérios de Aceitação

1. WHEN uma requisição chega ao endpoint do evolution-webhook, THE Webhook SHALL validar a origem por segredo compartilhado ou assinatura HMAC presente no cabeçalho antes de processar o conteúdo.
2. WHEN uma requisição chega ao endpoint do whapi-webhook, THE Webhook SHALL validar a origem por segredo compartilhado ou assinatura HMAC presente no cabeçalho antes de processar o conteúdo.
3. IF a validação de origem falhar, THEN THE Webhook SHALL rejeitar a requisição com status HTTP 401 e não executar nenhum efeito colateral (sem criação de cliente, sem envio de mensagem, sem gravação de conversa).
4. WHEN a origem da requisição é validada com sucesso, THE Webhook SHALL processar o evento mantendo o comportamento funcional atual para tráfego legítimo dos provedores.
5. THE Plataforma SHALL armazenar o segredo de validação de webhook como segredo de ambiente, sem expô-lo no código-fonte nem em logs.
6. THE Plataforma SHALL validar a mudança de webhook em ambos os canais (Evolution e Whapi), confirmando supressão de duplicatas, antes do rollout em produção.

### Requisito 3 — Autenticação e verificação de posse em Edge Functions com service_role (IDOR)

**História de Usuário:** Como responsável de segurança da plataforma, quero que as Edge Functions que rodam com service_role autentiquem o chamador e verifiquem a posse dos recursos, para que nenhum chamador manipule clientes ou consultores de outra conta informando apenas o identificador.

**Contexto verificado:** as funções `capture-extract`, `upload-documents-minio`, `ai-agent-router`, `ai-sales-agent` e `facebook-capi` rodam com `service_role` (ignoram RLS) e aceitam `customer_id`/`consultant_id` vindos do corpo da requisição sem verificação de autenticação ou posse. Algumas dessas funções são invocadas internamente por outras Edge Functions/crons (ex.: `ai-agent-router` é chamada pelo webhook), portanto a solução precisa suportar tanto autenticação por segredo de serviço (chamadas back-end) quanto verificação de posse via JWT (chamadas vindas do cliente).

#### Critérios de Aceitação

1. WHEN qualquer uma das funções `capture-extract`, `upload-documents-minio`, `ai-agent-router`, `ai-sales-agent` ou `facebook-capi` recebe uma requisição, THE Edge_Function SHALL autenticar o chamador por JWT válido com role `authenticated` OU por segredo compartilhado de serviço em cabeçalho, antes de ler, gravar ou produzir qualquer efeito colateral.
2. WHEN um chamador autenticado por JWT informa um `consultant_id` ou `customer_id` no corpo, THE Edge_Function SHALL verificar que o `consultant_id` do JWT é igual ao `consultant_id` informado (ou ao `consultant_id` dono do `customer_id` informado), ou que o chamador possui papel administrativo, antes de ler ou modificar o recurso.
3. IF a autenticação falhar (JWT ausente, inválido ou expirado E segredo de serviço ausente ou inválido), THEN THE Edge_Function SHALL retornar status HTTP 401 sem executar nenhum efeito colateral, incluindo nenhuma chamada a serviços externos.
4. IF a verificação de posse falhar (recurso pertence a outro consultor), THEN THE Edge_Function SHALL retornar status HTTP 403 sem ler, modificar nem produzir efeito colateral sobre o recurso.
5. WHERE uma função é invocada por um processo de back-end confiável (cron ou outra Edge Function) apresentando um segredo compartilhado de serviço válido, THE Edge_Function SHALL aceitar a chamada como autenticada e dispensar a verificação de posse do Critério 2.
6. WHEN o chamador é autenticado e autorizado, THE Edge_Function SHALL preservar o comportamento funcional atual para chamadas legítimas.
7. IF o `customer_id` ou `consultant_id` informado estiver ausente, malformado ou não existir, THEN THE Edge_Function SHALL retornar erro de validação (HTTP 400) sem produzir efeito colateral.
8. THE Plataforma SHALL armazenar o segredo compartilhado de serviço como segredo de ambiente, sem expô-lo no código-fonte nem em logs.

### Requisito 4 — Eventos do Facebook CAPI não forjáveis

**História de Usuário:** Como operador da plataforma, quero que as chamadas ao Facebook CAPI sejam autenticadas e autorizadas, para que eventos de conversão forjados não poluam o pixel global nem desperdicem verba de anúncios.

**Contexto verificado:** `supabase/functions/facebook-capi` está com `verify_jwt = false` e sem segredo; aceita `consultant_id` no corpo da requisição, permitindo o envio de eventos de conversão forjados.

#### Critérios de Aceitação

1. WHEN uma requisição chega ao endpoint do facebook-capi, THE CAPI_Function SHALL autenticar o chamador por JWT válido ou segredo compartilhado antes de enviar qualquer evento ao Meta.
2. WHEN a requisição informa um `consultant_id`, THE CAPI_Function SHALL verificar que o chamador autenticado está autorizado a emitir eventos para aquele consultor antes de prosseguir.
3. IF a autenticação ou a autorização falhar, THEN THE CAPI_Function SHALL rejeitar a requisição com status HTTP 401 ou 403 e não enviar nenhum evento ao Meta nem gravar registro em `facebook_capi_events`.
4. WHEN o chamador é autenticado e autorizado, THE CAPI_Function SHALL enviar o evento de conversão preservando o comportamento atual de deduplicação por `event_id`.

### Requisito 5 — Kill switch global honrado no canal Evolution

**História de Usuário:** Como operador da plataforma, quero que o interruptor global do bot seja respeitado no canal Evolution, para que desligar o bot globalmente realmente silencie o canal usado por todos os consultores.

**Contexto verificado:** o kill switch `app_settings.bot_global_enabled` é verificado por `isBotGloballyEnabled` apenas no `whapi-webhook`; o `evolution-webhook` (canal usado por **todos** os consultores) não verifica essa chave global.

#### Critérios de Aceitação

1. WHILE `app_settings.bot_global_enabled` estiver desligado (false), THE Evolution_Webhook SHALL ignorar mensagens de entrada e não enviar respostas automáticas.
2. WHEN o evolution-webhook recebe uma mensagem e o kill switch global está desligado, THE Evolution_Webhook SHALL retornar uma resposta neutra de sucesso sem executar o fluxo do bot.
3. WHILE `app_settings.bot_global_enabled` estiver ligado (true), THE Evolution_Webhook SHALL processar mensagens com o comportamento atual.
4. IF a leitura da chave `bot_global_enabled` falhar, THEN THE Evolution_Webhook SHALL assumir o bot habilitado (fail-open), mantendo consistência com o comportamento já adotado no whapi-webhook.
5. THE Plataforma SHALL aplicar a verificação do kill switch global no evolution-webhook de forma consistente com a verificação já existente no whapi-webhook.

### Requisito 6 — UPDATE de customers com WITH CHECK (anti-reatribuição de lead)

**História de Usuário:** Como responsável de segurança da plataforma, quero que a política de UPDATE da tabela customers imponha WITH CHECK, para que um consultor dono não consiga alterar o `consultant_id` e reatribuir/roubar um lead de outro consultor.

**Contexto verificado:** a política `Owner update customers` tem `with_check` nulo (confirmado em `pg_policy`: `with_check_expr: null`), permitindo que um `UPDATE` altere `consultant_id` para outro consultor. Observação: verificado em ambiente real que apenas donos autenticados/admin acessam a tabela e que a role anônima retorna 0 linhas — trata-se de defesa em profundidade, não de vazamento aberto.

#### Critérios de Aceitação

1. WHEN um consultor autenticado executa um `UPDATE` em uma linha de `customers`, THE Política_RLS SHALL impor uma cláusula `WITH CHECK` que garanta que o `consultant_id` resultante permaneça igual ao do consultor autenticado.
2. IF um `UPDATE` tentar alterar o `consultant_id` para um valor diferente do consultor autenticado, THEN THE Política_RLS SHALL rejeitar a operação.
3. THE Política_RLS SHALL preservar a capacidade dos consultores donos de atualizarem os demais campos de seus próprios clientes sem alteração funcional.
4. THE Política_RLS SHALL preservar o acesso administrativo (papel admin) e de líderes de equipe conforme as políticas existentes, sem ampliação de privilégios.
5. THE Plataforma SHALL tratar a alteração da política RLS de `customers` como operação que exige backup das definições de política atuais e aprovação humana explícita, com plano de rollback.

### Requisito 7 — Credenciais do portal protegidas (sem texto puro)

**História de Usuário:** Como responsável de segurança da plataforma, quero que as credenciais do portal iGreen dos consultores deixem de ser armazenadas e exibidas em texto puro, para que senhas não fiquem expostas no banco, em logs ou na interface.

**Contexto verificado:** `consultants.igreen_portal_email` e `consultants.igreen_portal_password` são colunas `text` em texto puro, lidas por `sync-igreen-customers` e pelo worker Playwright (`worker-portal/playwright-automation.mjs`), e a senha é ecoada na UI da aba Dados (`src/components/admin/DadosTab.tsx`, com botão mostrar/ocultar).

#### Critérios de Aceitação

1. THE Plataforma SHALL armazenar a senha do portal iGreen criptografada em repouso ou em um cofre de segredos, em vez de em coluna de texto puro.
2. WHEN a UI da aba Dados exibe as credenciais do portal, THE Interface SHALL omitir o valor da senha, não a carregando do banco para o campo de exibição.
3. THE Plataforma SHALL restringir a leitura das credenciais do portal apenas aos processos de back-end autorizados (sincronização e worker) e ao próprio consultor dono, impedindo leitura por outros consultores.
4. WHEN os processos de back-end (`sync-igreen-customers` e worker Playwright) precisam autenticar no portal, THE Processo_Backend SHALL obter a credencial pela via protegida (descriptografia/cofre) sem persistir o valor em texto puro.
5. IF a recuperação de uma credencial protegida falhar, THEN THE Processo_Backend SHALL registrar a falha sem expor o valor da credencial e interromper a operação que dependia dela.
6. THE Plataforma SHALL tratar a migração das credenciais existentes como operação que exige backup e aprovação humana explícita, com plano de rollback.

### Requisito 8 — Redução de exposição de SECURITY DEFINER

**História de Usuário:** Como responsável de segurança da plataforma, quero remover a execução pública de funções SECURITY DEFINER não destinadas à API e converter a visão de saúde para SECURITY INVOKER, para que privilégios elevados não fiquem acessíveis por anon/authenticated via PostgREST.

**Contexto verificado:** o advisor reporta `ERROR` para a visão `public.v_bot_engine_health` definida com SECURITY DEFINER, e ~70 funções SECURITY DEFINER com `EXECUTE` concedido a `anon`/`authenticated` via RPC do PostgREST — incluindo funções de gatilho (ex.: `customers_gamify_on_insert`, `apply_force_bot_on_customer_insert`) e auxiliares (ex.: `clone_bot_flow_as`, `seed_flow_d`, `reset_lead_conversation`, `consume_gemini_token`).

#### Critérios de Aceitação

1. THE Plataforma SHALL converter a visão `public.v_bot_engine_health` para `SECURITY INVOKER`.
2. THE Plataforma SHALL revogar o privilégio `EXECUTE` das roles `anon` e `authenticated` sobre funções SECURITY DEFINER que não são destinadas a serem chamadas pela API, especialmente funções de gatilho.
3. WHEN uma função SECURITY DEFINER existe apenas para uso interno (gatilho ou back-end), THE Plataforma SHALL garantir que ela não seja executável pelas roles `anon` ou `authenticated` via `/rest/v1/rpc/`.
4. THE Plataforma SHALL preservar o privilégio `EXECUTE` apenas para funções que precisam legitimamente ser chamadas via API pelos papéis correspondentes, evitando quebra de funcionalidades em uso.
5. WHEN a remediação for concluída, THE Plataforma SHALL fazer com que o advisor de segurança não reporte mais a visão `v_bot_engine_health` como SECURITY DEFINER nem as funções de gatilho como executáveis por anon/authenticated.
6. THE Plataforma SHALL tratar as alterações de `GRANT`/`REVOKE` e de definição de visão como operação que exige backup dos privilégios atuais e aprovação humana explícita, com plano de rollback e sem misturar mudanças não relacionadas em uma mesma migração.

### Requisito 9 — Proteção contra senhas vazadas no Auth

**História de Usuário:** Como operador da plataforma, quero habilitar a proteção contra senhas vazadas no Supabase Auth, para que usuários não usem senhas comprometidas conhecidas.

**Contexto verificado:** o advisor reporta `auth_leaked_password_protection` desabilitado — a verificação contra o HaveIBeenPwned está desligada.

#### Critérios de Aceitação

1. THE Plataforma SHALL habilitar a proteção contra senhas vazadas (verificação HaveIBeenPwned) no Supabase Auth.
2. WHEN a proteção estiver habilitada, THE Auth SHALL rejeitar a definição de senha que conste como comprometida em uma base de senhas vazadas conhecidas.
3. WHEN a remediação for concluída, THE Plataforma SHALL fazer com que o advisor de segurança não reporte mais a proteção contra senhas vazadas como desabilitada.

### Requisito 10 — Mascaramento de PII em logs

**História de Usuário:** Como responsável de segurança da plataforma, quero que dados pessoais sejam mascarados nos logs, para que OTP, CPF e telefone não sejam registrados em texto claro nos webhooks e na sincronização.

**Contexto verificado:** códigos OTP e payloads brutos de entrada (contendo telefone/CPF) são registrados em texto claro em `whapi-webhook`, `evolution-webhook` (ex.: `console.log("Evolution webhook received:", JSON.stringify(body)...)`) e `sync-igreen-customers`.

#### Critérios de Aceitação

1. WHEN o evolution-webhook ou o whapi-webhook registram um payload de entrada, THE Webhook SHALL mascarar ou redigir CPF e telefone antes de gravar no log.
2. WHEN qualquer função registra um código OTP, THE Edge_Function SHALL mascarar ou omitir o valor do OTP no log.
3. WHEN `sync-igreen-customers` registra dados de clientes ou credenciais, THE Sincronizacao SHALL mascarar CPF, telefone e quaisquer credenciais antes de gravar no log.
4. THE Plataforma SHALL preservar nos logs informação suficiente para diagnóstico (ex.: identificadores internos não sensíveis) sem expor PII em texto claro.
5. THE Plataforma SHALL aplicar o mascaramento de forma consistente nos dois canais (Evolution e Whapi).

### Requisito 11 — Requisitos não-funcionais e de processo (somente-leitura primeiro, reversibilidade, isolamento)

**História de Usuário:** Como operador da plataforma, quero que toda a remediação siga um processo seguro e reversível com aprovação humana, para que as correções de segurança não introduzam indisponibilidade nem regressões em produção.

#### Critérios de Aceitação

1. WHEN uma mudança em banco de dados, política RLS, bucket de armazenamento ou webhook for proposta, THE Processo SHALL exigir um backup do estado atual e aprovação humana explícita antes da aplicação.
2. THE Processo SHALL manter, para cada mudança, um plano de rollback documentado que permita reverter a alteração.
3. THE Processo SHALL impedir que alterações não relacionadas sejam combinadas em uma mesma migração.
4. THE Plataforma SHALL preservar o isolamento multi-tenant em todas as correções, garantindo que nenhum consultor leia clientes, parceiros ou credenciais de outro consultor.
5. WHEN uma mudança de webhook for preparada para rollout, THE Processo SHALL validá-la em ambos os canais (Evolution e Whapi), confirmando supressão de duplicatas.
6. WHERE uma operação for destrutiva ou de difícil reversão, THE Processo SHALL sinalizá-la explicitamente como exigente de backup e aprovação adicionais.
7. THE Processo SHALL reconciliar a árvore de trabalho git atual (que está suja, com alterações não commitadas) antes de iniciar a aplicação das correções, registrando essa reconciliação como pré-condição.

## Premissas e Riscos

- **Árvore de trabalho git suja:** existem alterações não commitadas no repositório no momento da elaboração deste documento. Assume-se que esse trabalho precisa ser reconciliado (commit, stash ou descarte consciente) **antes** de aplicar qualquer correção desta fase, para evitar mistura de mudanças e perda de contexto. Este é um risco a ser tratado como pré-condição (ver Requisito 11.7).
- **Defesa em profundidade vs. vazamento aberto:** o Requisito 6 foi verificado como defesa em profundidade — em produção, apenas donos autenticados/admin acessam `customers` e a role anônima retorna 0 linhas. A correção fecha uma via de abuso por consultor autenticado, não um vazamento público.
- **Compatibilidade de documentos legados:** o Requisito 1 precisa preservar o acesso a URLs públicas de documentos já enviadas; a migração para bucket privado/URLs assinadas não deve quebrar referências existentes (consideração de migração).
- **Escopo restrito a segurança/LGPD:** itens de flow-engine, captação, UX de admin e desempenho estão fora desta fase e serão tratados nas Fases 2 a 6.

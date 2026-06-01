# Requirements Document

## Introduction

Esta feature fecha o ciclo de cadastro automático de clientes no **Portal 2** (iGreen Energy / autoconexao), integrado pelo `worker-portal-2/`. O worker cadastra clientes chamando a API do Portal 2 (HMAC + Playwright como túnel TLS) e, durante o fluxo, invoca os extractors de IA do Portal 2 (`/extractor/extract-document` para RG/CNH e `/extractor/extract-receipt` para a conta de energia) seguidos da criação do cliente (`POST /customers`).

Hoje há três lacunas verificadas no código:

1. **Extração descartada.** Em `worker-portal-2/portal2-api-client.mjs`, a função `cadastrarCliente` chama `await this.extractDocument(...)` e `await this.extractReceipt(...)` sem usar o retorno (fire-and-forget). Só em erro HTTP do extractor é disparado `manualFallback`. Como o retorno é ignorado, não se sabe se a IA do Portal 2 **aceitou e extraiu** os dados (auto-aceito) ou se o cadastro caiu em preenchimento manual.

2. **Sem visibilidade de auto vs manual no escritório.** O componente `src/components/captacao/PortalStatusTracker.tsx` mostra status do cadastro (submitting, aguardando_otp, concluído, erro) e traduz erros via `friendlyPortalError`, mas não mostra se a extração foi **aceita automaticamente** pela IA do Portal 2 nem se a **nossa IA** (Gemini OCR — colunas `ocr_done`, `ocr_confianca`) analisou. O resultado da extração não é persistido para histórico/aprendizado.

3. **Loop de correção incompleto.** Quando `POST /customers` rejeita com erro recuperável, o worker marca `portal2_status='failed'` + `portal2_error` e re-lança (retry do BullMQ), o que reenvia **o mesmo dado errado**. Existe um único caso de auto-correção implementado no step `portal_submitting` do `supabase/functions/evolution-webhook/handlers/bot-flow.ts` (erro "Consumo médio não informado" → recalcula `media_consumo` → `dispatchPortalWorker`). Não existe loop equivalente para telefone duplicado, email duplicado ou instalação duplicada/inválida, nem distinção formal entre erro recuperável e não-recuperável.

O objetivo desta feature é: (A) **capturar e usar** o retorno dos extractors para que o caminho feliz seja auto-aceito; (B) **persistir e exibir** no escritório o resultado da extração e o modo (auto vs manual), respeitando a LGPD; e (C) implementar um **loop de correção via WhatsApp** para erros recuperáveis (telefone, email, instalação) que substitui o dado errado antes de re-despachar, sem repetir o mesmo valor e sem entrar em loop infinito, encaminhando erros não-recuperáveis para intervenção humana.

Este documento é o **plano**. Toda alteração de banco de dados (migration de novas colunas) é tratada como operação que exige aprovação humana explícita antes da aplicação (ver Requisito 10).

## Glossary

- **Portal 2**: sistema externo iGreen Energy / autoconexao (`api-green-connection.igreenenergy.com.br`) com o qual o worker integra via HMAC + Playwright. Inclui os extractors de IA e o endpoint de criação de cliente.
- **IA_Portal2**: a inteligência de extração do Portal 2 exposta pelos endpoints `/extractor/extract-document` e `/extractor/extract-receipt`. É **externa** ao sistema; quem decide aceitar/rejeitar um documento é ela.
- **IA_Gemini**: a OCR/IA do **nosso** lado (Gemini), cujo resultado é registrado nas colunas `ocr_done`, `ocr_confianca`, `ocr_conta_attempts`, `ocr_doc_attempts` da tabela `customers`.
- **Worker_Portal2**: o serviço Node em `worker-portal-2/` (`server.mjs` + `portal2-api-client.mjs`) que processa a fila BullMQ `portal-worker-2-leads` e executa o cadastro.
- **Bot_WhatsApp**: o handler de conversa `supabase/functions/evolution-webhook/handlers/bot-flow.ts` (espelhado em `whapi-webhook/handlers/bot-flow.ts`), que avança por `conversation_step` validando entradas do cliente.
- **Despachante**: o helper `supabase/functions/_shared/portal-worker.ts` → `dispatchPortalWorker(supabase, customerId)`, que monta o payload e envia o lead ao `Worker_Portal2`.
- **Painel_Escritorio**: o componente React `src/components/captacao/PortalStatusTracker.tsx` e a tabela `portal2_audit_traces`, usados pela equipe de escritório para acompanhar cadastros.
- **Extração**: a chamada a um extractor da IA_Portal2 e seu retorno. Para documento (`/extractor/extract-document`, campo multipart `files`) o retorno inclui `{ success, data, raw, error, corrections, idsolcontratovalidacao }`. Para conta (`/extractor/extract-receipt`, campo multipart `file`) inclui `{ success, data, error, corrections, matched, is_authentic, rejection_reason, cross_validation, idsolcontratovalidacao }`.
- **Extração_Aceita_Automática (modo `auto`)**: extração em que a IA_Portal2 retornou `success=true` e leu os dados do documento/conta sem necessidade de preenchimento manual.
- **Extração_Manual (modo `manual`)**: situação em que a IA_Portal2 falhou ao ler o documento/conta (HTTP de erro, `success=false`, ou `error` preenchido), levando o fluxo ao preenchimento manual / `manualFallback`.
- **Modo_Extração**: o campo persistido `portal2_extraction_mode`, com valor `auto` ou `manual`, por cadastro.
- **Erro_Recuperável**: rejeição do `POST /customers` (ou pré-validação) que pode ser resolvida substituindo um dado do cliente e re-despachando. Casos cobertos: telefone duplicado (`duplicatePhone`), email duplicado (`duplicateEmail`), número de instalação duplicado/inválido, e consumo médio ausente (já existente).
- **Erro_Não_Recuperável**: rejeição que não pode ser resolvida por troca de dado pelo bot. Exemplos verificados: CPF/documento duplicado (`duplicateDocument` — não se troca CPF), ausência de cobertura na região ("nenhuma cobertura ativa" / UF não atendida).
- **Classe_de_Erro**: o campo persistido `portal2_error_kind`, que classifica a última rejeição do Portal 2 em um identificador estável (ex.: `duplicate_phone`, `duplicate_email`, `duplicate_installation`, `missing_consumo`, `duplicate_document`, `no_coverage`, `unknown`).
- **Celular_Alternativo_Portal**: o campo persistido `portal2_celular_alt`, usado como `celular` no payload do Portal 2 quando o telefone original é duplicado. É **separado** de `phone_whatsapp`.
- **phone_whatsapp**: chave única da tabela `customers` e canal pelo qual o Bot_WhatsApp conversa com o cliente. NUNCA é sobrescrito pelo Celular_Alternativo_Portal.
- **idsolcontratovalidacao**: identificador da solicitação de validação retornado por `/extractor/init-validation`, usado para correlacionar extractors e a criação do cliente.
- **Tentativas_por_Classe**: contador de quantas vezes uma correção foi tentada para uma mesma Classe_de_Erro em um cadastro, usado para impor o limite que evita loop infinito.
- **Limite_de_Correção**: número máximo de tentativas de correção automática permitidas por Classe_de_Erro por cadastro.
- **PII**: dados pessoais identificáveis (CPF, nome, data de nascimento, RG, telefone, email). Sob a LGPD, devem ser persistidos com mascaramento quando não forem estritamente necessários em claro, seguindo o padrão de `sanitize` em `worker-portal-2/ai-audit.mjs`.
- **LGPD**: Lei Geral de Proteção de Dados (Lei nº 13.709/2018).

## Requirements

### Requisito 1 — Capturar o retorno da extração de documento

**História de Usuário:** Como Worker_Portal2, quero capturar o retorno do extractor de documento da IA_Portal2 em vez de descartá-lo, para saber se o documento foi lido e aceito automaticamente.

**Contexto verificado:** Em `cadastrarCliente`, a chamada `await this.extractDocument({...})` (frente, e verso para RG) tem o retorno ignorado; apenas em exceção HTTP dispara `manualFallback`. O retorno real inclui `{ success, data: { nome, cpf, data_nascimento, validade, tipo_documento, ... }, raw, error, corrections, idsolcontratovalidacao }`.

#### Critérios de Aceitação

1. WHEN o Worker_Portal2 chama o extractor de documento da IA_Portal2, THE Worker_Portal2 SHALL reter em memória o objeto de retorno completo (incluindo os campos `success`, `data`, `error` e `corrections`) e SHALL determinar o resultado da extração do documento antes de invocar a criação do cliente (`POST /customers`).
2. WHEN o extractor de documento retorna um objeto com `success=true` e sem campo `error` preenchido, THE Worker_Portal2 SHALL registrar a extração do documento como Extração_Aceita_Automática.
3. IF o extractor de documento retorna um objeto com `success=false`, ou com o campo `error` preenchido, ou com o campo `success` ausente/nulo, ou retorna um objeto vazio ou nulo, THEN THE Worker_Portal2 SHALL registrar a extração do documento como Extração_Manual.
4. IF a chamada ao extractor de documento lança erro de transporte, retorna status HTTP de erro, ou não responde dentro de 30 segundos, THEN THE Worker_Portal2 SHALL registrar a extração do documento como Extração_Manual e SHALL acionar o `manualFallback` para o `idsolcontratovalidacao` corrente.
5. WHERE o documento possui verso (RG), THE Worker_Portal2 SHALL reter o objeto de retorno da extração da frente e do verso e SHALL registrar a extração do documento como Extração_Aceita_Automática somente quando ambas as chamadas retornarem `success=true` sem campo `error` preenchido; caso contrário SHALL registrar como Extração_Manual.
6. WHEN o Worker_Portal2 determina o resultado da extração de documento, THE Worker_Portal2 SHALL prosseguir com a criação do cliente independentemente de o resultado ser Extração_Aceita_Automática ou Extração_Manual.

### Requisito 2 — Capturar o retorno da extração de conta de energia

**História de Usuário:** Como Worker_Portal2, quero capturar o retorno do extractor de conta da IA_Portal2, para saber se a conta foi lida, considerada autêntica e aceita automaticamente.

**Contexto verificado:** Em `cadastrarCliente`, `await this.extractReceipt({...})` (quando `billAlreadyExtracted` não está setado) tem o retorno ignorado. O retorno real inclui `{ success, data: { nome, documento, valor_pago, tipo_comprovante, beneficiario, ... }, error, corrections, matched, debt_total, receipt_total, is_authentic, rejection_reason, cross_validation, idsolcontratovalidacao }`.

#### Critérios de Aceitação

1. WHEN o Worker_Portal2 chama o extractor de conta da IA_Portal2, THE Worker_Portal2 SHALL reter em memória o objeto de retorno completo (incluindo os campos `success`, `data`, `error`, `is_authentic` e `rejection_reason`) e SHALL determinar o resultado da extração da conta antes de invocar a criação do cliente (`POST /customers`).
2. WHEN o extractor de conta retorna um objeto com `success=true`, `is_authentic=true` e sem campo `error` preenchido, THE Worker_Portal2 SHALL registrar a extração da conta como Extração_Aceita_Automática.
3. IF o extractor de conta retorna um objeto com `success=false`, ou com o campo `error` preenchido, ou com `is_authentic=false`, ou com `success` ou `is_authentic` ausente/nulo, ou retorna um objeto vazio ou nulo, THEN THE Worker_Portal2 SHALL registrar a extração da conta como Extração_Manual.
4. IF a chamada ao extractor de conta lança erro de transporte, retorna status HTTP de erro, ou não responde dentro de 30 segundos, THEN THE Worker_Portal2 SHALL registrar a extração da conta como Extração_Manual e SHALL acionar o `manualFallback` para o `idsolcontratovalidacao` corrente.
5. WHERE a extração da conta já foi executada externamente (`billAlreadyExtracted=true`), THE Worker_Portal2 SHALL preservar o resultado de extração já registrado e SHALL NOT repetir a chamada ao extractor de conta.

### Requisito 3 — Determinar o Modo_Extração do cadastro

**História de Usuário:** Como equipe de escritório, quero que cada cadastro seja classificado como `auto` ou `manual`, para distinguir os cadastros em que a IA_Portal2 aceitou a leitura automaticamente dos que exigiram preenchimento manual.

#### Critérios de Aceitação

1. WHEN todas as extrações obrigatórias de um cadastro (documento e conta; verso quando RG) são Extração_Aceita_Automática, THE Worker_Portal2 SHALL definir `portal2_extraction_mode` como `auto`.
2. IF ao menos uma extração obrigatória de um cadastro é Extração_Manual, THEN THE Worker_Portal2 SHALL definir `portal2_extraction_mode` como `manual`.
3. THE Worker_Portal2 SHALL persistir `portal2_extraction_mode` no registro do cliente em `customers` antes de marcar o job de cadastro como concluído em estado terminal (sucesso ou erro).
4. WHEN o Worker_Portal2 define o Modo_Extração, THE Worker_Portal2 SHALL persistir também, por extractor, o resultado em `portal2_ocr_doc_result` (documento) e `portal2_ocr_bill_result` (conta), conforme o Requisito 4.
5. WHILE o Worker_Portal2 ainda não capturou todas as extrações obrigatórias de um cadastro, THE Worker_Portal2 SHALL manter `portal2_extraction_mode` sem valor definido (nulo) e SHALL NOT apresentar `auto` ou `manual` para esse cadastro.
6. IF a persistência de `portal2_extraction_mode` falhar, THEN THE Worker_Portal2 SHALL registrar a falha em log (sem PII em claro) e SHALL NOT interromper a conclusão do cadastro nem alterar o `idcliente` já criado.

### Requisito 4 — Persistir o resultado da extração para histórico e aprendizado

**História de Usuário:** Como equipe de escritório, quero que o resultado de cada extração seja persistido, para revisar o histórico e aprender com os casos de aceite e de falha, sem expor dados pessoais em claro desnecessariamente.

**Contexto verificado:** A tabela `customers` não possui hoje colunas para o resultado dos extractors. A tabela `portal2_audit_traces` já guarda trace + análise da IA_Gemini (`ai_summary`, `ai_findings`, `input_summary`, `result`) com PII mascarada pelo `sanitize` de `ai-audit.mjs`.

#### Critérios de Aceitação

1. THE Worker_Portal2 SHALL persistir o resultado da extração de documento em `portal2_ocr_doc_result` e o resultado da extração de conta em `portal2_ocr_bill_result` antes de marcar o job de cadastro como concluído, contendo cada resultado, no mínimo: `success` (booleano), modo (`auto` ou `manual`), `error` (quando houver), `corrections` (quando houver) e, para a conta, `is_authentic` (booleano) e `rejection_reason` (quando houver).
2. WHEN o Worker_Portal2 está prestes a persistir um resultado de extração que contém PII (ex.: CPF, nome, data de nascimento), THE Worker_Portal2 SHALL aplicar, antes de gravar o registro, o mascaramento de PII equivalente ao `sanitize` de `ai-audit.mjs` (CPF/documento reduzidos aos 4 últimos dígitos; buffers e base64 omitidos) e SHALL NOT gravar CPF/documento completos nem conteúdo binário/base64 em claro.
3. THE Worker_Portal2 SHALL preservar o `idsolcontratovalidacao` associado ao resultado de extração persistido, para correlação com a criação do cliente.
4. WHERE a auditoria por IA_Gemini está ativa para o cadastro, THE Worker_Portal2 SHALL incluir no registro de `portal2_audit_traces` o Modo_Extração e, para cada extractor, no mínimo `success`, o modo (`auto`/`manual`) e, quando o modo for `manual`, o motivo da queda (`error` do documento ou `rejection_reason` da conta), com a PII mascarada conforme o critério 2.
5. IF a persistência de um resultado de extração falhar, THEN THE Worker_Portal2 SHALL registrar a falha em log (sem PII em claro) e SHALL NOT interromper o cadastro principal nem alterar o `idcliente` já criado.

### Requisito 5 — Exibir auto vs manual e análise de IA no Painel_Escritorio

**História de Usuário:** Como equipe de escritório, quero ver, para cada cadastro, se a extração foi aceita automaticamente ou caiu em manual e se a IA_Gemini analisou, para acompanhar a qualidade da automação.

**Contexto verificado:** `PortalStatusTracker.tsx` faz subscribe realtime em `customers` e `portal2_audit_traces` e exibe status e erros traduzidos, mas não exibe Modo_Extração nem o estado da IA_Gemini.

#### Critérios de Aceitação

1. WHEN o Painel_Escritorio exibe um cadastro com `portal2_extraction_mode='auto'`, THE Painel_Escritorio SHALL apresentar um indicador de "extração aceita automaticamente" visualmente distinto do indicador de manual.
2. WHEN o Painel_Escritorio exibe um cadastro com `portal2_extraction_mode='manual'`, THE Painel_Escritorio SHALL apresentar um indicador de "preenchimento manual" visualmente distinto do indicador de auto.
3. IF o `portal2_extraction_mode` de um cadastro está ausente/nulo ou com valor diferente de `auto`/`manual`, THEN THE Painel_Escritorio SHALL apresentar o estado como "não determinado" e SHALL NOT apresentar os indicadores de auto ou manual.
4. WHEN o Painel_Escritorio exibe um cadastro com `ocr_done=true`, THE Painel_Escritorio SHALL apresentar que a IA_Gemini analisou, incluindo o valor de `ocr_confianca` quando disponível ou "confiança indisponível" quando ausente.
5. WHEN o Painel_Escritorio exibe um cadastro com `ocr_done` ausente/falso, THE Painel_Escritorio SHALL apresentar que a IA_Gemini não analisou.
6. WHEN `portal2_extraction_mode` de um cadastro é atualizado, THE Painel_Escritorio SHALL refletir o novo valor por meio da assinatura realtime existente em `customers`, em no máximo 5 segundos sob conectividade normal, sem exigir recarga manual da página.
7. WHERE o resultado de extração persistido está disponível e o Modo_Extração é `manual`, THE Painel_Escritorio SHALL apresentar o motivo da queda em manual (ex.: `rejection_reason` da conta, `error` do documento).
8. IF o Modo_Extração é `manual` e o motivo da queda não está disponível no resultado persistido, THEN THE Painel_Escritorio SHALL apresentar "motivo não disponível".
9. THE Painel_Escritorio SHALL apresentar dados pessoais oriundos da extração apenas em forma mascarada conforme persistido no Requisito 4, e SHALL NOT reconstruir o dado em claro a partir do registro.

### Requisito 6 — Classificar a rejeição do Portal 2 como recuperável ou não-recuperável

**História de Usuário:** Como Worker_Portal2, quero classificar a rejeição do `POST /customers` em uma Classe_de_Erro estável, para decidir entre acionar o loop de correção ou encaminhar para intervenção humana.

**Contexto verificado:** O `POST /customers` retorna 400 com detalhe dos campos inválidos no body (extraído em `cadastrarCliente` para a mensagem de erro). Mensagens reais conhecidas: `duplicatePhone`, `duplicateDocument`, `duplicateEmail`, instalação já existente (`/customers/check-installation`), `celular` < 14 chars, `cep` < 9 chars, "Consumo médio não informado", "nenhuma cobertura ativa". O `friendlyPortalError` já reconhece textualmente duplicatePhone/duplicateDocument/duplicateEmail e ausência de cobertura.

#### Critérios de Aceitação

1. WHEN o `POST /customers` (ou uma pré-validação correspondente) rejeita um cadastro, THE Worker_Portal2 SHALL classificar a rejeição em EXATAMENTE UMA Classe_de_Erro do conjunto fechado definido no glossário, por correspondência textual case-insensitive sobre a mensagem de detalhe do corpo da rejeição, e SHALL persistir o valor em `portal2_error_kind` antes de concluir o job.
2. WHEN a mensagem de detalhe contém o marcador `duplicatePhone` (ou indica celular/telefone já cadastrado), THE Worker_Portal2 SHALL classificar a Classe_de_Erro como `duplicate_phone` (Erro_Recuperável).
3. WHEN a mensagem de detalhe contém o marcador `duplicateEmail` (ou indica email já cadastrado), THE Worker_Portal2 SHALL classificar a Classe_de_Erro como `duplicate_email` (Erro_Recuperável).
4. WHEN a mensagem de detalhe indica número de instalação duplicado ou inválido, THE Worker_Portal2 SHALL classificar a Classe_de_Erro como `duplicate_installation` (Erro_Recuperável).
5. WHEN a mensagem de detalhe contém o marcador `duplicateDocument` (ou indica CPF/documento já cadastrado), THE Worker_Portal2 SHALL classificar a Classe_de_Erro como `duplicate_document` (Erro_Não_Recuperável).
6. WHEN a mensagem de detalhe contém o marcador "nenhuma cobertura ativa" (ou indica UF/região não atendida), THE Worker_Portal2 SHALL classificar a Classe_de_Erro como `no_coverage` (Erro_Não_Recuperável).
7. IF a mensagem de detalhe não corresponde a nenhuma Classe_de_Erro conhecida, THEN THE Worker_Portal2 SHALL classificar a Classe_de_Erro como `unknown` e tratá-la como Erro_Não_Recuperável.
8. WHEN o Worker_Portal2 persiste `portal2_error_kind`, THE Worker_Portal2 SHALL, na mesma operação, preservar a mensagem de detalhe da rejeição em `portal2_error`, truncada a no máximo 2000 caracteres, para diagnóstico.
9. WHEN a mensagem de detalhe indica consumo médio ausente (marcador "Consumo médio não informado"), THE Worker_Portal2 SHALL classificar a Classe_de_Erro como `missing_consumo` (Erro_Recuperável).
10. IF a mensagem de detalhe corresponde a mais de uma Classe_de_Erro, THEN THE Worker_Portal2 SHALL aplicar precedência das classes Não_Recuperáveis sobre as Recuperáveis para garantir classificação determinística.

### Requisito 7 — Loop de correção via WhatsApp para erros recuperáveis

**História de Usuário:** Como cliente em cadastro, quero ser solicitado a corrigir apenas o dado que o Portal 2 rejeitou, para que meu cadastro avance até o fim sem reenviar o mesmo dado errado.

**Contexto verificado:** O step `portal_submitting` do `bot-flow.ts` já implementa um caso de correção (consumo médio): detecta o erro, ajusta `media_consumo`, persiste e chama `dispatchPortalWorker`. Os steps `ask_phone`, `ask_email`, `ask_installation_number` já existem com validação de entrada (telefone ≥ 10 dígitos grava `phone_landline`; email exige `@`; instalação ≥ 7 dígitos). A coluna `phone_landline` é gravada sem tocar `phone_whatsapp`.

#### Critérios de Aceitação

1. WHEN um cadastro é rejeitado com Classe_de_Erro recuperável, THE Bot_WhatsApp SHALL solicitar ao cliente, via mensagem enviada para `phone_whatsapp`, exclusivamente o dado correspondente à Classe_de_Erro (`duplicate_phone` → celular alternativo; `duplicate_email` → email; `duplicate_installation` → número de instalação).
2. WHEN o cliente responde com um novo valor para a correção, THE Bot_WhatsApp SHALL validar o formato antes de aceitá-lo: telefone com no mínimo 10 dígitos; email com ao menos 1 caractere antes e 1 depois de `@`; número de instalação com no mínimo 7 dígitos.
3. IF o novo valor informado pelo cliente é inválido para a Classe_de_Erro corrente, THEN THE Bot_WhatsApp SHALL solicitar novamente o dado indicando o formato esperado, SHALL manter o passo de correção corrente e SHALL NOT re-despachar o cadastro.
4. WHEN um novo valor válido é recebido para a correção, THE Bot_WhatsApp SHALL persistir o novo valor no campo correspondente e acionar o Despachante para re-despachar o cadastro ao Worker_Portal2.
5. WHEN o cadastro é re-despachado após uma correção, THE Worker_Portal2 SHALL usar o novo valor no payload enviado ao Portal 2, substituindo o valor anteriormente rejeitado.
6. WHEN uma correção de email é aplicada, THE Bot_WhatsApp SHALL gravar o novo email no campo `email` do cliente.
7. WHEN uma correção de número de instalação é aplicada, THE Bot_WhatsApp SHALL gravar o novo número em `numero_instalacao` do cliente.

### Requisito 8 — Celular alternativo do portal separado do canal de conversa

**História de Usuário:** Como responsável pela conversa do bot, quero que o telefone alternativo enviado ao Portal 2 fique em um campo separado, para que o canal de conversa (`phone_whatsapp`) nunca seja sobrescrito.

**Contexto verificado:** `phone_whatsapp` é chave única de `customers` e é o número por onde o bot conversa. O código de `ask_phone` já documenta que NÃO se deve atualizar `phone_whatsapp` (causa duplicate key); telefones de contato vão para `phone_landline`. O payload do Portal 2 monta `celular: formatPhone(d.whatsapp)`.

#### Critérios de Aceitação

1. WHEN a Classe_de_Erro é `duplicate_phone`, THE Bot_WhatsApp SHALL solicitar ao cliente um número de celular alternativo com no mínimo 10 dígitos e diferente do `phone_whatsapp` atual.
2. WHEN um celular alternativo válido (≥10 dígitos e diferente de `phone_whatsapp`) é recebido, THE Bot_WhatsApp SHALL persistir o valor em `portal2_celular_alt` e SHALL NOT alterar `phone_whatsapp`.
3. IF o celular alternativo informado é inválido (menos de 10 dígitos) ou igual ao `phone_whatsapp`, THEN THE Bot_WhatsApp SHALL rejeitar o valor, solicitar novamente um número diferente, SHALL NOT persistir e SHALL NOT re-despachar o cadastro.
4. WHEN o cadastro é re-despachado após uma correção de `duplicate_phone`, THE Worker_Portal2 SHALL usar `portal2_celular_alt` como `celular` no payload do Portal 2.
5. WHILE existir um valor em `portal2_celular_alt`, THE Worker_Portal2 SHALL priorizar `portal2_celular_alt` sobre o telefone original ao montar o campo `celular` do payload do Portal 2.
6. THE Bot_WhatsApp SHALL continuar enviando todas as mensagens da conversa para `phone_whatsapp`, independentemente do valor de `portal2_celular_alt`.

### Requisito 9 — Prevenção de repetição do mesmo erro e de loop infinito

**História de Usuário:** Como operador da plataforma, quero que o loop de correção nunca reenvie o mesmo dado rejeitado e tenha um limite de tentativas por tipo de erro, para que cadastros não fiquem presos em loop.

#### Critérios de Aceitação

1. WHEN o Worker_Portal2 re-despacha um cadastro após correção, THE Worker_Portal2 SHALL garantir que o valor do campo corrigido, após normalização (desconsiderando espaços, símbolos de formatação e diferenças de maiúsculas/minúsculas), é diferente do valor que originou a rejeição anterior daquela Classe_de_Erro.
2. IF o novo valor informado para uma correção, após normalização, é igual ao valor anteriormente rejeitado para a mesma Classe_de_Erro, THEN THE Bot_WhatsApp SHALL rejeitar o valor, solicitar um valor diferente e SHALL NOT re-despachar o cadastro.
3. THE sistema SHALL manter, por cadastro e por Classe_de_Erro, um contador de Tentativas_por_Classe inicializado em 0.
4. WHEN uma correção é re-despachada para uma Classe_de_Erro, THE sistema SHALL incrementar em 1 o contador de Tentativas_por_Classe correspondente.
5. IF o contador de Tentativas_por_Classe atinge ou excede o Limite_de_Correção para uma Classe_de_Erro, THEN THE sistema SHALL encerrar o loop de correção para essa Classe_de_Erro, SHALL NOT re-despachar o cadastro e SHALL sinalizar o cadastro como necessitando intervenção humana, conforme o Requisito 10.
6. THE sistema SHALL definir o Limite_de_Correção como exatamente 3 tentativas por Classe_de_Erro por cadastro.

### Requisito 10 — Sinalização de erros não-recuperáveis e de loop esgotado para intervenção humana

**História de Usuário:** Como equipe de escritório, quero ver claramente quando um cadastro precisa de intervenção humana, para agir nos casos que o loop automático não resolve.

**Contexto verificado:** `PortalStatusTracker.tsx` já exibe um banner de erro com prioridade máxima quando há erro do portal, com botão "Reenviar ao portal" (chama `finalize-capture`). O `friendlyPortalError` já produz mensagens específicas para CPF duplicado e ausência de cobertura.

#### Critérios de Aceitação

1. WHEN um cadastro é rejeitado com Classe_de_Erro não-recuperável, THE sistema SHALL sinalizar o cadastro como necessitando intervenção humana e SHALL NOT iniciar o loop de correção automática.
2. WHEN um cadastro esgota o Limite_de_Correção para uma Classe_de_Erro recuperável, THE sistema SHALL sinalizar o cadastro como necessitando intervenção humana.
3. WHEN o Painel_Escritorio exibe um cadastro que necessita intervenção humana, THE Painel_Escritorio SHALL apresentar uma mensagem que identifique a Classe_de_Erro e indique que é necessária ação manual.
4. WHILE um cadastro está sinalizado como necessitando intervenção humana por Classe_de_Erro não-recuperável, THE Bot_WhatsApp SHALL NOT solicitar correção automática de dados ao cliente para essa Classe_de_Erro.
5. THE Painel_Escritorio SHALL manter disponível a ação manual de reenviar o cadastro ao portal para os casos que necessitam intervenção humana.

### Requisito 11 — Migração de banco de dados controlada

**História de Usuário:** Como responsável pelo banco, quero que as novas colunas sejam adicionadas de forma não-destrutiva e aprovada, para preservar a integridade dos dados existentes.

**Contexto verificado:** A tabela `customers` (1013 linhas) já possui `portal2_status`, `portal2_error`, `portal2_idcliente`, `portal2_idsolcontratovalidacao`, `portal2_contract_link`, `portal2_created_at`, `portal2_otp_sent_at`, `portal2_otp_validated_at`, `ocr_done`, `ocr_confianca`, `phone_whatsapp` (única), `phone_landline`, `email`, `numero_instalacao`. As novas colunas previstas são: `portal2_celular_alt`, `portal2_ocr_doc_result`, `portal2_ocr_bill_result`, `portal2_extraction_mode`, `portal2_error_kind`, e o(s) contador(es) de Tentativas_por_Classe.

#### Critérios de Aceitação

1. THE migração SHALL adicionar as novas colunas (`portal2_celular_alt`, `portal2_ocr_doc_result`, `portal2_ocr_bill_result`, `portal2_extraction_mode`, `portal2_error_kind` e o armazenamento de Tentativas_por_Classe) e SHALL NOT remover, renomear ou alterar o tipo de colunas existentes.
2. THE migração SHALL definir as novas colunas como anuláveis ou com valor padrão, de modo que as linhas existentes de `customers` permaneçam legíveis sem violação de NOT NULL e sem alteração dos valores já gravados.
3. WHERE `portal2_extraction_mode` é definido com restrição de valores, THE migração SHALL aceitar somente os valores `auto`, `manual` e NULL, e SHALL rejeitar quaisquer outros valores.
4. THE migração SHALL preservar a restrição de unicidade de `phone_whatsapp` e SHALL NOT introduzir unicidade sobre `portal2_celular_alt`.
5. THE feature SHALL tratar a aplicação da migração como operação que exige aprovação humana explícita registrada e SHALL NOT aplicá-la no banco de produção sem essa aprovação.
6. THE migração SHALL definir o armazenamento de Tentativas_por_Classe com valor padrão 0 e restrito a inteiros não-negativos.

### Requisito 12 — Proteção de PII dos dados extraídos (LGPD)

**História de Usuário:** Como responsável de conformidade, quero que os dados pessoais extraídos sejam tratados conforme a LGPD em todo o ciclo de captura, persistência e exibição, para evitar exposição indevida.

#### Critérios de Aceitação

1. WHEN o Worker_Portal2 está prestes a persistir resultados de extração em `portal2_ocr_doc_result`, `portal2_ocr_bill_result` ou `portal2_audit_traces`, THE Worker_Portal2 SHALL mascarar CPF e documento mantendo no máximo os 4 últimos dígitos.
2. WHEN o Worker_Portal2 persiste resultados de extração, THE Worker_Portal2 SHALL omitir conteúdo binário e base64 de documentos (buffers, imagens) dos registros gravados.
3. WHEN o Painel_Escritorio exibe dados pessoais oriundos da extração, THE Painel_Escritorio SHALL apresentá-los somente na forma mascarada já persistida e SHALL NOT reconstruir o dado em claro a partir do registro.
4. WHEN um log é emitido durante o loop de correção, THE sistema SHALL NOT registrar em claro o valor completo de CPF e do documento do cliente, limitando-se a no máximo os 4 últimos dígitos.
5. THE sistema SHALL armazenar o Celular_Alternativo_Portal (`portal2_celular_alt`) aplicando as mesmas regras de armazenamento, acesso e mascaramento já aplicadas a `phone_whatsapp` e `phone_landline`.

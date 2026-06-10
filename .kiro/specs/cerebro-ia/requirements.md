# Requirements Document

> Documento de Requisitos — Cérebro IA (conteúdo em português do Brasil).

## Introduction

O Cérebro IA é um módulo novo e isolado, escrito 100% em TypeScript/Deno, que une
o construtor visual de fluxos (a tela onde o consultor monta o passo a passo do
atendimento) com a IA vendedora que conversa no WhatsApp. Hoje existem dois mundos
separados que não se conversam:

1. O motor de fluxo determinístico (engine v3), que lê os passos montados no
   construtor visual (tabela `bot_flow_steps`) e segue exatamente o que foi montado.
2. A IA vendedora (Fluxo B), que ignora o construtor visual e roda uma sequência de
   etapas fixa, escrita direto no código (nome → valor → simulação → consideração →
   foto → documento → e-mail).

A consequência é que aquilo que o consultor monta no construtor visual não comanda a
IA. Para mudar o comportamento da conversa, é preciso mexer no código. O Cérebro IA
resolve esse problema fazendo a ordem dos passos vir sempre dos dados (`bot_flow_steps`),
e deixando a IA responsável apenas por entender o cliente e escrever a mensagem.

O Cérebro IA é **aditivo** (não apaga nada que já existe), **reversível** (pode ser
desligado a qualquer momento) e fica atrás da chave de ativação que já existe
(`flow_engine_v3`, com os modos: desligado, sombra, canário e ligado). Ele começa em
**modo sombra**: decide qual seria a próxima ação e registra essa decisão para
comparação, mas **não envia** nada para o cliente. Quem continua respondendo é o
sistema atual, até a comparação provar que o Cérebro decide igual ou melhor.

Esta spec documenta os requisitos para validar todo o plano antes de qualquer
implementação. Nenhum código é escrito a partir deste documento; ele serve para
alinhar o que o Cérebro deve fazer.

## Glossary

- **Cerebro**: módulo novo em TypeScript que coordena entendimento, decisão de passo,
  habilidades, escrita de mensagem e guarda de segurança. Vive em
  `supabase/functions/_shared/cerebro/`.
- **Construtor_Visual**: tela onde o consultor monta os passos do atendimento, gravados
  na tabela `bot_flow_steps`.
- **Engine_V3**: motor de fluxo determinístico já existente
  (`supabase/functions/_shared/engine/`) que lê `bot_flow_steps` e decide a próxima ação
  de forma previsível, sem inventar.
- **Vendedora_Atual**: IA vendedora do Fluxo B já existente
  (`supabase/functions/_shared/vendedora/`), que hoje usa uma sequência de etapas fixa
  no código (`state-machine.ts`).
- **Entendimento**: peça do Cérebro (`entendimento.ts`) que lê a mensagem do cliente e
  identifica a intenção comercial, os dados citados e a objeção.
- **Estado_Memoria**: peça do Cérebro (`estado.ts`) que lê e atualiza o estado do
  cliente nas tabelas `customer_flow_state` e na coluna `fluxo_b_state`, campo a campo,
  guardando histórico para diagnóstico.
- **Decisor_Passo**: peça central do Cérebro (`decisor-passo.ts`) que lê os passos
  montados no Construtor_Visual (via Engine_V3) e decide qual é o próximo passo.
- **Habilidade**: função nomeada e testável dentro de `cerebro/habilidades/` (ex.:
  analisar conta de luz, explicar economia, tratar objeção).
- **Escritor**: peça do Cérebro (`escritor.ts`) que apenas escreve a mensagem final ao
  cliente, sem decidir o passo.
- **Guarda_Seguranca**: peça do Cérebro (`guarda.ts`) que aplica as travas de segurança
  antes de qualquer mensagem sair.
- **Conector_IA**: peça do Cérebro (`conector-ia.ts`), camada fina sobre o gateway de
  IA existente, que permite trocar o provedor de IA (Lovable, GPT, Gemini) mexendo só
  nessa peça.
- **Chave_Ativacao**: a coluna `flow_engine_v3` na tabela `consultants`, com os modos
  `off` (desligado), `dark` (sombra), `canary` (canário) e `on` (ligado).
- **Modo_Sombra**: estado em que o Cerebro decide e registra a decisão em `ai_decisions`,
  mas não envia mensagem ao cliente.
- **Registro_Decisao**: linha gravada na tabela `ai_decisions` com a decisão do Cerebro
  e a comparação com a saída do sistema atual.
- **Intencao_Comercial**: rótulo curto e fechado que descreve o que o cliente quer
  naquele momento (ex.: demonstrar interesse, pedir simulação, levantar objeção, pedir
  atendente humano, desistir).
- **Painel_Automacoes**: tela em `src/components/admin/` onde o consultor liga e desliga
  automações no formato gatilho automático → ação.
- **Pre_Visualizacao**: recurso do Construtor_Visual (FlowSimulator) que mostra a
  conversa rodando antes de publicar.
- **Termo_Comercial**: palavra em português comercial usada no lugar de termo técnico
  (ex.: "dados enviados" no lugar de "payload").
- **Consultor**: pessoa dona da conta que atende clientes pelo WhatsApp.
- **Cliente**: pessoa interessada que conversa com a IA no WhatsApp.

## Requirements

### Requisito 1 — Módulo isolado em TypeScript

**História do usuário:** Como responsável técnico do produto, quero que o Cérebro seja
um módulo novo e isolado em TypeScript, para que eu adote a unificação sem reescrever o
que já funciona e sem trazer dependências pesadas.

#### Critérios de Aceitação

1. THE Cerebro SHALL ser escrito 100% em TypeScript executável no runtime Deno das Edge
   Functions do Supabase.
2. THE Cerebro SHALL ficar contido no diretório `supabase/functions/_shared/cerebro/`.
3. THE Cerebro SHALL reutilizar Engine_V3, RAG, memória, gateway de IA e travas de
   segurança já existentes em vez de recriar funções equivalentes.
4. WHERE uma funcionalidade já existe em outro módulo compartilhado, THE Cerebro SHALL
   importar essa funcionalidade em vez de duplicá-la.
5. THE Cerebro SHALL operar sem adicionar dependência externa que precise de instalação
   além das já presentes no projeto.

### Requisito 2 — Ativação aditiva e reversível

**História do usuário:** Como responsável pela operação, quero que o Cérebro fique
atrás da chave de ativação existente e possa ser desligado a qualquer momento, para que
eu controle o risco sem mexer no código.

#### Critérios de Aceitação

1. THE Cerebro SHALL ler o modo de operação a partir da Chave_Ativacao (`flow_engine_v3`)
   com os valores `off`, `dark`, `canary` e `on`.
2. WHILE a Chave_Ativacao está em `off`, THE Cerebro SHALL permanecer inativo e não
   alterar o comportamento do sistema atual.
3. WHILE a Chave_Ativacao está em `dark`, THE Cerebro SHALL calcular e registrar a
   decisão sem enviar mensagem ao Cliente.
4. WHILE a Chave_Ativacao está em `canary`, THE Cerebro SHALL responder apenas para o
   subconjunto de Consultores definido na configuração de rollout.
5. WHILE a Chave_Ativacao está em `on`, THE Cerebro SHALL responder para todos os
   Clientes do Consultor habilitado.
6. THE Cerebro SHALL deixar o sistema atual funcionar sem alteração quando a
   Chave_Ativacao está em qualquer valor diferente de `on`.

### Requisito 3 — Início em modo sombra

**História do usuário:** Como responsável pela qualidade, quero que o Cérebro comece em
modo sombra comparando suas decisões com a saída atual, para que eu só avance quando
houver prova de que ele decide igual ou melhor.

#### Critérios de Aceitação

1. WHILE o Cerebro está em Modo_Sombra, THE Cerebro SHALL gravar um Registro_Decisao na
   tabela `ai_decisions` a cada turno processado.
2. WHILE o Cerebro está em Modo_Sombra, THE Cerebro SHALL incluir no Registro_Decisao a
   decisão calculada pelo Cerebro e a saída produzida pelo sistema atual no mesmo turno.
3. WHILE o Cerebro está em Modo_Sombra, THE Cerebro SHALL impedir o envio de qualquer
   mensagem calculada por ele ao Cliente.
4. WHEN o Cerebro grava um Registro_Decisao de comparação, THE Cerebro SHALL marcar se a
   decisão do Cerebro coincide com a do sistema atual.

### Requisito 4 — Entendimento da mensagem do cliente

**História do usuário:** Como Consultor, quero que o Cérebro entenda o que o cliente
quis dizer, para que a resposta seja coerente com a intenção, os dados citados e a
objeção do cliente.

#### Critérios de Aceitação

1. WHEN uma mensagem do Cliente é recebida, THE Entendimento SHALL identificar a
   Intencao_Comercial a partir de um conjunto pequeno e fechado de intenções comerciais.
2. WHEN uma mensagem do Cliente contém dados de cadastro (como nome, valor da conta ou
   e-mail), THE Entendimento SHALL extrair esses dados reutilizando os extratores
   existentes da Vendedora_Atual.
3. WHEN uma mensagem do Cliente contém uma objeção, THE Entendimento SHALL classificar o
   tipo da objeção.
4. IF a Intencao_Comercial não corresponde a nenhuma intenção do conjunto fechado, THEN
   THE Entendimento SHALL classificar a mensagem como intenção indefinida.
5. THE Entendimento SHALL evitar criar um catálogo amplo de intenções, mantendo apenas o
   conjunto pequeno de intenções comerciais.

### Requisito 5 — Estado e memória do cliente

**História do usuário:** Como Consultor, quero que o Cérebro lembre o ponto em que cada
cliente parou e atualize os dados sem perder o que já tinha, para que a conversa seja
retomável e auditável.

#### Critérios de Aceitação

1. THE Estado_Memoria SHALL ler o estado do Cliente a partir de `customer_flow_state` e
   da coluna `fluxo_b_state`.
2. WHEN um campo do estado do Cliente é atualizado, THE Estado_Memoria SHALL alterar
   apenas o campo modificado, preservando os demais campos do estado.
3. WHEN o estado do Cliente é alterado, THE Estado_Memoria SHALL registrar a alteração no
   histórico de checkpoints para fins de diagnóstico.
4. WHEN uma conversa é retomada após uma pausa, THE Estado_Memoria SHALL restaurar o
   estado salvo do Cliente sem reiniciar o cadastro.

### Requisito 6 — Decisor de passo a partir do construtor visual

**História do usuário:** Como Consultor, quero que a próxima etapa da conversa venha do
que eu montei no construtor visual, para que eu mude o comportamento da IA sem precisar
de programação.

#### Critérios de Aceitação

1. WHEN um turno de conversa é processado, THE Decisor_Passo SHALL ler os passos
   montados no Construtor_Visual (`bot_flow_steps`) por meio do Engine_V3 e decidir o
   próximo passo a partir desses dados.
2. THE Decisor_Passo SHALL determinar a ordem dos passos a partir dos dados de
   `bot_flow_steps`, sem usar uma sequência de etapas fixa escrita no código.
3. WHEN o Consultor altera os passos no Construtor_Visual, THE Decisor_Passo SHALL passar
   a decidir conforme os passos atualizados sem alteração de código.
4. THE Decisor_Passo SHALL usar uma única fonte para a etapa atual, derivada do fluxo
   determinístico, sem manter um detector de etapa por IA em paralelo.
5. WHEN o Cliente corrige um dado já informado, THE Decisor_Passo SHALL aplicar o padrão
   de reparo correspondente e retomar o passo apropriado do fluxo.
6. WHEN o Cliente faz uma pergunta fora do momento esperado, THE Decisor_Passo SHALL
   tratar a pergunta e reancorar no passo atual do fluxo.
7. WHEN o Cliente pede para cancelar, THE Decisor_Passo SHALL aplicar o padrão de reparo
   de cancelamento previsto no fluxo.

### Requisito 7 — Habilidades nomeadas e testáveis

**História do usuário:** Como responsável pela manutenção, quero que as ações da IA
sejam funções nomeadas e testáveis, para que cada capacidade possa ser verificada e
ajustada de forma isolada.

#### Critérios de Aceitação

1. THE Cerebro SHALL expor cada Habilidade como uma função nomeada dentro de
   `cerebro/habilidades/`.
2. THE Cerebro SHALL disponibilizar Habilidades para analisar conta de luz, explicar
   economia, tratar objeção, consultar situação do Cliente, gerar mensagem, identificar
   Cliente quente, encaminhar para Consultor, recuperar Cliente parado e resumir conversa.
3. WHERE uma Habilidade depende de OCR, cálculo de economia ou fechamento de cadastro,
   THE Habilidade SHALL reutilizar os módulos existentes em vez de reimplementar a lógica.
4. THE Cerebro SHALL permitir que cada Habilidade seja chamada e verificada de forma
   isolada das demais.

### Requisito 8 — Escritor da mensagem

**História do usuário:** Como Consultor, quero que a escrita da mensagem fique separada
da decisão do passo, para que a IA escreva bem sem mudar a ordem do fluxo.

#### Critérios de Aceitação

1. THE Escritor SHALL escrever a mensagem final ao Cliente sem decidir qual é o próximo
   passo.
2. WHEN o Decisor_Passo define o passo atual, THE Escritor SHALL gerar a mensagem
   correspondente a esse passo.
3. THE Escritor SHALL reutilizar o gateway de IA, o RAG e a memória já existentes para
   compor a mensagem.
4. THE Escritor SHALL produzir todas as mensagens ao Cliente em português do Brasil
   comercial.

### Requisito 9 — Guarda de segurança da IA

**História do usuário:** Como responsável pela operação, quero uma trava de segurança
que valide toda mensagem antes do envio, para que a IA não invente informação nem exponha
dados técnicos ao cliente.

#### Critérios de Aceitação

1. IF uma mensagem contém informação não confirmada pelos dados do Cliente ou pela base
   de conhecimento, THEN THE Guarda_Seguranca SHALL bloquear o envio e acionar uma
   resposta segura.
2. IF uma mensagem contém chave de integração, token ou erro técnico, THEN THE
   Guarda_Seguranca SHALL remover esse conteúdo antes do envio.
3. IF uma mensagem pede um dado do Cliente antes do passo previsto no fluxo, THEN THE
   Guarda_Seguranca SHALL bloquear o envio e reancorar no passo atual.
4. IF uma mensagem usa termo técnico voltado ao Cliente, THEN THE Guarda_Seguranca SHALL
   substituí-lo pelo Termo_Comercial correspondente.
5. IF uma ação tenta alterar um dado do Cliente sem regra definida no fluxo, THEN THE
   Guarda_Seguranca SHALL bloquear a alteração.
6. IF uma mensagem seria enviada fora das regras do fluxo, THEN THE Guarda_Seguranca
   SHALL impedir o envio.
7. THE Guarda_Seguranca SHALL consolidar as travas determinísticas existentes em um único
   ponto de verificação antes do envio.

### Requisito 10 — Conector de IA trocável

**História do usuário:** Como responsável técnico, quero trocar o provedor de IA mexendo
em uma única peça, para que mudanças de modelo não afetem o resto do Cérebro.

#### Critérios de Aceitação

1. THE Conector_IA SHALL expor uma interface única para o restante do Cerebro chamar a
   IA, sem que as demais peças conheçam o provedor escolhido.
2. THE Conector_IA SHALL encapsular o gateway de IA existente e a cascata de modelos.
3. WHEN o provedor de IA é trocado, THE Conector_IA SHALL concentrar a alteração nessa
   peça, sem mudança no Decisor_Passo, no Escritor ou no Entendimento.
4. THE Conector_IA SHALL respeitar o controle de custo de IA existente em cada chamada.

### Requisito 11 — Construtor visual melhor

**História do usuário:** Como Consultor, quero pré-visualizar a conversa e montar os
passos com blocos claros, para que eu valide o atendimento antes de publicar.

#### Critérios de Aceitação

1. THE Construtor_Visual SHALL oferecer a Pre_Visualizacao da conversa rodando antes da
   publicação, reutilizando o FlowSimulator existente.
2. THE Construtor_Visual SHALL oferecer blocos claros para botão, espera, encaminhar para
   atendente humano e finalizar.
3. WHEN o Consultor monta um passo com bloco de escolha, THE Construtor_Visual SHALL
   validar que o passo tem ao menos duas opções antes de permitir publicar.
4. THE Construtor_Visual SHALL apresentar os rótulos dos blocos em português comercial.

### Requisito 12 — Painel de automações

**História do usuário:** Como Consultor, quero uma tela para ligar e desligar automações
no formato gatilho → ação, para que eu controle follow-up, recuperação e campanha sem
ajuda técnica.

#### Critérios de Aceitação

1. THE Painel_Automacoes SHALL listar as automações no formato gatilho automático → ação.
2. THE Painel_Automacoes SHALL permitir ligar e desligar cada automação de forma
   individual.
3. WHEN o Consultor desliga uma automação, THE Painel_Automacoes SHALL impedir que essa
   automação dispare novas ações.
4. THE Painel_Automacoes SHALL reutilizar os agendamentos existentes de follow-up e
   recuperação em vez de criar novos mecanismos de disparo.

### Requisito 13 — Linguagem em português comercial

**História do usuário:** Como Consultor sem formação técnica, quero que toda a interface
e as respostas usem português comercial, para que eu entenda tudo sem conhecer termos de
programação.

#### Critérios de Aceitação

1. THE Cerebro SHALL apresentar toda interface voltada ao Consultor e toda mensagem ao
   Cliente em português do Brasil comercial.
2. WHERE um termo técnico apareceria na interface ou na mensagem, THE Cerebro SHALL
   substituí-lo pelo Termo_Comercial correspondente (por exemplo: dados enviados em vez
   de payload; integração automática em vez de webhook; etapa em vez de node; gatilho
   automático em vez de trigger; fluxo de atendimento em vez de flow; cliente interessado
   em vez de lead; endereço de integração em vez de endpoint; chave de integração em vez
   de token; integração em vez de api; diagnóstico em vez de debug; não informado em vez
   de undefined ou null; não foi possível concluir em vez de error).

### Requisito 14 — Substituição gradual da sequência fixa

**História do usuário:** Como responsável pela qualidade, quero que o Decisor de Passo
substitua a sequência fixa aos poucos, para que a migração seja segura e reversível.

#### Critérios de Aceitação

1. THE Cerebro SHALL substituir a sequência de etapas fixa da Vendedora_Atual de forma
   gradual, mantendo a Vendedora_Atual disponível enquanto a Chave_Ativacao não está em
   `on`.
2. WHILE a Chave_Ativacao está em `dark` ou `canary`, THE Cerebro SHALL manter a
   Vendedora_Atual como responsável pelas mensagens efetivamente enviadas.
3. WHEN a comparação de decisões atinge a métrica de sucesso definida para um estágio,
   THE Cerebro SHALL permitir o avanço para o próximo estágio do rollout.

### Requisito 15 — Métricas de sucesso do rollout

**História do usuário:** Como responsável pela operação, quero uma métrica de sucesso
para sair de cada estágio do rollout, para que a decisão de avançar seja baseada em dados.

#### Critérios de Aceitação

1. THE Cerebro SHALL calcular a taxa de coincidência entre as decisões do Cerebro e as do
   sistema atual a partir dos Registro_Decisao gravados.
2. THE Cerebro SHALL registrar a métrica de coincidência por estágio de rollout (`dark`,
   `canary`, `on`).
3. WHERE a métrica de coincidência de um estágio fica abaixo do limite definido na
   configuração de rollout, THE Cerebro SHALL sinalizar que o estágio não está apto a
   avançar.

### Requisito 16 — Restrições de não interferência

**História do usuário:** Como responsável pela estabilidade, quero que o Cérebro não
toque nas proteções e integrações críticas existentes, para que a unificação não
introduza risco de bloqueio de número nem quebre o WhatsApp.

#### Critérios de Aceitação

1. THE Cerebro SHALL operar sem alterar o mecanismo de anti-ban existente.
2. THE Cerebro SHALL operar sem alterar o trio de proteção do webhook (deduplicação,
   trava, lock e limite de taxa).
3. THE Cerebro SHALL operar sem alterar a integração de WhatsApp (Evolution e Whapi).
4. THE Cerebro SHALL operar sem modificar migrações de banco já aplicadas.
5. THE Cerebro SHALL respeitar o controle de custo de IA existente por Consultor.

### Requisito 17 — Reúso das tabelas e flags existentes

**História do usuário:** Como responsável pelos dados, quero que o Cérebro reutilize as
tabelas e flags que já existem, para que não haja duplicação de estruturas no banco.

#### Critérios de Aceitação

1. THE Cerebro SHALL reutilizar as tabelas existentes `bot_flows`, `bot_flow_steps`,
   `customer_flow_state`, `ai_agent_config`, `ai_decisions`, `ai_knowledge_sections`,
   `flow_router_rules` e `rollout_config`.
2. THE Cerebro SHALL reutilizar as colunas existentes da tabela `consultants`:
   `flow_engine_v3`, `flow_reliability_v2`, `conversational_flow_enabled` e
   `ai_persona_fluxo_b`.
3. THE Cerebro SHALL gravar suas decisões na tabela existente `ai_decisions` sem criar
   uma tabela equivalente.

### Requisito 18 — Segurança das referências (somente leitura, nunca execução)

**História do usuário:** Como responsável pela segurança, quero que os projetos de
referência sejam usados apenas como leitura de ideias e nunca executados ou expostos,
para que falhas conhecidas desses projetos não entrem no meu sistema.

#### Critérios de Aceitação

1. THE Cerebro SHALL ser construído sem importar, empacotar ou executar código de
   qualquer projeto de referência clonado.
2. THE projeto SHALL manter os clones de referência apenas em pasta temporária ignorada
   pelo controle de versão, sem expô-los em nenhum endpoint.
3. WHEN a extração de ideias dos clones termina, THE projeto SHALL permitir apagar os
   clones sem afetar o sistema.
4. THE Cerebro SHALL não introduzir nenhum ponto que aceite ou execute código arbitrário
   vindo de configuração de fluxo.

### Requisito 19 — Glossário único de linguagem do cliente

**História do usuário:** Como Consultor, quero que cada conceito tenha um único nome em
português comercial em toda a interface e nas mensagens, para que cliente e consultor
nunca vejam jargão técnico.

#### Critérios de Aceitação

1. THE Cerebro SHALL adotar um glossário único que mapeia termo técnico para
   Termo_Comercial e usá-lo em toda interface e mensagem ao Cliente.
2. THE glossário SHALL incluir, no mínimo: intenção como "assunto"; atendimento
   inteligente no lugar de agente; fluxo de atendimento no lugar de fluxo técnico; base
   de conteúdo no lugar de base de conhecimento; histórico útil no lugar de memória;
   transferir para atendente no lugar de handoff; ação automática no lugar de ferramenta;
   consumo no lugar de uso de token.
3. WHERE um mesmo conceito aparece no banco, na interface e nas mensagens, THE Cerebro
   SHALL usar um único nome para esse conceito.

### Requisito 20 — Camadas de memória separadas

**História do usuário:** Como Consultor, quero que a memória do cliente seja organizada
em camadas, para que dado estável, conversa atual e conteúdo institucional não se
misturem numa memória única confusa.

#### Critérios de Aceitação

1. THE Estado_Memoria SHALL separar a memória em quatro camadas: memória de sessão
   (resumo da conversa atual), memória de perfil (dados estáveis do Cliente), memória
   operacional (cadastro, pendências, próximos passos) e base de conteúdo (conteúdo
   institucional para consulta).
2. THE memória de sessão e a memória de perfil SHALL ser reaproveitadas a partir das
   estruturas já existentes (`conversation_summary` e campos do Cliente), sem criar
   tabela nova.
3. THE base de conteúdo SHALL continuar sendo a estrutura existente
   (`ai_knowledge_sections`), consultada via RAG, sem duplicação.
4. WHEN o Escritor compõe uma mensagem, THE Cerebro SHALL fornecer as camadas de memória
   relevantes ao momento, sem despejar toda a memória de uma vez.

# Requirements Document

## Introduction

Esta funcionalidade adiciona uma **esteira de acompanhamento de proposta/venda** dentro do módulo Produtos/Vendas (`src/features/produtos/`). O objetivo é dar visibilidade e controle do andamento de cada venda após o aceite do orçamento, por meio de uma sequência de etapas configuráveis (ex.: Foto e documentação → Visita técnica → Dimensionamento → Contrato enviado).

A esteira é definida por um **template global único** (uma única configuração de etapas para todas as vendas), gerenciado por administradores. Quando um orçamento é aceito (ou a venda passa para o status `fechado`), o sistema **instancia automaticamente** a esteira para aquela venda, criando o progresso por-venda. O consultor responsável executa as etapas da própria venda: marca como concluída/pendente, anexa fotos e documentos, e registra observações.

Os anexos ficam em um **bucket dedicado e novo** no Supabase Storage (ex.: `sales-attachments`), com regras de acesso (RLS) que isolam os arquivos por consultor/venda. Toda a funcionalidade fica atrelada a `sales` e `proposals`, sem qualquer mistura com o CRM (não usar `kanban_stages` nem `crm_deals`).

Contexto técnico já existente (não faz parte do escopo recriar, apenas referenciar):
- Tabela `sales` com enum `sale_status` (`interesse` | `negociando` | `fechado` | `perdido`), coluna `closed_at` e `capture_data` (jsonb).
- Tabela `proposals` com `status` e `sale_id`.
- Tabela `sale_status_history`.
- RPC `update_sale_status_with_note` + trigger que carimba `closed_at`.
- Supabase project-ref: `zlzasfhcxcznaprrragl`.

## Glossary

- **Sistema**: O conjunto de funcionalidades de acompanhamento de proposta/venda descrito neste documento, dentro do módulo Produtos/Vendas.
- **Template Global**: Configuração única e compartilhada que define a lista ordenada de etapas que toda venda deve seguir.
- **Etapa do Template**: Item ordenado do Template Global (ex.: "Foto e documentação"), com nome e posição na sequência.
- **Esteira da Venda**: Instância do Template Global aplicada a uma venda específica, contendo o progresso de cada etapa para aquela venda.
- **Passo da Venda**: Item individual da Esteira da Venda, correspondente a uma Etapa do Template, com estado (pendente/concluído), anexos e observação próprios.
- **Venda**: Registro da tabela `sales`.
- **Orçamento**: Registro da tabela `proposals`.
- **Consultor**: Usuário responsável por uma venda (`sales.consultant_id`), que executa os passos da própria Esteira da Venda.
- **Administrador**: Usuário com papel `admin` ou `superadmin`, autorizado a gerenciar o Template Global.
- **Bucket de Anexos**: Bucket dedicado e novo no Supabase Storage (ex.: `sales-attachments`) onde ficam fotos e documentos dos passos.
- **Anexo**: Arquivo (foto ou documento) vinculado a um Passo da Venda, armazenado no Bucket de Anexos.
- **CRM**: Módulo separado baseado em `kanban_stages` e `crm_deals`, que NÃO deve ser afetado nem reutilizado por esta funcionalidade.

## Requirements

### Requisito 1 — Gerenciamento do Template Global (Administrador)

**História do Usuário:** Como administrador, quero criar, editar, remover e reordenar as etapas de uma esteira única e global, para padronizar o acompanhamento de todas as vendas.

#### Critérios de Aceitação

1. QUANDO um Administrador abre a tela de configuração da esteira, O Sistema DEVE exibir o Template Global com suas Etapas na ordem definida.
2. QUANDO um Administrador adiciona uma Etapa informando um nome, O Sistema DEVE incluir a Etapa no Template Global na última posição da sequência.
3. QUANDO um Administrador edita o nome de uma Etapa existente, O Sistema DEVE persistir o novo nome no Template Global.
4. QUANDO um Administrador remove uma Etapa do Template Global, O Sistema DEVE retirá-la da sequência do template.
5. QUANDO um Administrador reordena as Etapas, O Sistema DEVE persistir a nova posição de cada Etapa no Template Global.
6. ONDE o Template Global ainda não foi configurado, O Sistema DEVE inicializar o template com as Etapas padrão na ordem: "Foto e documentação", "Visita técnica", "Dimensionamento", "Contrato enviado".
7. SE um usuário sem papel `admin` ou `superadmin` tentar criar, editar, remover ou reordenar uma Etapa do Template Global, ENTÃO O Sistema DEVE recusar a operação e manter o template inalterado.
8. QUANDO um Administrador adiciona, edita ou remove uma Etapa sem informar um nome válido (texto não vazio), O Sistema DEVE recusar a operação e exibir mensagem indicando o nome obrigatório.

### Requisito 2 — Instanciação Automática da Esteira por Venda

**História do Usuário:** Como consultor, quero que a esteira de acompanhamento apareça automaticamente na minha venda assim que o orçamento for aceito, para não precisar criar etapas manualmente.

#### Critérios de Aceitação

1. QUANDO um Orçamento é aceito e vinculado a uma Venda (define-se `sale_id`), O Sistema DEVE criar a Esteira da Venda copiando as Etapas atuais do Template Global como Passos da Venda, todos com estado inicial "pendente".
2. QUANDO uma Venda passa para o status `fechado`, O Sistema DEVE garantir que exista uma Esteira da Venda associada, criando-a a partir do Template Global caso ainda não exista.
3. ENQUANTO uma Venda já possuir uma Esteira da Venda, O Sistema DEVE reutilizar a esteira existente sem recriá-la nem apagar o progresso já registrado.
4. QUANDO o Sistema cria a Esteira da Venda, O Sistema DEVE preservar a ordem das Etapas do Template Global vigente no momento da criação.
5. O Sistema DEVE manter o progresso (estado, anexos e observações) de forma independente por Venda, sem compartilhar dados entre Esteiras de Vendas diferentes.

### Requisito 3 — Execução dos Passos pelo Consultor

**História do Usuário:** Como consultor, quero marcar as etapas da minha venda como concluídas ou pendentes e registrar observações, para acompanhar e comprovar o andamento da venda.

#### Critérios de Aceitação

1. QUANDO um Consultor abre a Esteira de uma Venda da qual é responsável, O Sistema DEVE exibir os Passos da Venda na ordem definida, com o estado atual (pendente/concluído) de cada Passo.
2. QUANDO um Consultor marca um Passo como concluído, O Sistema DEVE registrar o estado "concluído" para aquele Passo, junto da data/hora e do autor da alteração.
3. QUANDO um Consultor marca um Passo como pendente, O Sistema DEVE registrar o estado "pendente" para aquele Passo.
4. QUANDO um Consultor escreve uma observação em um Passo, O Sistema DEVE persistir o texto da observação vinculado àquele Passo.
5. O Sistema DEVE exibir o progresso geral da Esteira da Venda (ex.: quantidade de Passos concluídos sobre o total).
6. SE um Consultor tentar alterar Passos de uma Venda da qual não é responsável, ENTÃO O Sistema DEVE recusar a operação.
7. SE um Consultor tentar criar, remover ou reordenar Etapas do Template Global, ENTÃO O Sistema DEVE recusar a operação.

### Requisito 4 — Anexos de Fotos e Documentos

**História do Usuário:** Como consultor, quero anexar fotos e documentos a cada etapa da minha venda, para guardar a comprovação do que foi feito.

#### Critérios de Aceitação

1. QUANDO um Consultor anexa uma foto ou documento a um Passo da Venda, O Sistema DEVE armazenar o arquivo no Bucket de Anexos dedicado (ex.: `sales-attachments`) e vincular o registro do Anexo ao Passo correspondente.
2. O Sistema DEVE organizar os arquivos no Bucket de Anexos por venda (ex.: caminho contendo o identificador da Venda) para permitir o isolamento por venda.
3. QUANDO um Consultor visualiza um Passo da Venda, O Sistema DEVE listar os Anexos já enviados para aquele Passo.
4. QUANDO um Consultor remove um Anexo de um Passo da própria Venda, O Sistema DEVE excluir o vínculo do Anexo e o arquivo correspondente no Bucket de Anexos.
5. SE o arquivo enviado exceder o tamanho máximo permitido ou tiver tipo não suportado, ENTÃO O Sistema DEVE recusar o envio e exibir mensagem informando o motivo.
6. O Sistema DEVE usar exclusivamente o Bucket de Anexos novo e dedicado, sem reutilizar buckets de Storage já existentes.

### Requisito 5 — Segurança e Isolamento de Acesso (RLS)

**História do Usuário:** Como responsável pela segurança, quero que cada consultor só acesse os anexos e o progresso das próprias vendas, para proteger dados de clientes e evitar acesso indevido.

#### Critérios de Aceitação

1. O Sistema DEVE aplicar políticas de RLS no Bucket de Anexos de modo que um Consultor só leia, envie ou remova arquivos das Vendas das quais é responsável.
2. O Sistema DEVE aplicar políticas de RLS nas tabelas da Esteira da Venda e dos Passos da Venda de modo que um Consultor só acesse os registros das próprias Vendas.
3. ONDE o usuário possuir papel `admin` ou `superadmin`, O Sistema DEVE permitir o acesso de leitura aos Passos e Anexos de qualquer Venda para fins de gestão.
4. SE uma requisição de leitura ou escrita não estiver autenticada, ENTÃO O Sistema DEVE recusar o acesso aos registros da Esteira da Venda e aos Anexos.
5. O Sistema DEVE registrar autoria (usuário) e data/hora nas alterações de estado dos Passos e no envio de Anexos.

### Requisito 6 — Reordenação/Edição do Template e Efeito nas Vendas

**História do Usuário:** Como administrador, quero entender e controlar como mudanças no template afetam vendas futuras e vendas já em andamento, para evitar perder progresso já registrado.

#### Critérios de Aceitação

1. QUANDO um Administrador altera o Template Global (adiciona, edita, remove ou reordena Etapas), O Sistema DEVE aplicar a nova configuração apenas às Esteiras de Vendas criadas a partir daquele momento.
2. ENQUANTO uma Venda já possuir uma Esteira da Venda instanciada, O Sistema DEVE manter os Passos e o progresso existentes inalterados ao alterar o Template Global.
3. QUANDO um Administrador remove uma Etapa do Template Global, O Sistema DEVE preservar os Passos correspondentes já existentes nas Esteiras de Vendas instanciadas.
4. QUANDO um Administrador renomeia uma Etapa do Template Global, O Sistema DEVE manter o nome anterior nos Passos das Esteiras de Vendas já instanciadas.

### Requisito 7 — Separação do CRM

**História do Usuário:** Como mantenedor do sistema, quero que o acompanhamento de proposta/venda fique isolado de Produtos/Vendas e não toque o CRM, para evitar acoplamento e efeitos colaterais.

#### Critérios de Aceitação

1. O Sistema DEVE armazenar a Esteira da Venda, os Passos da Venda e os Anexos atrelados a `sales` e `proposals`, sem usar as tabelas `kanban_stages` ou `crm_deals`.
2. O Sistema DEVE manter o código da funcionalidade dentro de `src/features/produtos/`, sem dependências do módulo de CRM.
3. QUANDO o estado de um Passo ou da Esteira da Venda é alterado, O Sistema DEVE manter inalterados os registros de `kanban_stages` e `crm_deals`.

## Fora de Escopo

- Notificações (e-mail, push, WhatsApp) sobre mudança de etapa ou conclusão da esteira.
- Esteiras ou templates específicos por produto, família ou consultor (o template é global e único).
- Relatórios analíticos, dashboards ou métricas agregadas de progresso entre múltiplas vendas.
- Aprovação/validação de etapas por terceiros (ex.: fluxo de revisão ou assinatura digital).
- Integração com o CRM (`kanban_stages`, `crm_deals`) ou sincronização de etapas com o pipeline do CRM.
- Alteração do enum `sale_status` ou do fluxo de status da venda já existente.
- Versionamento histórico do Template Global (apenas a configuração vigente é mantida).
- Migração retroativa automática de vendas antigas (`fechado`) já existentes para criar esteiras em lote.

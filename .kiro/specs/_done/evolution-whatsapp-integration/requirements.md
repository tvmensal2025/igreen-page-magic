> ⚠️ FONTE DE VERDADE WA = **Whapi** (não Evolution). Este spec pode estar defasado — siga `.kiro/steering/regras-duras.md` + `wa-webhook.md`. Ver `.kiro/specs/STATUS.md`.

# Documento de Requisitos — Integração WhatsApp via Evolution API

## Introdução

Este documento descreve os requisitos para integrar a Evolution API ao Painel do Consultor da iGreen Energy. A funcionalidade permite que cada consultor conecte seu WhatsApp pessoal via QR Code e envie mensagens automáticas e individuais para seus clientes, diretamente pelo painel administrativo. A integração adiciona uma nova aba "WhatsApp" ao painel existente (que já possui Dashboard, Dados, Links e Preview).

## Glossário

- **Painel_do_Consultor**: Interface administrativa onde consultores gerenciam suas landing pages, analytics e links. Localizado em `/admin`.
- **Evolution_API**: Serviço externo de API para WhatsApp que permite conexão via QR Code e envio/recebimento de mensagens programáticas.
- **Instância_WhatsApp**: Sessão individual criada na Evolution API para cada consultor, representando a conexão do WhatsApp do consultor.
- **QR_Code_de_Conexão**: Código QR gerado pela Evolution API que o consultor escaneia com o WhatsApp do celular para autenticar a sessão.
- **Consultor**: Usuário autenticado do sistema que gerencia sua landing page e se comunica com clientes.
- **Cliente**: Pessoa cadastrada na tabela `customers` do Supabase, identificada pelo número de WhatsApp (`phone_whatsapp`).
- **Mensagem_Automática**: Mensagem pré-configurada enviada automaticamente para um grupo de clientes selecionados.
- **Mensagem_Individual**: Mensagem de texto livre enviada manualmente pelo consultor para um cliente específico.
- **Template_de_Mensagem**: Modelo de mensagem reutilizável com placeholders (ex: `{{nome}}`, `{{valor_conta}}`) que o consultor pode salvar e usar para envios.
- **Status_de_Conexão**: Estado atual da Instância_WhatsApp (desconectado, conectando, conectado).

## Requisitos

### Requisito 1: Conexão WhatsApp via QR Code

**User Story:** Como consultor, eu quero conectar meu WhatsApp ao painel via QR Code, para que eu possa enviar mensagens aos meus clientes diretamente pelo sistema.

#### Critérios de Aceitação

1. WHEN o Consultor acessa a aba "WhatsApp" pela primeira vez, THE Painel_do_Consultor SHALL criar uma Instância_WhatsApp na Evolution_API associada ao ID do Consultor
2. WHEN a Instância_WhatsApp é criada com sucesso, THE Painel_do_Consultor SHALL exibir o QR_Code_de_Conexão gerado pela Evolution_API
3. WHILE o QR_Code_de_Conexão está expirado, THE Painel_do_Consultor SHALL exibir um botão para gerar um novo QR_Code_de_Conexão
4. WHEN o Consultor escaneia o QR_Code_de_Conexão com o celular, THE Painel_do_Consultor SHALL atualizar o Status_de_Conexão para "conectado" em até 5 segundos
5. WHILE o Status_de_Conexão é "conectado", THE Painel_do_Consultor SHALL exibir o número de telefone conectado e um indicador visual verde de status
6. IF a criação da Instância_WhatsApp falhar, THEN THE Painel_do_Consultor SHALL exibir uma mensagem de erro descritiva e um botão para tentar novamente
7. WHEN o Consultor clica em "Desconectar", THE Painel_do_Consultor SHALL encerrar a Instância_WhatsApp na Evolution_API e atualizar o Status_de_Conexão para "desconectado"

### Requisito 2: Nova Aba WhatsApp no Painel

**User Story:** Como consultor, eu quero acessar as funcionalidades de WhatsApp em uma aba dedicada no painel, para que eu tenha uma interface organizada para gerenciar minhas mensagens.

#### Critérios de Aceitação

1. THE Painel_do_Consultor SHALL exibir uma aba "WhatsApp" na barra de navegação, ao lado das abas existentes (Dashboard, Dados, Links, Preview)
2. WHEN o Consultor clica na aba "WhatsApp", THE Painel_do_Consultor SHALL exibir a seção de conexão e a seção de mensagens
3. WHILE o Status_de_Conexão é "desconectado", THE Painel_do_Consultor SHALL exibir apenas a seção de conexão com o QR_Code_de_Conexão
4. WHILE o Status_de_Conexão é "conectado", THE Painel_do_Consultor SHALL exibir a seção de conexão (resumida) e a seção de envio de mensagens

### Requisito 3: Envio de Mensagem Individual

**User Story:** Como consultor, eu quero enviar uma mensagem individual para um cliente específico, para que eu possa me comunicar de forma personalizada.

#### Critérios de Aceitação

1. WHILE o Status_de_Conexão é "conectado", THE Painel_do_Consultor SHALL exibir a lista de Clientes com nome e número de WhatsApp
2. WHEN o Consultor seleciona um Cliente da lista, THE Painel_do_Consultor SHALL exibir um campo de texto para compor a Mensagem_Individual
3. WHEN o Consultor clica em "Enviar" com uma mensagem não vazia, THE Painel_do_Consultor SHALL enviar a Mensagem_Individual via Evolution_API para o número de WhatsApp do Cliente selecionado
4. WHEN a Evolution_API confirma o envio da mensagem, THE Painel_do_Consultor SHALL exibir uma notificação de sucesso com o nome do Cliente
5. IF o envio da Mensagem_Individual falhar, THEN THE Painel_do_Consultor SHALL exibir uma notificação de erro com a descrição da falha
6. WHEN o Consultor digita no campo de busca da lista de Clientes, THE Painel_do_Consultor SHALL filtrar os Clientes por nome ou número de WhatsApp em tempo real

### Requisito 4: Envio de Mensagens Automáticas (em Massa)

**User Story:** Como consultor, eu quero enviar mensagens automáticas para vários clientes ao mesmo tempo, para que eu possa comunicar promoções ou informações de forma eficiente.

#### Critérios de Aceitação

1. WHILE o Status_de_Conexão é "conectado", THE Painel_do_Consultor SHALL exibir a opção de "Envio em Massa"
2. WHEN o Consultor acessa "Envio em Massa", THE Painel_do_Consultor SHALL exibir a lista de Clientes com checkboxes para seleção múltipla
3. THE Painel_do_Consultor SHALL fornecer um checkbox "Selecionar Todos" para selecionar todos os Clientes da lista
4. WHEN o Consultor seleciona Clientes e compõe uma mensagem, THE Painel_do_Consultor SHALL exibir a contagem de destinatários selecionados
5. WHEN o Consultor confirma o envio em massa, THE Painel_do_Consultor SHALL enviar a Mensagem_Automática sequencialmente para cada Cliente selecionado via Evolution_API com intervalo mínimo de 2 segundos entre cada envio
6. WHILE o envio em massa está em andamento, THE Painel_do_Consultor SHALL exibir uma barra de progresso indicando quantas mensagens foram enviadas do total
7. WHEN o envio em massa é concluído, THE Painel_do_Consultor SHALL exibir um resumo com a quantidade de mensagens enviadas com sucesso e a quantidade de falhas
8. IF o Consultor tenta enviar em massa sem selecionar nenhum Cliente, THEN THE Painel_do_Consultor SHALL exibir um aviso solicitando a seleção de pelo menos um destinatário

### Requisito 5: Templates de Mensagem

**User Story:** Como consultor, eu quero salvar modelos de mensagens reutilizáveis, para que eu possa agilizar o envio de mensagens frequentes.

#### Critérios de Aceitação

1. THE Painel_do_Consultor SHALL permitir que o Consultor crie Templates_de_Mensagem com nome e conteúdo
2. THE Painel_do_Consultor SHALL suportar placeholders nos Templates_de_Mensagem: `{{nome}}` para o nome do Cliente e `{{valor_conta}}` para o valor da conta de energia
3. WHEN o Consultor seleciona um Template_de_Mensagem para envio, THE Painel_do_Consultor SHALL substituir os placeholders pelos dados reais de cada Cliente
4. WHEN o Consultor clica em "Salvar Template", THE Painel_do_Consultor SHALL persistir o Template_de_Mensagem no banco de dados associado ao ID do Consultor
5. WHEN o Consultor clica em "Excluir" em um Template_de_Mensagem, THE Painel_do_Consultor SHALL remover o Template_de_Mensagem após confirmação do Consultor
6. THE Painel_do_Consultor SHALL exibir a lista de Templates_de_Mensagem salvos pelo Consultor na seção de composição de mensagens

### Requisito 6: Monitoramento do Status da Conexão

**User Story:** Como consultor, eu quero ver o status da minha conexão WhatsApp em tempo real, para que eu saiba se posso enviar mensagens.

#### Critérios de Aceitação

1. THE Painel_do_Consultor SHALL verificar o Status_de_Conexão da Instância_WhatsApp a cada 30 segundos via polling na Evolution_API
2. WHEN o Status_de_Conexão muda de "conectado" para "desconectado", THE Painel_do_Consultor SHALL exibir uma notificação informando que a conexão foi perdida
3. WHILE o Status_de_Conexão é "desconectado" e uma Instância_WhatsApp já existe, THE Painel_do_Consultor SHALL exibir um botão "Reconectar" que gera um novo QR_Code_de_Conexão
4. WHILE o Status_de_Conexão é "conectando", THE Painel_do_Consultor SHALL exibir um indicador de carregamento com a mensagem "Aguardando leitura do QR Code..."

### Requisito 7: Persistência da Configuração da Instância

**User Story:** Como consultor, eu quero que minha conexão WhatsApp persista entre sessões, para que eu não precise reconectar toda vez que acessar o painel.

#### Critérios de Aceitação

1. WHEN a Instância_WhatsApp é criada com sucesso, THE Painel_do_Consultor SHALL salvar o identificador da Instância_WhatsApp no banco de dados associado ao Consultor
2. WHEN o Consultor acessa a aba "WhatsApp" e já possui uma Instância_WhatsApp salva, THE Painel_do_Consultor SHALL consultar o Status_de_Conexão da instância existente na Evolution_API em vez de criar uma nova
3. IF a Instância_WhatsApp salva não existir mais na Evolution_API, THEN THE Painel_do_Consultor SHALL remover o registro local e exibir a tela de nova conexão

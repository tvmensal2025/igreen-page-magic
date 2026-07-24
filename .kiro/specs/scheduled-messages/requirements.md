# Documento de Requisitos — Mensagens Agendadas

> ⚠️ FONTE DE VERDADE WA = **Whapi** (não Evolution). Este spec pode estar defasado — siga `.kiro/steering/regras-duras.md` + `wa-webhook.md`. Ver `.kiro/specs/STATUS.md`.

## Introdução

Sistema de agendamento de mensagens personalizadas via WhatsApp para consultores iGreen. Permite que consultores programem envios de mensagens para clientes individuais ou em massa, com suporte a recorrência (diária, semanal, mensal) e integração com o sistema de templates existente. O envio efetivo é executado por uma Supabase Edge Function que verifica mensagens pendentes e as envia pela Evolution API.

## Glossário

- **Agendador**: Componente de interface que permite ao consultor criar, visualizar e gerenciar mensagens agendadas.
- **Mensagem_Agendada**: Registro no banco de dados que representa uma mensagem programada para envio futuro, contendo destinatários, conteúdo, data/hora e configuração de recorrência.
- **Recorrencia**: Configuração que define a frequência de reenvio de uma mensagem agendada (única, diária, semanal ou mensal).
- **Destinatario**: Um cliente selecionado para receber uma mensagem agendada, identificado por nome e número de WhatsApp.
- **Processador_de_Fila**: Supabase Edge Function que executa periodicamente, verifica mensagens pendentes e realiza o envio via Evolution API.
- **Template**: Modelo de mensagem reutilizável com placeholders (ex: `{{nome}}`, `{{valor_conta}}`) que são substituídos por dados do cliente no momento do envio.
- **Evolution_API**: Serviço externo utilizado para enviar mensagens de texto via WhatsApp.
- **Consultor**: Usuário autenticado do sistema que agenda e gerencia mensagens.

## Requisitos

### Requisito 1: Criar Mensagem Agendada

**User Story:** Como consultor, quero agendar uma mensagem para uma data e hora futuras, para que meus clientes recebam comunicações no momento ideal.

#### Critérios de Aceitação

1. WHEN o Consultor submete o formulário de agendamento com data, hora, conteúdo e pelo menos um Destinatario, THE Agendador SHALL criar uma Mensagem_Agendada com status "pendente" no banco de dados.
2. WHEN o Consultor seleciona uma data/hora no passado, THE Agendador SHALL exibir uma mensagem de validação informando que a data deve ser futura.
3. WHEN o Consultor não preenche o conteúdo da mensagem, THE Agendador SHALL desabilitar o botão de agendamento.
4. WHEN a Mensagem_Agendada é criada com sucesso, THE Agendador SHALL exibir uma notificação de confirmação com a data e hora programadas.

### Requisito 2: Selecionar Destinatários

**User Story:** Como consultor, quero selecionar um ou vários clientes como destinatários, para que eu possa enviar mensagens individuais ou em massa.

#### Critérios de Aceitação

1. THE Agendador SHALL exibir a lista de clientes do Consultor com nome e número de WhatsApp.
2. WHEN o Consultor digita no campo de busca, THE Agendador SHALL filtrar a lista de clientes por nome ou número de telefone.
3. WHEN o Consultor marca a opção "Selecionar Todos", THE Agendador SHALL selecionar todos os clientes visíveis na lista filtrada.
4. WHEN o Consultor desmarca a opção "Selecionar Todos", THE Agendador SHALL desmarcar todos os clientes.
5. THE Agendador SHALL exibir a contagem de Destinatarios selecionados.

### Requisito 3: Configurar Recorrência

**User Story:** Como consultor, quero definir a frequência de envio (única, diária, semanal, mensal), para que mensagens recorrentes sejam enviadas automaticamente.

#### Critérios de Aceitação

1. THE Agendador SHALL oferecer as opções de Recorrencia: única, diária, semanal e mensal.
2. WHEN o Consultor seleciona Recorrencia "única", THE Agendador SHALL agendar o envio apenas para a data e hora especificadas.
3. WHEN o Consultor seleciona Recorrencia "diária", THE Agendador SHALL agendar o envio para a mesma hora todos os dias a partir da data inicial.
4. WHEN o Consultor seleciona Recorrencia "semanal", THE Agendador SHALL agendar o envio para o mesmo dia da semana e hora a partir da data inicial.
5. WHEN o Consultor seleciona Recorrencia "mensal", THE Agendador SHALL agendar o envio para o mesmo dia do mês e hora a partir da data inicial.
6. WHERE a Recorrencia é diferente de "única", THE Agendador SHALL exibir um campo opcional de data de término.

### Requisito 4: Integração com Templates

**User Story:** Como consultor, quero usar meus templates existentes ao agendar mensagens, para que eu possa reutilizar modelos com placeholders personalizados.

#### Critérios de Aceitação

1. THE Agendador SHALL exibir um seletor com os Templates do Consultor.
2. WHEN o Consultor seleciona um Template, THE Agendador SHALL preencher o campo de conteúdo com o texto do Template selecionado.
3. WHEN a Mensagem_Agendada contém placeholders (ex: `{{nome}}`, `{{valor_conta}}`), THE Processador_de_Fila SHALL substituir os placeholders pelos dados de cada Destinatario no momento do envio.
4. THE Agendador SHALL permitir que o Consultor edite o conteúdo após selecionar um Template.

### Requisito 5: Visualizar Calendário de Agendamentos

**User Story:** Como consultor, quero visualizar meus agendamentos em um calendário, para que eu tenha uma visão clara de todas as mensagens programadas.

#### Critérios de Aceitação

1. THE Agendador SHALL exibir um calendário mensal com indicadores visuais nos dias que possuem Mensagens_Agendadas.
2. WHEN o Consultor clica em um dia do calendário, THE Agendador SHALL exibir a lista de Mensagens_Agendadas para aquele dia.
3. WHEN o Consultor clica em uma Mensagem_Agendada na lista, THE Agendador SHALL exibir os detalhes completos: conteúdo, Destinatarios, Recorrencia e status.
4. THE Agendador SHALL diferenciar visualmente os dias com agendamentos pendentes, enviados e com falha usando cores distintas.

### Requisito 6: Gerenciar Mensagens Agendadas

**User Story:** Como consultor, quero editar, cancelar ou excluir mensagens agendadas, para que eu tenha controle total sobre minhas comunicações programadas.

#### Critérios de Aceitação

1. WHILE a Mensagem_Agendada possui status "pendente", THE Agendador SHALL permitir que o Consultor edite o conteúdo, Destinatarios, data/hora e Recorrencia.
2. WHILE a Mensagem_Agendada possui status "pendente", THE Agendador SHALL permitir que o Consultor cancele o agendamento, alterando o status para "cancelado".
3. WHEN o Consultor solicita exclusão de uma Mensagem_Agendada, THE Agendador SHALL exibir um diálogo de confirmação antes de excluir.
4. WHEN a Mensagem_Agendada possui Recorrencia diferente de "única" e o Consultor cancela, THE Agendador SHALL perguntar se deseja cancelar apenas a próxima ocorrência ou todas as ocorrências futuras.
5. IF a Mensagem_Agendada já foi enviada (status "enviado"), THEN THE Agendador SHALL exibir os detalhes como somente leitura.

### Requisito 7: Listar Mensagens Agendadas

**User Story:** Como consultor, quero ver uma lista de todas as minhas mensagens agendadas com filtros, para que eu possa acompanhar o status de cada envio.

#### Critérios de Aceitação

1. THE Agendador SHALL exibir uma lista de Mensagens_Agendadas ordenada por data/hora de envio (próximas primeiro).
2. THE Agendador SHALL exibir para cada item: conteúdo resumido, quantidade de Destinatarios, data/hora, Recorrencia e status.
3. WHEN o Consultor seleciona um filtro de status, THE Agendador SHALL exibir apenas as Mensagens_Agendadas com o status selecionado (pendente, enviado, falha, cancelado).
4. THE Agendador SHALL separar visualmente as mensagens futuras (pendentes) das mensagens passadas (enviadas/falhas).

### Requisito 8: Processamento e Envio Automático

**User Story:** Como consultor, quero que as mensagens agendadas sejam enviadas automaticamente no horário programado, para que eu não precise estar online no momento do envio.

#### Critérios de Aceitação

1. THE Processador_de_Fila SHALL verificar Mensagens_Agendadas com status "pendente" e data/hora de envio igual ou anterior ao momento atual.
2. WHEN uma Mensagem_Agendada está pronta para envio, THE Processador_de_Fila SHALL enviar a mensagem para cada Destinatario via Evolution_API usando a instância WhatsApp do Consultor.
3. WHEN o envio para um Destinatario é concluído com sucesso, THE Processador_de_Fila SHALL registrar o status "enviado" para aquele Destinatario.
4. IF o envio para um Destinatario falha, THEN THE Processador_de_Fila SHALL registrar o status "falha" para aquele Destinatario e continuar com os demais.
5. WHEN todos os Destinatarios de uma Mensagem_Agendada foram processados, THE Processador_de_Fila SHALL atualizar o status da Mensagem_Agendada para "enviado" (se todos com sucesso) ou "parcial" (se houve falhas).
6. WHEN uma Mensagem_Agendada com Recorrencia é processada, THE Processador_de_Fila SHALL criar automaticamente a próxima ocorrência com base na configuração de Recorrencia.
7. THE Processador_de_Fila SHALL respeitar um intervalo de 2 segundos entre envios para evitar bloqueio pela Evolution_API.

### Requisito 9: Persistência de Dados

**User Story:** Como consultor, quero que meus agendamentos sejam salvos de forma segura, para que eu não perca minhas programações.

#### Critérios de Aceitação

1. THE Sistema SHALL armazenar Mensagens_Agendadas na tabela `scheduled_messages` do Supabase com os campos: id, consultant_id, content, scheduled_at, recurrence_type, recurrence_end_at, status e created_at.
2. THE Sistema SHALL armazenar os Destinatarios de cada Mensagem_Agendada na tabela `scheduled_message_recipients` com os campos: id, scheduled_message_id, customer_id, customer_name, customer_phone, status e sent_at.
3. THE Sistema SHALL aplicar Row Level Security (RLS) para que cada Consultor acesse apenas suas próprias Mensagens_Agendadas.
4. THE Sistema SHALL utilizar chaves estrangeiras para manter integridade referencial entre scheduled_messages, scheduled_message_recipients e auth.users.

### Requisito 10: Feedback Visual de Status

**User Story:** Como consultor, quero ver claramente o status de cada mensagem agendada, para que eu saiba se foi enviada com sucesso ou se houve problemas.

#### Critérios de Aceitação

1. THE Agendador SHALL exibir badges de status com cores distintas: verde para "enviado", amarelo para "pendente", vermelho para "falha", cinza para "cancelado" e laranja para "parcial".
2. WHEN o Consultor visualiza os detalhes de uma Mensagem_Agendada enviada, THE Agendador SHALL exibir o status individual de cada Destinatario (enviado ou falha).
3. WHEN uma Mensagem_Agendada com Recorrencia está ativa, THE Agendador SHALL exibir a data da próxima ocorrência programada.

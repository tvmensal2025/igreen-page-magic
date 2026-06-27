# Requirements Document

## Introduction

Hoje, cada anúncio pago do Facebook do tipo CTWA (Click-to-WhatsApp) aponta para um único número fixo de WhatsApp (campo `consultant_ad_settings.whatsapp_destination_number`), e todo lead gerado pelo anúncio vira "dono" do consultor da instância central.

Esta feature adiciona, no momento de criar a campanha/anúncio, um **toggle de rodízio**. Quando ligado, os leads daquele anúncio passam a ser distribuídos em ordem circular (round-robin: 1, 2, 3, 4, 1, 2...) entre vários **participantes** escolhidos pelo dono. Para cada lead novo do anúncio: (a) o participante da vez recebe um aviso no WhatsApp dele, e (b) o cadastro do cliente no sistema iGreen roda sob o código (`idconsultor`/`indcli`) do participante da vez — e não sob o consultor dono da instância.

A feature reusa estruturas já existentes no código:
- Tabela `referral_partners` (participantes) e coluna `customers.referral_partner_id`.
- Pipeline de cadastro iGreen que já resolve o `idconsultor`/`indcli` a partir do `referral_partner_id` (regra implementada em `_shared/portal-worker.ts`).
- Detecção de lead vindo de anúncio CTWA no `evolution-webhook` (leitura de `externalAdReply`/`ctwaClid` e match em `facebook_campaigns`).
- Função de aviso `notifyPartnerNewLead` em `_shared/notify-consultant.ts`.
- Tabela `rodizio_pools` e função SQL `rodizio_next(p_slug)` (atribuição atômica do próximo da fila), criadas nesta sessão e que serão adaptadas para guardar participantes e ser ligadas a uma campanha.

### Fora de Escopo (explícito)

- A conversa do WhatsApp continua acontecendo no número central. Pela limitação do CTWA/Meta, a conversa NÃO é transferida para o WhatsApp pessoal de cada participante.
- O lead permanece tecnicamente vinculado ao `consultant_id` da instância central no CRM; o participante entra como `referral_partner` (campo `customers.referral_partner_id`), não substitui o `consultant_id`.

## Glossary

- **CTWA (Click-to-WhatsApp)**: tipo de anúncio do Facebook/Meta em que o usuário, ao clicar, abre uma conversa de WhatsApp com um número de destino. O anúncio continua nativo e aponta para um número central.
- **Rodízio (round-robin)**: estratégia de distribuição em ordem circular, em que cada novo lead vai para o próximo participante da fila e, ao chegar no último, volta ao primeiro.
- **Participante**: pessoa que recebe leads do rodízio. Representado por um registro em `referral_partners`. Pode ser do tipo CONSULTOR ou do tipo PARCEIRO/INDICADOR.
- **Pool de rodízio**: conjunto ordenado de participantes ligado a uma campanha, com um contador de posição atual. Representado em `rodizio_pools`.
- **idconsultor**: código iGreen sob o qual o cadastro do cliente é registrado (o "dono" do cadastro no iGreen).
- **indcli**: código do indicador que entra "na frente" do cadastro no iGreen. Valor 0 significa sem indicador.
- **cli**: código de indicador de um participante (alimenta o `indcli` do cadastro).
- **partner_igreen_id**: código iGreen próprio de um participante do tipo CONSULTOR. Quando maior que 0, o cadastro roda sob esse código; quando vazio/0, o cadastro roda sob o dono.
- **Consultor dono / instância central**: o consultor titular da plataforma e do número central de WhatsApp. É o `consultant_id` da instância e o comportamento de fallback.
- **Toggle de rodízio**: opção no wizard de criação de campanha que liga/desliga a distribuição em rodízio para aquele anúncio.

## Requirements

### Requisito 1: Toggle de rodízio no wizard de campanha

**História do Usuário:** Como dono da plataforma criando uma campanha de anúncio, quero ligar um toggle "Distribuir leads entre vários participantes (rodízio)", para que os leads daquele anúncio sejam repartidos entre várias pessoas em vez de irem todos para o número fixo.

#### Critérios de Aceitação

1. THE Wizard_De_Campanha SHALL exibir um toggle rotulado "Distribuir leads entre vários participantes (rodízio)" com valor inicial desligado.
2. WHEN o usuário liga o toggle de rodízio, THE Wizard_De_Campanha SHALL exibir um bloco de configuração de participantes abaixo do toggle.
3. WHEN o usuário desliga o toggle de rodízio, THE Wizard_De_Campanha SHALL ocultar o bloco de configuração de participantes e descartar a seleção de participantes daquela campanha.
4. WHILE o toggle de rodízio está desligado, THE Wizard_De_Campanha SHALL manter o comportamento atual de destino único (`whatsapp_destination_number`) sem alterações.

### Requisito 2: Selecionar participantes existentes

**História do Usuário:** Como dono da plataforma, quero selecionar participantes que já existem (meus `referral_partners`), para reaproveitar pessoas já cadastradas no rodízio.

#### Critérios de Aceitação

1. WHILE o bloco de configuração de participantes está visível, THE Wizard_De_Campanha SHALL listar os registros de `referral_partners` que pertencem ao consultor dono e estão ativos.
2. WHEN o usuário seleciona um participante existente da lista, THE Wizard_De_Campanha SHALL adicioná-lo à lista ordenada de participantes da campanha.
3. WHEN o usuário remove um participante da lista ordenada, THE Wizard_De_Campanha SHALL retirá-lo da lista ordenada da campanha.
4. IF o usuário tenta adicionar um participante que já está na lista ordenada, THEN THE Wizard_De_Campanha SHALL impedir a duplicação e exibir aviso de que o participante já foi adicionado.

### Requisito 3: Criar participante inline do tipo CONSULTOR

**História do Usuário:** Como dono da plataforma, quero criar um novo participante do tipo CONSULTOR direto no wizard, informando o código iGreen dele, para que os cadastros desse participante rodem sob o código dele.

#### Critérios de Aceitação

1. WHEN o usuário escolhe criar um participante inline do tipo CONSULTOR, THE Wizard_De_Campanha SHALL exibir os campos nome, telefone de aviso, `partner_igreen_id` e `cli` (opcional).
2. IF o usuário tenta salvar um participante do tipo CONSULTOR com `partner_igreen_id` vazio, THEN THE Wizard_De_Campanha SHALL bloquear o salvamento e exibir mensagem indicando que o código iGreen é obrigatório para o tipo CONSULTOR.
3. IF o usuário tenta salvar um participante do tipo CONSULTOR com nome vazio ou telefone de aviso vazio, THEN THE Wizard_De_Campanha SHALL bloquear o salvamento e indicar quais campos obrigatórios faltam.
4. WHEN o usuário salva um participante válido do tipo CONSULTOR, THE Sistema_De_Rodizio SHALL criar um registro em `referral_partners` com `partner_igreen_id` preenchido, `cli` igual ao valor informado (ou 0 quando não informado) e vínculo ao consultor dono.
5. WHEN o participante do tipo CONSULTOR é criado, THE Wizard_De_Campanha SHALL adicioná-lo automaticamente à lista ordenada de participantes da campanha.

### Requisito 4: Criar participante inline do tipo PARCEIRO/INDICADOR

**História do Usuário:** Como dono da plataforma, quero criar um novo participante do tipo PARCEIRO/INDICADOR informando o `cli` dele, para que o cadastro fique na minha conta com o indicador dele na frente.

#### Critérios de Aceitação

1. WHEN o usuário escolhe criar um participante inline do tipo PARCEIRO/INDICADOR, THE Wizard_De_Campanha SHALL exibir os campos nome, telefone de aviso e `cli`.
2. IF o usuário tenta salvar um participante do tipo PARCEIRO/INDICADOR com `cli` vazio, THEN THE Wizard_De_Campanha SHALL bloquear o salvamento e exibir mensagem indicando que o `cli` é obrigatório para o tipo PARCEIRO/INDICADOR.
3. IF o usuário tenta salvar um participante do tipo PARCEIRO/INDICADOR com nome vazio ou telefone de aviso vazio, THEN THE Wizard_De_Campanha SHALL bloquear o salvamento e indicar quais campos obrigatórios faltam.
4. WHEN o usuário salva um participante válido do tipo PARCEIRO/INDICADOR, THE Sistema_De_Rodizio SHALL criar um registro em `referral_partners` com `partner_igreen_id` vazio, `cli` igual ao valor informado e vínculo ao consultor dono.
5. WHEN o participante do tipo PARCEIRO/INDICADOR é criado, THE Wizard_De_Campanha SHALL adicioná-lo automaticamente à lista ordenada de participantes da campanha.

### Requisito 5: Quantidade mínima de participantes

**História do Usuário:** Como dono da plataforma, quero ser obrigado a ter pelo menos 2 participantes quando o rodízio está ligado, para que a distribuição circular faça sentido.

#### Critérios de Aceitação

1. THE Wizard_De_Campanha SHALL permitir adicionar qualquer quantidade de participantes igual ou maior que 2 à lista ordenada.
2. IF o toggle de rodízio está ligado e a lista ordenada tem menos de 2 participantes, THEN THE Wizard_De_Campanha SHALL bloquear a publicação da campanha e exibir mensagem informando que o rodízio exige pelo menos 2 participantes.

### Requisito 6: Criar a pool de rodízio ao publicar

**História do Usuário:** Como dono da plataforma, quero que ao publicar a campanha com o rodízio ligado o sistema crie/associe uma pool de rodízio ligada à campanha, para que os leads daquele anúncio sejam distribuídos conforme configurei.

#### Critérios de Aceitação

1. WHEN o usuário publica uma campanha com o toggle de rodízio ligado e lista ordenada válida, THE Sistema_De_Rodizio SHALL criar ou associar uma pool de rodízio ligada ao registro de `facebook_campaigns` daquela campanha.
2. WHEN a pool de rodízio é criada, THE Sistema_De_Rodizio SHALL armazenar a lista ordenada de participantes, o contador de posição inicial e o estado ativo da pool.
3. WHEN o usuário publica uma campanha com o toggle de rodízio desligado, THE Sistema_De_Rodizio SHALL publicar a campanha sem criar pool de rodízio.
4. THE Anuncio SHALL permanecer CTWA nativo apontando para o número central, independentemente do estado do toggle de rodízio, sem alterar a otimização do Meta.

### Requisito 7: Atribuir lead novo ao participante da vez

**História do Usuário:** Como dono da plataforma, quero que cada lead novo do anúncio com rodízio ligado seja atribuído ao próximo participante da fila, para que a distribuição aconteça automaticamente.

#### Critérios de Aceitação

1. WHEN um lead novo chega pelo anúncio e a campanha correspondente tem pool de rodízio ativa, THE Sistema_De_Rodizio SHALL chamar `rodizio_next` para obter o participante da vez.
2. WHEN o participante da vez é obtido, THE Sistema_De_Rodizio SHALL definir `customers.referral_partner_id` igual ao participante da vez.
3. WHEN `customers.referral_partner_id` é definido, THE Pipeline_De_Cadastro SHALL enviar o aviso ao participante da vez via `notifyPartnerNewLead` para o telefone de aviso configurado.
4. THE Lead SHALL permanecer com `customers.consultant_id` igual ao consultor da instância central, mesmo quando atribuído a um participante.

### Requisito 8: Prioridade do rodízio sobre keyword

**História do Usuário:** Como dono da plataforma, quero que o rodízio tenha prioridade sobre o match por palavra-chave para os leads do anúncio, porque é tráfego pago controlado.

#### Critérios de Aceitação

1. WHEN um lead novo chega pelo anúncio com pool de rodízio ativa, THE Sistema_De_Rodizio SHALL aplicar a atribuição por rodízio antes de qualquer atribuição por match de palavra-chave.
2. WHILE a atribuição por rodízio foi aplicada a um lead, THE Sistema_De_Rodizio SHALL ignorar o match por palavra-chave para aquele lead.

### Requisito 9: Atribuição atômica e ordem circular justa

**História do Usuário:** Como dono da plataforma, quero que dois leads simultâneos nunca peguem o mesmo participante e que a fila gire de forma justa, para que a distribuição seja correta e previsível.

#### Critérios de Aceitação

1. WHEN dois ou mais leads chegam de forma simultânea para a mesma pool, THE Sistema_De_Rodizio SHALL atribuir cada lead a um participante distinto da ordem circular, sem repetir o mesmo participante na mesma volta.
2. THE Sistema_De_Rodizio SHALL avançar o contador da pool em ordem circular, retornando ao primeiro participante após o último.
3. WHEN N leads consecutivos chegam para uma pool com P participantes, THE Sistema_De_Rodizio SHALL distribuir os leads de modo que a diferença entre o participante que mais recebeu e o que menos recebeu seja no máximo 1.

### Requisito 10: Métricas de distribuição

**História do Usuário:** Como dono da plataforma, quero ver quantos leads foram para cada participante, para acompanhar se a distribuição está justa.

#### Critérios de Aceitação

1. WHEN um lead é atribuído a um participante via rodízio, THE Sistema_De_Rodizio SHALL registrar a contagem de leads recebidos por aquele participante naquela pool.
2. THE Sistema_De_Rodizio SHALL disponibilizar a contagem de leads por participante de cada pool para consulta.

### Requisito 11: Fallback seguro para o consultor dono

**História do Usuário:** Como dono da plataforma, quero que nenhum lead se perca quando o rodízio falhar, para que o anúncio nunca fique sem destino.

#### Critérios de Aceitação

1. IF a pool de rodízio da campanha está vazia, THEN THE Sistema_De_Rodizio SHALL manter o comportamento atual, atribuindo o lead ao consultor dono da instância central.
2. IF a pool de rodízio da campanha está inativa, THEN THE Sistema_De_Rodizio SHALL manter o comportamento atual, atribuindo o lead ao consultor dono da instância central.
3. IF o participante da vez retornado por `rodizio_next` é inválido, THEN THE Sistema_De_Rodizio SHALL manter o comportamento atual, atribuindo o lead ao consultor dono da instância central.
4. WHEN o fallback é acionado, THE Sistema_De_Rodizio SHALL registrar o lead normalmente, sem perder o lead nem o vínculo com a campanha.

### Requisito 12: Regra de idconsultor e indcli reusando o pipeline existente

**História do Usuário:** Como dono da plataforma, quero que o cadastro iGreen do lead use o código correto conforme o tipo do participante, reusando a lógica já existente, para não duplicar regra de negócio.

#### Critérios de Aceitação

1. WHERE o participante da vez tem `partner_igreen_id` maior que 0, THE Pipeline_De_Cadastro SHALL registrar o cadastro com `idconsultor` igual a `partner_igreen_id` do participante.
2. WHERE o participante da vez tem `partner_igreen_id` vazio ou 0, THE Pipeline_De_Cadastro SHALL registrar o cadastro com `idconsultor` igual ao código iGreen do consultor dono.
3. THE Pipeline_De_Cadastro SHALL registrar o cadastro com `indcli` igual ao `cli` do participante da vez, ou 0 quando o participante não tem `cli`.
4. THE Sistema_De_Rodizio SHALL aplicar a regra de `idconsultor`/`indcli` reusando a lógica já existente em `_shared/portal-worker.ts`, sem duplicar a regra em outro lugar.

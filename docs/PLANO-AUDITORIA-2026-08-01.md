# Auditoria e Correção de Erro em Aplicação

## Objetivo
Realizar uma auditoria completa de uma aplicação para identificar e corrigir um erro específico, utilizando múltiplos agentes especializados.

## Instruções

### 1. Coleta de Informações
Antes de criar quaisquer agentes, o agente principal deve interagir com o usuário para coletar informações detalhadas sobre:
- A natureza exata do erro específico a ser corrigido.
- Detalhes sobre a aplicação em questão (linguagem, framework, arquitetura, ambiente de execução, etc.).
- Quaisquer sintomas ou comportamentos observados relacionados ao erro.
- O impacto esperado da correção.

### 2. Criação de Sub-Agentes
Com base nas informações coletadas, o agente principal deverá criar múltiplos sub-agentes, cada um com responsabilidades específicas:
- **Agente de Análise de Código:** Responsável por revisar o código-fonte em busca de padrões de erro, vulnerabilidades ou lógica incorreta.
- **Agente de Testes de Unidade/Integração:** Focado em criar e executar testes para reproduzir o erro e validar correções.
- **Agente de Análise de Desempenho:** Para investigar se o erro está relacionado a gargalos de desempenho ou uso ineficiente de recursos.
- **Agente de Análise de Banco de Dados:** Se aplicável, para verificar a integridade e o comportamento dos dados.
- **Agente de Verificação de Configuração:** Para garantir que as configurações da aplicação e do ambiente estejam corretas.
- **Agente de Documentação e Relatórios:** Para registrar o processo de auditoria, descobertas e a solução implementada.

### 3. Execução da Auditoria
Os sub-agentes deverão executar suas tarefas de forma coordenada, compartilhando informações relevantes entre si e com o agente principal.

### 4. Correção e Validação
Após a identificação da causa raiz do erro, o agente principal, em conjunto com os sub-agentes apropriados, deverá propor e implementar a correção. A validação deve ser realizada através de testes rigorosos.

### 5. Relatório Final
Ao final do processo, um relatório detalhado deve ser gerado, documentando o erro, a metodologia, as descobertas, a solução e os resultados da validação.

## Requisitos Técnicos
- Capacidade de gerenciar e orquestrar múltiplos agentes.
- Habilidade de interpretar e processar informações técnicas sobre aplicações.
- Mecanismos de comunicação e compartilhamento de dados entre agentes.
- Capacidade de gerar e executar testes automatizados.
- Geração de relatórios estruturados.

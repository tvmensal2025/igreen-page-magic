# Plano de Correção e Mapeamento Profundo — Estabilização do Sistema

O usuário relatou insatisfação com a qualidade das respostas da IA e falhas no bloqueio de contatos. Identificamos falhas críticas no motor de cadência e no roteamento de IA que permitem vazamento de mensagens para contatos bloqueados e respostas genéricas.

## 1. Correção Crítica de Bloqueio (cadence-tick)
- **Problema**: A coluna `bot_paused_reason` não está sendo selecionada no motor de cadência. Isso faz com que a trava de "Bloqueio Definitivo" (`requested`) falhe, permitindo que o timeout de 48h desbloqueie o lead indevidamente.
- **Ação**: 
  - Adicionar `bot_paused_reason` ao `select` na `cadence-tick/index.ts`.
  - Garantir que `requested`, `opt_out` e `complaint` bloqueiem o envio para sempre, sem expiração.

## 2. Melhoria da "Inteligência" das Respostas (ai-agent-router)
- **Problema**: O modo `kbOnlyMode` (apenas base de conhecimento) está ativo por padrão, resultando em respostas enlatadas ("Vou pedir para alguém...") quando o lead foge do roteiro.
- **Ação**:
  - Sugerir/Configurar `ai_kb_only_mode = false` para permitir que o LLM (Gemini) use o contexto da iGreen para gerar respostas mais fluidas e humanas.
  - Refinar o `systemPrompt` para desencorajar frases robóticas e insistir no uso do nome do consultor correto.

## 3. Blindagem de Nomes Inválidos ("entendi", "ixi")
- **Problema**: Leads estão sendo chamados por interjeições capturadas como nome.
- **Ação**:
  - Expandir `BAD_NAME_TOKENS` em `_shared/customer-display-name.ts`.
  - Adicionar guarda no prompt da IA para que ela nunca use nomes que soem como interjeições, mesmo se estiverem no banco.
  - Verificar e corrigir o uso de `scrubEmptyNameGreeting` em todos os canais de saída.

## 4. Prevenção de Duplicidade e Loops
- **Problema**: Leads recebendo mensagens repetidas ou duplicadas.
- **Ação**:
  - Garantir que a RPC `cleanup_customer_duplicates` seja chamada antes de cada disparo na cadência.
  - Ajustar o limiar de similaridade do anti-loop para ser mais rigoroso.

## 5. Auditoria de Identidade ("silviaclaudiaalmeida")
- **Problema**: O nome/slug de consultores antigos está aparecendo em leads.
- **Ação**:
  - Bloquear explicitamente qualquer string que contenha slugs conhecidos de sistema nas funções de exibição de nome.

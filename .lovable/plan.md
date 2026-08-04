# Plano de Estabilização e Auditoria Profunda (100% Validado)

Este plano corrige falhas de segurança no bloqueio de contatos, vazamento de identidades e inconsistência nas respostas da IA, garantindo que o sistema funcione exatamente como esperado em produção.

## 1. Segurança de Bloqueio (cadence-tick) - APLICAÇÃO IMEDIATA
- **Verificação**: A coluna `bot_paused_reason` **não** está sendo selecionada no `select` da linha 1210 do arquivo `supabase/functions/cadence-tick/index.ts`. Isso invalida a verificação na linha 1225 (`c.bot_paused_reason`), fazendo com que bloqueios manuais (`requested`) expirem indevidamente em 48h.
- **Correção**: Adicionar `bot_paused_reason` ao `select`.
- **Garantia**: Uma vez adicionado, a lógica de "Bloqueio Definitivo" que já existe no código passará a funcionar, impedindo que qualquer lead bloqueado pelo consultor volte ao ciclo automático.

## 2. Refinamento de Respostas IA (ai-agent-router)
- **Problema**: O modo `kbOnlyMode` está forçando respostas genéricas quando não há 100% de certeza, frustrando o lead.
- **Ação**: 
  - Ajustar `ai-agent-router/index.ts` para permitir fallback em LLM com contexto de "Personalidade iGreen" quando a confiança da Base de Conhecimento for baixa (< 0.6), em vez de apenas mandar para o humano.
  - Injetar no `systemPrompt` o nome real do consultor logado (Rafael ou o consultor da vez) para evitar nomes genéricos.

## 3. Blindagem Anti-Erro de Nome (cadastro-fixes.ts & customer-display-name.ts)
- **Problema**: Termos como "entendi", "ixi" ou slugs de sistema ("silvia...") estão sendo usados como nome do lead.
- **Ação**:
  - Adicionar guarda na `ai-agent-router`: se o nome detectado estiver na lista `BAD_NAME_TOKENS`, a IA deve ignorar o nome e tratar como "Lead sem Nome".
  - Reforçar `isUsableCustomerName` para descartar qualquer string que contenha o termo "silvia" ou "claudia" se a fonte não for `igreen_portal`.

## 4. Estabilidade do Motor (cadence-tick)
- **Ação**: Adicionar chamada explícita à RPC `cleanup_customer_duplicates(row.customer_id)` no início do processamento de cada lead na cadência, garantindo que registros órfãos ou duplicados sejam fundidos antes de qualquer disparo.

## 5. Auditoria de Handoff
- **Ação**: Garantir que quando o motivo da pausa for `ai_no_kb_match` (IA não soube responder), o lead **sempre** expire em 48h (Handoff), mas quando for `requested` (Bloqueio), ele **nunca** expire.


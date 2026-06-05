## Diagnóstico

O lead `11971254913` foi recriado depois da limpeza, então ele aparece novamente no banco. O registro atual é novo:

- `customers.id = 05b72342-afc8-4b02-8e92-5fc8318a267f`
- `phone_whatsapp = 5511971254913`
- `conversation_step = welcome`
- `bot_paused = true`
- `bot_paused_reason = ai_no_kb_match`
- criado às `2026-06-05 02:44:14`

O fluxo não inicia porque, no `evolution-webhook`, antes de rodar `runConversationalFlow`/`runBotFlow`, existe um gate que manda mensagens em `welcome` para `ai-agent-router` quando `ai_agent_config.enabled=true`.

No `ai-agent-router`, o modo `ai_kb_only_mode` está ligado por padrão. Para uma mensagem simples como `Oi`, ele tenta achar resposta na base de conhecimento; se não acha, ele pausa o bot com `ai_no_kb_match`. Resultado: o lead fica em `welcome`, mas pausado, e o fluxo nunca roda.

Também encontrei que o consultor da instância `igreen-953f7e48509b` (`953f7e48-509b-4069-9822-bdad9902be09`) tem:

- `ai_agent_config.enabled = true`
- `flow_reliability_v2 = off`
- fluxo D ativo com 15 passos

Com `flow_reliability_v2=off`, a detecção de “tem passo de abertura no fluxo” só loga, mas não impede a IA de tomar a primeira mensagem. Por isso até números novos travam.

## Plano de correção

### 1. Destravar imediatamente o número de teste

Limpar novamente o `11971254913`/`5511971254913`, incluindo o registro novo criado depois do último reset:

- `customers`
- `conversations`
- `ai_agent_logs`
- `bot_handoff_alerts`
- `crm_deals`
- `webhook_rate_limit`
- demais tabelas já cobertas pela função de hard reset

Depois validar com consulta final mostrando zero registros para as variações:

- `11971254913`
- `5511971254913`
- `+5511971254913`
- `5511971254913@s.whatsapp.net`

### 2. Corrigir a causa: fluxo deve vencer a IA na abertura

Ajustar o `evolution-webhook` para que, em mensagens de abertura (`welcome`, `menu_inicial` ou sem step), se o consultor tiver fluxo ativo com primeiro passo configurado, o webhook rode o fluxo determinístico/conversacional em vez de chamar `ai-agent-router`.

Na prática, mudar a regra atual:

```text
IA vence a abertura quando flow_reliability_v2=off
```

para:

```text
Fluxo ativo do consultor sempre vence a abertura
IA só entra depois, em etapas conversacionais não iniciais, quando aplicável
```

Isso evita que `Oi` caia no KB-only e pause antes do roteiro começar.

### 3. Ajustar segurança de fallback do AI KB-only

No `ai-agent-router`, manter o comportamento de handoff para perguntas reais sem match, mas não pausar automaticamente em saudações curtas de abertura como:

- `oi`
- `olá`
- `bom dia`
- `boa tarde`
- `boa noite`

Se uma saudação chegar ao router por qualquer motivo, ele deve retornar `skipped/opening_greeting` ou uma resposta segura sem pausar, para não quebrar o funil.

### 4. Tornar o botão de reset confiável para você ver o resultado

No botão temporário do dashboard:

- Após chamar `admin_hard_reset_phone`, fazer uma verificação de rastros para o telefone.
- Se ainda existir customer/log/deal, mostrar toast de erro com “ainda restam X registros”.
- Se zerou, mostrar “telefone zerado confirmado”.

Isso impede o cenário atual: o botão informa sucesso, mas logo depois o número reaparece porque entrou nova mensagem e o sistema pausou de novo.

### 5. Validar com dados reais

Depois de implementar:

1. Limpar `11971254913`.
2. Confirmar zero rastros.
3. Enviar `Oi` desse número.
4. Confirmar que o lead novo fica `bot_paused=false`.
5. Confirmar que `conversation_step` avança pelo fluxo D em vez de ficar em `welcome` com `ai_no_kb_match`.

## Arquivos envolvidos

- `supabase/functions/evolution-webhook/index.ts`
- `supabase/functions/ai-agent-router/index.ts`
- `src/services/resetConversation.ts`
- `src/components/admin/DashboardTab.tsx`
- Supabase: executar uma limpeza de dados do telefone específico após o ajuste

## Observação

O reset em si apaga. O que está dando a sensação de que “não resetou” é que uma nova mensagem recria o lead e ele trava de novo no mesmo motivo (`ai_no_kb_match`). A correção principal é impedir a IA KB-only de interceptar a abertura quando existe fluxo ativo.
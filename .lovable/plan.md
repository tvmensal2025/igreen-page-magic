# Auditoria pós-implementação — Fluxo D compartilhado

## 1. O que está OK agora


| Item                                 | Estado                                           |
| ------------------------------------ | ------------------------------------------------ |
| `bot_flows` D do tvmensal01          | 16 passos clonados, `is_active=true`             |
| `ai_media_library` rafael            | 43/43 `active=true` e `is_public=true`           |
| `evolution-webhook` fallback público | Implementado em `bot-flow.ts` (linhas 1166–1185) |
| `MediaColumn` toggle Globe           | Restrito a superadmin                            |
| `seed_default_camila_flow()`         | Reescrito para clonar do rafael                  |
| `clone_superadmin_flow_d_steps()`    | Disponível                                       |


**Cobertura de mídia por passo do fluxo D do tvmensal01** (após ativar tudo):

```
d_welcome              5 mídias  ✔
d_pedir_conta          1 mídia   ✔
d_como_funciona        12 mídias ✔
d_resultado            10 mídias ✔
d_pedir_documento      1 mídia   ✔
d_pedir_email          1 mídia   ✔
d_confirmar_telefone   1 mídia   ✔
d_duvidas              0  (slot_key nulo — só texto, by design)
d_handoff              0  (slot_key nulo — só texto, by design)
d_finalizar            2 mídias  ✔
d_simular_valor        0  (slot_key passo_d_simular_valor sem mídia no rafael)
d_simular_resultado    0  (slot_key passo_d_simular_resultado sem mídia no rafael)
d_escolher_simulacao   0  (slot_key nulo — só texto, by design)
d_simular_pedir_conta  1 mídia   ✔
d_como_funciona_copy*  12 mídias ✔ (x2)
```

11 dos 13 passos com `slot_key` agora resolvem mídia pública. 3 passos só-texto eram intencionais. Os 2 passos `d_simular_*` ficaram sem mídia porque nem o próprio rafael tem mídia para esses `slot_key`s — não há o que copiar.

## 2. Lacunas remanescentes (decidir se implementar)

### 2.1 Atalhos (`message_templates`) NÃO compartilhados — alto impacto

- Rafael: 22 atalhos / quick replies. Demais consultores: 0.
- Tabela não tem `is_public` nem RLS público.
- Proposta: adicionar `is_public boolean default false`, política RLS de leitura para `authenticated` quando `is_public=true`, marcar os 22 do rafael como públicos, e ajustar a UI de atalhos para listar próprios + públicos.

### 2.2 `voice_templates` continua sem nenhum item público

- Coluna `is_public` existe, mas 0 dos 1 registros estão marcados.
- Decidir: marcar o template oficial do rafael como `is_public=true`?

### 2.3 Whapi vs Evolution — dispatchers divergentes

- `whapi-webhook/handlers/conversational/index.ts` (linhas 218–235, 406–420) NÃO tem fallback público nem usa `is_public`.
- Se algum dia um consultor novo for criado no Whapi, ele não herda o template do rafael.
- A máquina de estados conversacional (`state-machine.ts`) do whapi usa step keys `welcome/qualificacao/checkin/club/duvidas`, diferentes dos `d_*` do fluxo D. Logo, a inteligência conversacional do rafael NÃO acompanha o clone — consultores Evolution recebem só o script linear.
- Proposta: extrair resolver de mídia em helper compartilhado e/ou portar a máquina de estados conversacional para o evolution-webhook.

### 2.4 `consultants.flow_step_media_order`

- Coluna usada só pelo whapi para reordenar `audio/video/image/text` por slot. Não replicada no evolution.
- Sem isso, ordem de envio do tvmensal01 pode diferir do rafael mesmo com mesma mídia.

### 2.5 `seed_default_camila_flow()` para novos consultores

- Agora gera D linear com mídia pública. Validar com um QA em consultor de teste antes de liberar onboarding.

### 2.6 Instância Evolution do rafael

- `igreen-0c2711ad4836` em `needs_reconnect`. Sem impacto operacional (rafael usa Whapi), só impede QA do template no canal Evolution.

## 3. Recomendação de próximas implantações (ordem de prioridade)

1. **Atalhos públicos** (2.1) — maior valor percebido pelos consultores no dia-a-dia.
2. **voice_templates público** (2.2) — uma linha de SQL.
3. **Mídia faltante em `d_simular_***` — pedir ao rafael para uppar áudio/vídeo nesses 2 slot_keys via UI atual.
4. **Unificar dispatcher Whapi↔Evolution** (2.3, 2.4) — refactor maior; agendar separado.
5. **Reconectar Evolution do rafael** (2.6) — só se quiser QA visual.

Diga quais desses itens devo implantar agora. MENOS O REFACTOR, ANTES DE APLICAR ANALISE O CODIGO SE REALEMTNE É ISSO MESMO PARA NAO TER ERRO. E NAO MECHER NO WHAPI
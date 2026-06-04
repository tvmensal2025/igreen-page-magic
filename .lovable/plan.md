# Auditoria do plano implementado vs. operação real do [rafael.ids@icloud.com](mailto:rafael.ids@icloud.com)

## 1. O que foi implementado (recap)

- Migration adicionou `voice_templates.is_public` + RLS público.
- Marcou as 43 mídias do superadmin (`0c2711ad…`) em `ai_media_library` como `is_public=true`.
- Função `clone_superadmin_flow_d_steps()` + reescrita do `seed_default_camila_flow()` para clonar passos da variante D do rafael.
- Backfill do `tvmensal01` (`b539a8a2…`): fluxo antigo de 6 passos substituído por clone de 16 passos.
- `bot-flow.ts` (evolution-webhook): busca mídia do próprio consultor; se vazio, cai em `ai_media_library` `is_public=true` pelo `slot_key`.
- `MediaColumn.tsx`: botão Globe para superadmin marcar mídia como pública.

## 2. O que está OK

- Clone estrutural funcionou: tvmensal01 tem os 16 passos com `step_key`, `step_type`, `position`, `slot_key`, `message_text`, `transitions` idênticos ao template do rafael.
- `seed_default_camila_flow()` agora é idempotente e usa o template do superadmin.
- Fallback público no `evolution-webhook` está implementado e logado.
- Toggle Globe na UI está restrito a superadmin.

## 3. Problemas críticos encontrados

### 3.1 O fallback de mídia público cobre apenas 3 dos 16 passos

A clonagem preserva `slot_key`, mas o lookup runtime (`ai_media_library` por `consultant_id + slot_key + active=true`) só encontra mídia pública em:


| slot_key         | mídias públicas ativas |
| ---------------- | ---------------------- |
| `como_funciona`  | 2                      |
| `passo_mpagqq3g` | 1                      |
| `(null)`         | 3                      |


Os outros 13 `slot_key`s usados pelo fluxo D (`passo_mp8yc0bp`, `passo_mp74xnmn`, `fazenda_solar`, `passo_mp7o985n`, `passo_mpa3yr6a`, `prova_social`, `passo_d_simular_valor`, `passo_d_simular_resultado`, `passo_d_simular_pedir_conta`, …) **não retornam nenhuma mídia pública** porque, mesmo após o backfill, no `ai_media_library` do rafael apenas **6 itens estão `active=true**` (o resto está `active=false` ou com `slot_key=null`). O `is_public=true` foi aplicado em tudo, mas o filtro `active=true` no dispatcher elimina a maioria.

**Efeito prático:** o fluxo do tvmensal01 vai disparar passos com apenas o `message_text`, sem áudio/vídeo/imagem que o rafael envia no Whapi. O usuário verá uma conversa “seca” em comparação.

### 3.2 [rafael.ids@icloud.com](mailto:rafael.ids@icloud.com) NÃO roda no `evolution-webhook`

Rafael opera via Whapi (`whapi-webhook`), enquanto tvmensal01 e demais consultores rodam no `evolution-webhook`. As pipelines são separadas:

- `whapi-webhook/handlers/conversational/index.ts` resolve mídia via `ai_media_library` por `consultant_id + slot_key` **sem fallback público**.
- A precedência de ordem (`consultants.flow_step_media_order` → `step.media_order` → default) também é exclusiva do whapi handler.
- A máquina de estados (`state-machine.ts` do whapi) usa step keys próprios (`welcome`, `qualificacao`, `checkin`, `club`, `duvidas`), distintos do D (`d_welcome`, `d_pedir_conta`, …). Logo, o fluxo D clonado **não recebe os ganchos conversacionais** que o rafael tem.

**Conclusão:** clonar “o fluxo do rafael” para um consultor Evolution copia a estrutura, mas não copia o comportamento real do Whapi.

### 3.3 Atalhos / `message_templates` não foram clonados

- Rafael tem 22 `message_templates` com `is_quick_reply=true`.
- tvmensal01 e demais: 0.
- A tabela não tem coluna `is_public` e nenhum mecanismo de compartilhamento foi adicionado.

### 3.4 `voice_templates` continua privado

Coluna `is_public` foi criada e indexada, mas dos 1 registro existente, **0 estão públicos**. A migration não populou nada.

### 3.5 Risco para novos consultores

`seed_default_camila_flow()` agora cria 16 passos D para qualquer novo consultor, mas como 3.1 mostra, eles vão receber um fluxo praticamente sem mídia. Pior que o fluxo de 6 passos antigo, que ao menos tinha textos coerentes.

### 3.6 Instância do rafael no Evolution

`whatsapp_instances` mostra `igreen-0c2711ad4836` com `status=needs_reconnect`. Mesmo que se quisesse reaproveitar o fluxo via Evolution, a instância do rafael não está conectada lá — ele opera via Whapi.

## 4. Recomendações (próximo plano, requer aprovação)

1. **Ativar mídia pública corretamente**: rodar UPDATE em `ai_media_library` setando `active=true` para o conjunto mínimo de mídias do rafael que cobrem os 13 `slot_key`s restantes do fluxo D — ou criar um “kit oficial” curado pelo superadmin via UI.
2. **Unificar dispatchers**: extrair lógica de resolução de mídia em helper compartilhado para que `whapi-webhook` e `evolution-webhook` apliquem o mesmo fallback público e a mesma precedência de `media_order`.
3. **Compartilhar atalhos**: adicionar `is_public` a `message_templates` (com RLS público de leitura para autenticados) e marcar os 22 do rafael como `is_public=true`. Atualizar a UI de atalhos para listar próprios + públicos.
4. **Compartilhar voice_templates**: marcar o(s) template(s) oficial(is) do rafael como `is_public=true` (não foi feito na migration anterior).
5. **Decidir o destino do fluxo D no Whapi vs Evolution**: ou portar a máquina de estados conversacional do Whapi para Evolution, ou aceitar que “fluxo padrão” = apenas script linear de passos (e documentar isso).
6. **Reconectar instância Evolution do rafael** se for usado para QA do template.

## 5. Itens técnicos detalhados

- Step keys do D clonados: `d_welcome, d_pedir_conta, d_como_funciona, d_resultado, d_pedir_documento, d_pedir_email, d_confirmar_telefone, d_duvidas, d_handoff, d_finalizar, d_simular_valor, d_simular_resultado, d_escolher_simulacao, d_simular_pedir_conta, d_como_funciona_copy_in3s, d_como_funciona_copy_qwpu`.
- Dispatcher relevante: `supabase/functions/evolution-webhook/handlers/bot-flow.ts` linhas 1161–1185 (fallback público).
- Dispatcher Whapi (sem fallback): `supabase/functions/whapi-webhook/handlers/conversational/index.ts` linhas 218–235 e 406–420.
- `consultants.flow_step_media_order`: usado só no whapi para reordenar `audio/video/image/text`; não replicado no evolution.  
  
DOU PERMISSAO PARA COLOCARTODOSAS MIDIAS USADAS NO SUPERADMIN COMO PUBLICO
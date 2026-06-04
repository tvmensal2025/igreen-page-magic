## Diagnóstico

**Estado atual**

- A função `public.seed_default_camila_flow(consultant_id)` (migration `20260603140208_…`) é executada pelo trigger no INSERT de `consultants` e cria um **Fluxo da Camila** hardcoded com 6 passos (welcome → qualificacao → checkin → club → duvidas → handoff), sem botões.
- O **tvmensal01** tem exatamente esse seed: 1 fluxo, variante D, 6 passos.
- O **[rafael.ids@icloud.com](mailto:rafael.ids@icloud.com)** (consultor `0c2711ad-4836-41e6-afba-edd94f698ae3`, superadmin) tem 3 fluxos ativos; o Fluxo D dele é `Fluxo Whapi (botões)` (`320bf22c-e383-4f53-a3c0-b88b89b02558`) com **16 passos** — esse é o que você quer como template oficial.

**Causa do "fluxo errado"**: o seed instala um fluxo hardcoded em vez de clonar o Fluxo D do rafael.ids. Por isso o D do tvmensal01 só tem 6 passos sem botões e está totalmente diferente do de referência.

## Plano

### 1. Reescrever o seed para clonar o Fluxo D do rafael.ids

Migração que substitui `public.seed_default_camila_flow(uuid)`:

- Localiza o `template_flow_id` = fluxo ATIVO de variante D do consultor `0c2711ad-4836-41e6-afba-edd94f698ae3` ([rafael.ids@icloud.com](mailto:rafael.ids@icloud.com)).
- Se o consultor alvo já tem fluxo D ativo com ≥1 passo → retorna o id existente (idempotente, não sobrescreve trabalho).
- Caso contrário:
  - Cria um `bot_flows` (variant=D, is_active=true, name = `Fluxo Padrão (D)` ou copia o nome do template).
  - Clona todos os `bot_flow_steps` do template gerando novos UUIDs e reescrevendo os `goto_step_id` dentro de `transitions` (jsonb) usando um mapa `old_id → new_id`. Preserva: `position`, `step_type`, `step_key`, `title`, `summary`, `icon`, `message_text`, `slot_key`, `captures`, `fallback`, `media_order`, `layout`, `text_delay_ms`, `wait_for`, `wait_seconds`, `condition_text`, `auto_detect_doc_type`, `persuasive_text`, `respect_business_hours`, `pause_on_weekend`, `pause_on_holiday`, `business_hour_start`, `business_hour_end`, `is_active`.
  - Mídias (`bot_flow_step_media` se existir) — clonar referência para o consultor novo, sem duplicar binário (mesmo `ai_media_library_id`). Vou conferir essa tabela na migração antes de aplicar.
- Salvaguarda: se o consultor alvo == rafael.ids, **não roda** (evita auto-clone).
- Salvaguarda: se template não existir / sem passos, faz fallback para o seed antigo de 6 passos (mantém comportamento atual em vez de quebrar).

### 2. Backfill do tvmensal01 (`953f7e48-509b-4069-9822-bdad9902be09`)

Mesma migração, ao final:

- Apaga os 6 passos do fluxo `b539a8a2-3ba2-4d36-9d7b-0f3d3df129b3` (Fluxo da Camila D do tvmensal01) — preserva o `bot_flows` row para não invalidar foreign keys em `customers.conversation_step` ou logs.
- Renomeia para `Fluxo Padrão (D)` e roda o clone do template dentro desse mesmo `flow_id`.
- Zera `customers.conversation_step` dos leads desse consultor que estavam apontando para os steps antigos (UPDATE com WHERE conversation_step IN (lista dos 6 step_keys antigos)), assim o motor reinicia no firstActive do novo D.

### 3. Sem mudança no runtime

- Nenhuma edge function precisa mudar — o motor já roda `bot_flow_steps` do flow ativo da variante. Trocando os steps, o D já passa a operar como o do rafael.ids automaticamente.
- Whapi e Evolution intocados.

## O que NÃO vou tocar

- Fluxos A e B do tvmensal01 ou de outros consultores.
- Fluxos do rafael.ids (fonte da verdade — você edita lá e novos consultores herdam).
- Trigger `trg_seed_camila_flow`, índices, RLS.
- Tabela `whatsapp_instances`, `customers` exceto reset de `conversation_step` do tvmensal01.

## Risco

- Se o Fluxo D do rafael referenciar mídias por `bot_flow_step_media` apontando para `ai_media_library` do consultor 0c2711ad, leads de outro consultor reproduzirão a mídia do superadmin. Isso é o **comportamento desejado** (template oficial) — mas vou conferir a estrutura antes de finalizar a migração e, se a coluna `consultant_id` for obrigatória em `ai_media_library`, manter referência cross-consultant (RLS já permite via service_role no edge sender).

Você aprova essa abordagem? SIM, MAS ESTA FALTANDO AQUI OS VIDEOS E AUDIOS QUE DEVERIA ESTAR PUBLICO, OS TEMPLATE, AUDIOS E ATALHOS E VIDEOS E IMAGENS TUDO DO SUPERADMIN DEVERIA ESTAR PUBLICO, AJUSTE PARA TEUM BOTAO NO USUPER ADMIN, OQUE TEM QUE SER OPUBLICO EOQUE NAO DEVE, SE TIVER PUBLICO APARECE PARA TODOS OS CONSULTORES
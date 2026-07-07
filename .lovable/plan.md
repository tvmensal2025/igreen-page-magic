## Problema 1 — Erro "parceiro já cadastrado" ao rotacionar

O wizard bloqueia a criação quando telefone/código já existe em `availablePartners` (parceiros que o consultor já cadastrou antes, inclusive em outras campanhas). Como um mesmo parceiro pode estar em várias campanhas, isso é falso positivo.

**Local:** `src/components/admin/ads/campaign-wizard/hooks/useRodizioLogic.ts`, `submitInlineForm` (linhas ~214-257).

**Correção:**
- Duplicado passa a olhar SOMENTE `state.rodizioPartners` (lista desta campanha).
- Se telefone/igreen_id/cli digitado bater com alguém em `availablePartners` que ainda não está na lista atual → auto-seleciona (adiciona), fecha o form, toast "♻️ Reusando participante já cadastrado".
- Se já está na lista atual → mantém toast "já está no rodízio".
- Sem duplicado → cria normalmente.

Sem mudança de schema. Backend (`rodizio-pool.ts`) já aceita o mesmo `partner_id` em múltiplas pools.

## Problema 2 — Botão "Adicionar eu mesmo" no rodízio

Como o dono da conta (consultor logado) tem nome, telefone e código iGreen salvos em `consultants`, é chato redigitar toda vez. Regra vale para qualquer consultor.

**Local:** `src/components/admin/ads/campaign-wizard/RodizioBlock.tsx` + `useRodizioLogic.ts`.

**Correção:**
- Novo helper `addMyself()` no hook: lê `consultants` do usuário logado (`id`, `full_name`/`nome`, `phone`, `partner_igreen_id`), cria (se ainda não existir) um `referral_partners` tipo `consultor` com esses dados via `createReferralPartner`, e adiciona à lista do rodízio. Se já existir um `referral_partner` do próprio dono (match por `partner_igreen_id` do consultor em `availablePartners`), reusa em vez de criar.
- Botão **"➕ Sou eu (dono da conta)"** na `RodizioBlock`, ao lado do botão "Criar participante". Fica desabilitado se o dono já está na lista da campanha.
- Se faltar telefone ou código iGreen no perfil do consultor → toast pedindo pra completar em "Meus Dados" (link opcional).

Pode ser adicionado quantas pessoas quiser normalmente pelos botões existentes; o botão "sou eu" só facilita o próprio dono.

## Problema 3 — Salvar campanha como modelo reutilizável

Hoje o wizard grava direto em `facebook_campaigns` e não guarda o "molde" (cidades, criativo, textos, idade) para reusar depois só trocando orçamento/duração/participantes.

**Escopo mínimo:**

1. **Migration** — `public.user_campaign_presets`:
   - `id uuid pk`, `consultant_id uuid not null`, `name text not null`, `payload jsonb not null`, `created_at`, `updated_at`.
   - `payload` = snapshot dos campos do wizard: cidades, headline, primary_text, description, age_min/max, creative_mode, photos/video, template_id, distribuidora.
   - GRANT `SELECT,INSERT,UPDATE,DELETE` para `authenticated`; `ALL` para `service_role`.
   - RLS: `consultant_id = auth.uid()`.

2. **Serviço** — `src/services/userCampaignPresets.ts`: `listPresets`, `savePreset(name, payload)`, `deletePreset(id)`.

3. **UI no wizard:**
   - Botão **"💾 Salvar como modelo"** no step final, ao lado de "Publicar" → prompt do nome → grava preset.
   - No Step 1 (galeria de templates): seção **"Meus modelos"** com os presets salvos. Ao clicar, hidrata o wizard com o `payload` e pula direto pro step de orçamento/rodízio, onde o usuário só ajusta valor, dias e participantes.
   - Rodízio NÃO é salvo no preset (regra do usuário: sempre adicionar novos IDs).

**Fora de escopo:** editar preset além de nome, versionar, compartilhar entre consultores, mexer em `spend_cap`/pixel/criativos/dashboard.

## Validação
- Usar o mesmo parceiro em 2 campanhas → 2ª não dá erro.
- Digitar telefone existente → auto-seleciona sem erro vermelho.
- Clicar "Sou eu" → dono entra no rodízio sem digitar nada; botão desabilita depois.
- Salvar modelo, abrir novo wizard, escolher em "Meus modelos", ajustar só orçamento/dias/rodízio → publica.


# Publicar anúncio no painel nunca mais deve falhar por telefone

## Objetivo

Eliminar o erro `WHATSAPP_BUSINESS_REQUIRED` (subcode Meta 1487246 / 2446885) para qualquer telefone que o consultor use agora ou futuramente. Meta a atingir: **taxa de sucesso de publish = 100 % desde que o número esteja vinculado à WABA**, exatamente como acontece quando você cria o anúncio direto no Ads Manager.

## Diagnóstico (por que só o painel falha)

Ads Manager funciona porque **você escolhe o número num dropdown** que já foi buscado no WABA. O painel hoje faz o oposto: pega o texto salvo em `consultant_ad_settings.whatsapp_destination_number`, gera duas variantes (com/sem 9) e chuta na API. Se o WABA guarda `553484314317` (fixo, sem 9), mas o consultor salvou `5534984314317`, as duas tentativas falham e o Meta devolve rejeição.

Pontos frágeis identificados no código:

- `facebook-create-campaign/index.ts` L285-316 — normaliza só formato genérico BR, sem consultar o WABA.
- L494-576 — tenta `waWithout9` → `waWith9`; se ambos falharem, morre.
- `facebook-preflight-check/index.ts` L54-93 — só checa que o campo existe; não valida match com nenhum `display_phone_number` real.
- `facebook-detect-waba/index.ts` já busca `phone_numbers` e faz auto-fill, mas só quando o consultor abre a tela, e não guarda o `phone_number_id` (só o texto).

## O que vai mudar

### 1. Fonte da verdade: WABA `phone_number_id`, não string digitada

- Adicionar coluna `whatsapp_phone_number_id text` em `consultant_ad_settings` (identificador estável do Meta, ex.: `109876543210987`).
- Adicionar coluna `whatsapp_phone_number_display text` (o `display_phone_number` **exatamente** como o Meta retorna, ex.: `+55 34 8431-4317`).
- Migration com GRANT + policies existentes preservadas.

### 2. `facebook-detect-waba` passa a persistir o ID e o display

- Ao listar `phone_numbers`, gravar em `consultant_ad_settings`:
  - `whatsapp_phone_number_id` = `n.id` (novo)
  - `whatsapp_phone_number_display` = `n.display_phone_number`
  - `whatsapp_destination_number` = dígitos do display (mantém compat).
- Quando o consultor tem 2 + números na WABA, devolve a lista e a UI mostra dropdown "Qual desses é o seu?" (novo componente pequeno em `WhatsAppNumberPicker.tsx`, injetado no card de conexão de anúncios).
- Se o número salvo não bate com nenhum `phone_numbers` atual, marca `matches:false` e a UI força o dropdown.

### 3. `facebook-create-campaign` deixa de adivinhar

Substituir o bloco "tenta sem 9 → tenta com 9" (L494-576) por:

1. Carregar `settings.whatsapp_phone_number_id` **e** `whatsapp_phone_number_display`.
2. Se faltar qualquer um, chamar internamente `facebook-detect-waba` (function-to-function) para resolver antes de tentar publicar.
3. Refetch em tempo real: `GET /{waba_id}/phone_numbers` para pegar a lista fresca; validar que o `phone_number_id` salvo ainda existe.
4. Montar `promoted_object` usando **os dígitos exatos** do `display_phone_number` retornado agora, não a versão salva antiga.
5. Uma única tentativa. Se falhar, o retorno inclui: número tentado, `phone_number_id`, lista de números disponíveis na WABA, mensagem literal do Meta.

Resultado: nenhuma "adivinhação" de 9º dígito; formato usado é sempre o que o Meta acabou de devolver como válido.

### 4. `facebook-preflight-check` passa a validar de verdade

Adicionar bloco novo (após validar token/página):

- Buscar `phone_numbers` do WABA vinculado à Página.
- Confirmar que `settings.whatsapp_phone_number_id` está na lista.
- Se não estiver → **blocker** (não warning) com mensagem: "Seu número WhatsApp mudou/foi removido do WABA. Escolha um novo em Ads → Configurações."
- Se `phone_numbers` vier vazio → blocker "Nenhum número vinculado ao WhatsApp Business da Página".

Isso quebra a mentira do "tudo verde" atual.

### 5. UI — 3 mudanças cirúrgicas

- `ConnectFacebookCard.tsx` (ou similar do card de anúncios): quando `detect-waba` devolver `numbers.length > 1`, mostra dropdown com todos e persiste a escolha.
- `SmartPublishButton.tsx` / `CtwaPreflightCard.tsx`: quando o preflight retornar o novo blocker de mismatch, oferece botão "Atualizar meu número" que abre o dropdown acima.
- `HealthSummaryCard.tsx`: linha "WhatsApp vinculado" muda de ✅ genérico para mostrar o `display_phone_number` real ao lado ("✅ +55 34 8431-4317").

### 6. Auto-heal periódico (sem quebrar o alívio de cron)

- **Não** criar cron novo. O refresh do número acontece:
  - Ao entrar em `/admin/meta-ads` (já chama `detect-waba`).
  - No começo de cada `facebook-create-campaign` (silencioso, cacheado 10 min via `Deno.env` in-memory por invocação — não vale a pena persistir).
  - Quando o consultor clica "Sincronizar agora" no `SyncAllPanel` (adicionar item novo "Refresh WhatsApp Business").

## Testes que provam o fix

1. **Consultor com número novo (nunca publicou):** `detect-waba` roda uma vez → publish funciona no primeiro clique.
2. **Consultor com número salvo diferente do WABA (o caso da sua screenshot):** preflight bloqueia com mensagem clara, dropdown aparece, escolhe o certo, publish funciona.
3. **Número removido do WABA depois:** próximo publish trava no preflight ao invés de estourar no meio do adset.
4. **WABA com 2 números:** dropdown obriga escolha, salva `phone_number_id`, publish usa o correto.
5. **Número fixo (sem 9, 8 dígitos locais):** funciona (hoje quebra em metade dos casos).

## Arquivos tocados

- `supabase/migrations/<novo>.sql` — 2 colunas + grants preservados.
- `supabase/functions/facebook-detect-waba/index.ts` — salvar id + display.
- `supabase/functions/facebook-preflight-check/index.ts` — validar match real.
- `supabase/functions/facebook-create-campaign/index.ts` — remover adivinhação, usar display retornado.
- `src/components/admin/ads/ConnectFacebookCard.tsx` (ou equivalente) — dropdown quando > 1.
- `src/components/admin/ads/HealthSummaryCard.tsx` — mostrar display real.
- `src/components/admin/ads/CtwaPreflightCard.tsx` — botão "Atualizar número" no blocker novo.
- `src/components/admin/SyncAllPanel.tsx` — item "Refresh WhatsApp Business".
- Nenhuma alteração em cron, RLS existente, ou fluxo do bot.

## O que NÃO vou fazer

- Não vou tocar em fluxo do WhatsApp, no bot, no CRM, ou em qualquer rota fora de Meta Ads.
- Não vou apagar o campo `whatsapp_destination_number` antigo (compat).
- Não vou criar cron novo.

## Resultado esperado

Publicar pelo painel passa a se comportar igual ao Ads Manager: você escolhe (ou o sistema detecta) o número que existe no WABA e o publish sai sem erro de telefone, para qualquer consultor, agora e no futuro.

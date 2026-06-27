
## Objetivo

Na tela **Captação → Leads captados (Ads/B2B)** (`CapturedLeadsPanel.tsx`):

1. **Corrigir o scroll** — hoje a lista não desce. A área da lista vai ganhar `flex-1 min-h-0 overflow-y-auto` de verdade, com header e filtros como `shrink-0`, para que só a tabela role.
2. **Melhorar o visual** — header mais respirado com contador "X selecionados · Y visíveis · Z total", barra de filtros agrupada em card, linhas mais arejadas (`py-3`), separadores suaves, hover claro, linha selecionada com barra lateral primary, badges de canal coloridas (Meta = primary, TikTok = accent, B2B = info, etc.).
3. **Marcar leads já enviados** — todo telefone que o consultor já disparou em qualquer campanha anterior (`bulk_campaign_targets` com status `sent` ou `sending`) aparece com badge verde **"✓ Já enviado"**, linha esmaecida, checkbox desabilitado e não entra no disparo. Toggle no topo **"Ocultar já enviados"** (ligado por padrão) para o consultor focar nos novos.

## Mudanças

- **`src/services/capturedLeads.ts`** — nova função `listAlreadyDispatchedPhones(consultantId)` que lê `bulk_campaigns` do consultor e depois `bulk_campaign_targets` em lotes, devolvendo um `Set<string>` com os últimos 11 dígitos de cada telefone já disparado.
- **`src/components/captacao/CapturedLeadsPanel.tsx`** — refator visual + integração do Set:
  - Carrega `sentPhones` em paralelo com `listCapturedLeads` e `countLeadsByChannel`.
  - Helper `normalizePhone` (só dígitos, últimos 11) e mapa `CHANNEL_STYLE` para cor por canal.
  - Filtro `hideSent` (default `true`) aplicado depois da query.
  - Layout: container `flex flex-col flex-1 min-h-0`, header e filtros `shrink-0`, lista `flex-1 min-h-0 overflow-y-auto`.
  - Linha já enviada: `opacity-60`, `cursor-default`, checkbox `disabled`, badge `CheckCircle2 Já enviado` ao lado do telefone.
  - `toggleAll` e `openDispatch` ignoram leads já enviados (defesa em profundidade).

## Detalhes técnicos

- Sem migração SQL — `bulk_campaign_targets` já tem RLS via `bulk_campaigns.consultant_id`.
- Comparação de telefones pelos últimos 11 dígitos para tolerar DDI 55.
- Sem mudanças no fluxo de disparo, anti-ban, Cockpit ou `BulkProPanel`.

## Fora de escopo

- Cockpit de captação, motor de envio e modal de Pesquisa B2B não mudam.

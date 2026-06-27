
## Objetivo

Na tela **Captação → Leads captados (Ads/B2B)** (`CapturedLeadsPanel.tsx`):

1. **Corrigir scroll vertical** — hoje a lista não rola, porque a tabela cresce além da altura útil e o `overflow-y-auto` não está respeitando o limite do container pai.
2. **Melhorar o visual** — manter o layout em tabela, mas com cards/linhas mais arejadas, separadores melhores, badges mais limpas, header sticky com sombra, hover e seleção mais perceptíveis, contagem "X selecionados / Y visíveis / Z total" no topo.
3. **Marcar leads já disparados** — todo telefone que já foi enviado em alguma campanha anterior (`bulk_campaign_targets` com status `sent`) aparece com badge **"Já enviado"**, fica visualmente esmaecido e não pode ser selecionado para disparo, evitando repetir o mesmo número.

## Mudanças

### 1. Scroll (fix de layout)
- Em `CaptacaoPanel.tsx` linha 222, o wrapper `<div className="flex-1 min-h-0 overflow-hidden p-3">` está OK, mas o `CapturedLeadsPanel` usa `flex-col flex-1 min-h-0`. O problema é que o cabeçalho + filtros + lista somam altura maior que o container. Garantir que **só a área da lista** (entre o header de filtros e o fim) tenha `overflow-y-auto`, e que header/filtros sejam `shrink-0`.
- Trocar `<table>` para um wrapper com `max-h` explícito não — o correto é manter a estrutura flex e adicionar `shrink-0` no header e nos filtros, e o div da lista mantém `flex-1 min-h-0 overflow-y-auto`. Isso resolve em viewports pequenos como 1050×692.

### 2. Visual (apenas frontend)
- Header em duas linhas mais respiráveis: título grande + contador grande à esquerda, ações à direita. Adicionar contador secundário: `X selecionados · Y visíveis · Z total`.
- Filtros agrupados em uma faixa com fundo `bg-card/40` e cantos arredondados, ícones nos selects.
- Tabela: linhas com `py-3`, separador `border-border/30`, hover suave `bg-primary/5`, linha selecionada com barra lateral primary à esquerda (`border-l-2 border-primary`).
- Badge de canal colorida por tipo (Pesquisa B2B = info, Meta = primary, TikTok = accent, etc.).
- Estado vazio mais bonito (já existe, só refinar copy).
- Mobile: já está com colunas `hidden sm/md` — manter.

### 3. Marcar "já enviado" (anti-repetição)
- Adicionar função em `src/services/capturedLeads.ts`:
  ```ts
  listAlreadyDispatchedPhones(consultantId): Promise<Set<string>>
  ```
  Consulta `bulk_campaign_targets` (join com `bulk_campaigns` filtrando por `consultant_id`) com `status = 'sent'`, retorna Set de telefones normalizados (só dígitos).
- No `CapturedLeadsPanel`:
  - Carregar esse Set em paralelo com `listCapturedLeads`.
  - Para cada lead, calcular `alreadySent = sentPhones.has(normalizePhone(l.phone))`.
  - Se `alreadySent`: linha com opacidade 60%, badge verde `✓ Já enviado` na coluna Contato, checkbox **desabilitado**, click na linha não seleciona.
  - `toggleAll` ignora leads `alreadySent`.
  - `openDispatch` filtra para não incluir já-enviados (segurança extra).
- Adicionar toggle no header: **"Ocultar já enviados"** (default: **ligado**) — esconde linhas já disparadas para o consultor focar nos novos.

## Detalhes técnicos

- Arquivos editados:
  - `src/components/captacao/CapturedLeadsPanel.tsx` — refator visual + integração do Set de já-enviados.
  - `src/services/capturedLeads.ts` — nova função `listAlreadyDispatchedPhones`.
- Sem migração SQL: a tabela `bulk_campaign_targets` já existe e o RLS já restringe ao consultor dono via `bulk_campaigns.consultant_id`.
- Normalização de telefone: usar helper já presente (`.replace(/\D/g, "")`) ou criar inline. Comparar pelos últimos 11 dígitos para tolerar DDI 55.
- Sem mudança de fluxo de disparo nem do motor anti-ban.

## Fora de escopo

- Não mexer no Cockpit de captação, nem no `BulkProPanel`, nem no fluxo de envio.
- Não criar persistência adicional — a fonte da verdade de "já enviado" continua sendo `bulk_campaign_targets`.

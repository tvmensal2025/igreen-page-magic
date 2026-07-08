
# Botão "Ver leads do rodízio" na lista de campanhas

## O que você vai ver

Nas campanhas que **têm rodízio ligado**, aparece um novo botão de ícone (👥) ao lado dos outros (pausar / estender / editar). Ao clicar, abre um diálogo que mostra:

- **Por parceiro**: nome + telefone do parceiro, quantos leads recebeu, e a **lista dos leads** (nome, telefone, quando entrou).
- **Total geral** da campanha.
- Botão em cada lead que leva para a conversa no WhatsApp (mesma navegação já usada).

Campanhas sem rodízio **não mostram o botão** — evita ruído visual.

## Onde os dados vêm

- `rodizio_pools` (pool ativa da campanha) → `rodizio_pool_members` → `referral_partners` (nome/phone).
- `customers` filtrados por `source_campaign_id = <campanha>` e `referral_partner_id IS NOT NULL`, agrupados por `referral_partner_id`.
- Ordenado do parceiro com mais leads pro com menos; leads dentro de cada bloco por `created_at DESC`.

## Arquivos

### Novo: `src/components/admin/ads/CampaignRodizioLeadsDialog.tsx`
- Props: `campaignId`, `campaignName`, `open`, `onOpenChange`.
- Ao abrir: 3 queries paralelas (pool ativa, membros+partners via join, customers do rodízio).
- Estado de loading, empty ("Nenhum lead atribuído ao rodízio ainda"), erro.
- Layout: header com nome da campanha e contador total; lista colapsável por parceiro (expandido por padrão); dentro, cards leves com nome/telefone/data e botão "Abrir conversa".

### Editar: `src/components/admin/ads/CampaignsList.tsx`
- No `load()` (linha ~110): após carregar `list`, fazer 1 query extra `rodizio_pools.select("campaign_id").in("campaign_id", ids).eq("is_active", true)` → guardar `Set<string>` de campaign_ids com rodízio.
- Estado `rodizioSet: Set<string>` e `rodizioCampaign: {id, name} | null`.
- No bloco de botões (linhas 390–443), adicionar antes do botão Editar:
  ```tsx
  {rodizioSet.has(c.id) && (
    <Button size="icon" variant="ghost" className="h-8 w-8"
      onClick={() => setRodizioCampaign({ id: c.id, name: c.name })}
      title="Ver leads distribuídos pelo rodízio">
      <Users className="w-4 h-4 text-primary" />
    </Button>
  )}
  ```
- Renderizar `<CampaignRodizioLeadsDialog>` no final, controlado por `rodizioCampaign`.

## O que NÃO muda

- Não altera lógica de atribuição do rodízio (helper `rodizio-assignment.ts` intacto).
- Não altera nenhuma edge function.
- Não cria tabela nem migração — dados já existem.
- Campanhas sem rodízio permanecem exatamente como estão.

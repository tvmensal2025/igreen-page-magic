## Problema

O diálogo "Ver leads do rodízio" quebra com:
`column customers.phone does not exist`

## Causa

Em `src/components/admin/ads/CampaignRodizioLeadsDialog.tsx` a query seleciona `phone` da tabela `customers`, mas essa coluna não existe. As colunas reais de telefone são: `phone_whatsapp`, `phone_landline`, `phone_contact_confirmed`, etc. A principal é **`phone_whatsapp`**.

## Correção (apenas frontend, sem migration)

Editar `src/components/admin/ads/CampaignRodizioLeadsDialog.tsx`:

1. Linha 75 — trocar o select:
   - de: `.select("id, name, phone, created_at, referral_partner_id")`
   - para: `.select("id, name, phone_whatsapp, created_at, referral_partner_id")`

2. Linha 86 — mapear o campo:
   - de: `phone: c.phone,`
   - para: `phone: c.phone_whatsapp,`

O tipo `LeadRow` interno continua com a chave `phone` (usada apenas na renderização), então nada mais muda.

## Verificação de funções semelhantes

Busquei outros usos de `customers.phone` no código para checar se o mesmo bug se repete em outras "funções criadas sem coluna". Farei um `rg "from\\(\"customers\"\\)" -A2` antes de editar e, se aparecer o mesmo padrão em outros arquivos, corrijo na mesma passada trocando por `phone_whatsapp`.

Nenhuma alteração de banco é necessária.
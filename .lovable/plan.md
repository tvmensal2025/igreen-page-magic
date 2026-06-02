# Fechar atribuição de leads por parceiro — UI restante

Backend, filtro lógico e dashboard já estão prontos. Faltam só 2 peças visuais em `src/pages/AdminConversao.tsx` para o ciclo ficar 100% navegável.

## 1. Linha de filtro "Parceiro"

Logo abaixo da barra de "Origem" (linha ~370–392), adicionar uma segunda linha de chips com os parceiros do consultor, usando o mesmo visual dos chips de Origem.

- Chip "Todos" (`partnerFilter = "all"`)
- Chip "Sem parceiro" (`"none"`) — leads sem `referral_partner_id`
- Um chip por parceiro (`partners` já vem do hook `useReferralPartners`), mostrando o nome e um contador discreto entre parênteses com quantos leads daquele parceiro existem na lista atual (calculado de `rows`)
- Click usa `handlePartnerFilter(id)` (já existe) — também já sincroniza `?partner=...` na URL
- A linha inteira só aparece se `partners.length > 0`
- Se chegar com `?partner=ID` mas o parceiro não existir mais, voltar para "all"

## 2. Selo do parceiro na coluna Origem da tabela

Na célula "Origem" de cada linha (≈ linha 452–456), quando `r.customer?.referral_partner_id` existir:

- Substituir/empilhar o badge genérico "Parceiro" por um badge nominal com o nome curto do parceiro (lookup em `partners` por id)
- Abaixo do nome, em `text-[9px] text-muted-foreground`, mostrar a keyword que casou (`referral_keyword_matched`) quando houver — ajuda o admin a entender por que o lead foi atribuído
- Se `referral_partner_id` existir mas o parceiro foi deletado, mostrar "Parceiro removido" em cinza

No drawer de detalhe (SheetDescription, ~514), acrescentar `· via {nomeParceiro}` quando houver atribuição.

## Validação

1. Abrir `/admin/conversao` — nova linha "Parceiro" aparece com os 5 chips
2. Clicar num parceiro → URL vira `?partner=ID`, lista filtra (vazia enquanto nenhum lead foi atribuído ainda — esperado)
3. Voltar para Parceiros → cards continuam mostrando 🔴/🟡/🟢 corretamente
4. Quando o primeiro lead for atribuído via webhook, ele aparece com o nome do parceiro no badge da coluna Origem e a keyword logo abaixo
5. Clicar em "Leads" no card do parceiro → cai em `/admin/conversao?partner=ID` já filtrado

## Arquivos

- `src/pages/AdminConversao.tsx` (única alteração)

Nenhuma mudança de schema, hook ou backend.

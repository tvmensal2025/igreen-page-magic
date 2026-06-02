# Parceiros mais fácil + atribuição na Conversão + health check

## O que muda

### 1. Aba **Parceiros** — lista no topo, clique pra editar

Hoje, ao entrar em Parceiros, o usuário vê primeiro o dashboard com gráficos. Editar exige rolar até "Ranking detalhado".

**Mudança em `src/components/admin/parceiros/PartnerDashboard.tsx`:**

- No topo (logo abaixo do header "Dashboard de Parceiros"), inserir uma **grid de cards compactos** (1 por parceiro), 3-4 por linha. Cada card mostra:
  - Nome do parceiro
  - 1 selo de **saúde**: 🟢 OK / 🟡 sem keyword / 🔴 0 leads em 30d
  - Quantidade de leads atribuídos (total e 30d)
  - 3 ações inline: **Editar** (lápis), **QR Code**, **Ver leads na Conversão**
- Cards são `cursor-pointer` → clique abre o `PartnerForm` em modo edição (atalho duplo: clicar no card também edita).
- Os gráficos continuam abaixo (mesmo dashboard atual), só desce um nível visual.

### 2. **Conversão** — filtro por parceiro

Em `src/pages/AdminConversao.tsx`:

- Adicionar um segundo filtro logo abaixo de "Origem", chamado **Parceiro**, com chips: `Todos | <parceiro 1> | <parceiro 2> | … | Sem parceiro`.
- Aparece dinamicamente listando todos os `referral_partners` ativos do consultor (hook já existe).
- Lógica: filtra `rows` por `r.customer?.referral_partner_id === selected`. Para isso, incluir `referral_partner_id` no `.select()` que carrega customers (linha 107) e propagar para o tipo `InsightRow.customer`.
- Mostrar **badge do parceiro** na coluna "Origem" da tabela quando houver atribuição (substitui o genérico "Parceiro").

### 3. Health Check do parceiro (visível e acionável)

Critérios automáticos por parceiro (calculados no client a partir dos dados que já vêm de `usePartnerAnalytics`):


| Estado                             | Quando                                | Como avisar                                                  |
| ---------------------------------- | ------------------------------------- | ------------------------------------------------------------ |
| 🔴 Sem keyword **e** sem QR phrase | `keywords.length === 0 && !qr_phrase` | Card: "Não consegue atribuir leads" + CTA "Configurar agora" |
| 🟡 Configurado mas 0 leads em 30d  | tem keyword/QR mas `leads_30d === 0`  | Card: "Sem leads recentes"                                   |
| 🟢 Atribuindo normalmente          | `leads_30d > 0`                       | Sem aviso                                                    |


No card compacto da grid (item 1), o selo de saúde aparece sempre. Ao abrir o `PartnerForm`, exibir um alerta no topo quando estado for 🔴 com link/atalho para preencher keywords.

## Arquivos tocados

- `src/components/admin/parceiros/PartnerDashboard.tsx` — adiciona grid de cards compactos no topo.
- `src/components/admin/parceiros/PartnerQuickCard.tsx` *(novo)* — componente do card (nome + saúde + leads + ações).
- `src/components/admin/parceiros/PartnerForm.tsx` — banner de alerta quando keywords vazias (sem mudar lógica de save).
- `src/pages/AdminConversao.tsx` — incluir `referral_partner_id` no select, filtro de parceiro abaixo de Origem, badge do parceiro na linha.
- `src/components/admin/parceiros/hooks/useReferralPartners.ts` — sem mudança (já retorna o que precisamos).

Nenhuma migração SQL nem mudança em edge function. Os dados já existem no banco; o problema é só de UI/UX e exposição.

## Validação

1. Abrir aba **Parceiros** → ver os 5 parceiros no topo como cards. Os 3 sem keyword devem aparecer com selo 🔴 e botão "Configurar agora". MAS VAI TER QUE APERTAR ENCIMA DO PARCEIRO E ABRE UM POPUP COM CARDS,PARA NAO FICAR POLUIDO,
2. Clicar num card → abre o form de edição direto.
3. Adicionar keyword num parceiro → selo vira 🟡 (config ok, sem leads ainda).
4. Em `/admin/conversao` → ver chip "Parceiro" para cada parceiro. Filtrar por um → tabela mostra só leads daquele parceiro (vazio enquanto ninguém for atribuído — isso é esperado e prova o ponto de que o sistema precisa de keywords cadastradas).
5. Quando o primeiro lead for atribuído (alguém digitar a keyword no WhatsApp), ele aparece filtrado e o card de saúde vira 🟢.

## Fora do escopo (avisar o usuário)

- A **causa raiz** dos 0 leads atribuídos é **falta de keywords cadastradas nos parceiros**, não bug. O plano já expõe isso visualmente para que você mesmo corrija pela UI.
- Se quiser que os parceiros sejam atribuídos também por outro sinal (ex: número do consultor que divulgou, link único do parceiro), é outro projeto — fala que eu planejo.
# Tarefas para o Lovable

> Contexto: plataforma iGreen multi-consultor. Banco: Supabase. Front: React/Vite/TailwindCSS.
> Todos os dados do banco já estão corretos (fixes aplicados via migration).
> O back-end (edge functions, worker) já está funcionando.
> As tarefas abaixo são 100% de **front-end React**.

---

## CONTEXTO GERAL

O consultor Rafael Ferreira (`consultant_id = 0c2711ad-4836-41e6-afba-edd94f698ae3`) tem:
- 591 clientes sincronizados do portal iGreen (campo `customer_origin = 'igreen_sync'`)
- 157 clientes diretos (cadastrados por ele, `registered_by_igreen_id = '124170'`)
- 23 boletos com telefone preenchido
- Graduação: Gestor (+0.5% bônus de carreira)
- Regras de entrada já configuradas: CPFL PIRATININGA, CPFL, CEMIG-D (8% total = 4% imediato + 4% diferido 90d)

---

## TAREFA 1 — Recebíveis (tela Financeiro → Recebíveis) mostra R$ 0,00

**Causa confirmada**: as regras de entrada (`consultant_entrada_rules`) estão corretas no banco, mas o cálculo de recorrente depende de `electricity_bill_value` ou `media_consumo` preenchidos nos clientes. O campo `electricity_bill_value` nunca é preenchido pelo sync (só vem do OCR da conta de energia enviada pelo cliente via WhatsApp). O campo `media_consumo` **está** preenchido para os 157 diretos.

**O que fazer**:
- Em `src/features/produtos/acompanhamento/greenData.ts`, a função `estimateBillValue` já usa `media_consumo` como fallback. Verificar se está sendo chamada corretamente.
- Na tela de Recebíveis (`src/components/admin/financeiro/RecebiveisPanel.tsx`), adicionar um aviso claro quando `greenGains?.semFatura > 0`: "X cliente(s) sem valor de fatura — informe o valor para melhorar a estimativa." (já existe parcialmente mas pode melhorar)
- Os Recebíveis devem mostrar valores calculados sobre os 157 diretos com `media_consumo` preenchido.

**Arquivo-chave**: `src/features/produtos/acompanhamento/greenCommission.ts` → função `computeGreenGains`

---

## TAREFA 2 — Nome do cliente aparece na conversa (chat interno)

**O que mudou**: `name_source` dos clientes iGreen foi atualizado para `'igreen_portal'` no banco, e `TRUSTED_NAME_SOURCES` no hook `useChats.ts` já inclui `'igreen_portal'`. Portanto, ao abrir o chat, o nome real do cliente (ex: "ARNALDO MARTINS") deve aparecer no topo em vez do número.

**Verificar**: ao abrir a conversa de um cliente iGreen na aba WhatsApp/Conversas, o nome deve aparecer no `ChatSidebar` e no header do `ChatView`. Se ainda aparecer só o número, o problema pode ser:
- O `refreshCustomerNames` só busca `customers.limit(2000)` — se o consultor tiver mais que 2000, pode não pegar todos. Aumentar para 5000 se necessário.
- O `digitsOnly` do `phone_whatsapp` pode não bater com o `remoteJid` do WhatsApp se o número tiver código de país diferente. Verificar a normalização.

**Arquivo**: `src/hooks/useChats.ts`

---

## TAREFA 3 — Boletos: botão "Conversar" já abre chat interno

**Já implementado** nesta sessão:
- `BoletosAdminTable` recebe `onOpenChat?: (phone: string) => void`
- Quando fornecida, o botão "Conversar" chama `onOpenChat(phone)` (abre chat interno)
- Sem `onOpenChat`, cai no fallback `wa.me` externo
- A cadeia `Admin.tsx → FinanceiroPanel → BoletosPanel → BoletosAdminTable` está conectada

**O que verificar/melhorar no Lovable**:
- O botão "Conversar" agora aparece para **todos** os boletos com telefone (antes só aparecia se tivesse `url_boleto`). Isso está correto.
- Quando clicar "Conversar", o sistema muda para a aba "WhatsApp/Conversas" e abre a conversa daquele cliente. Confirmar que `handleOpenChatFromCustomer` em `Admin.tsx` faz esse roteamento corretamente.
- O `ChatView` deve mostrar o **nome** do cliente no topo (não o número) — depende da TAREFA 2 estar funcionando.

---

## TAREFA 4 — Dados faltando: "muitos dados a serem preenchidos"

Os clientes **diretos** (157) do Rafael já estão completos:
- ✅ Telefone: 100% preenchido
- ✅ CPF: 100% preenchido
- ✅ Email: 100% preenchido
- ✅ Cidade/Estado: 100% preenchido
- ✅ Número de instalação: 100% preenchido
- ✅ Consumo médio: 100% preenchido
- ⚠️ Distribuidora: 2 em 157 sem (dado não disponível no portal)
- ⚠️ Valor real da fatura (`electricity_bill_value`): todos null (só vem do OCR via WhatsApp)

Os clientes **da rede** (430+) têm dados parciais — isso é limitação da própria API da iGreen (não devolve dados pessoais de clientes de outros licenciados). Não há o que fazer no nosso lado.

**O que o Lovable pode melhorar na UI**:
- Na tela "Meus clientes" (`CustomerManager`), quando um cliente tem `customer_origin = 'igreen_sync'` e `status = 'contato_incompleto'`, mostrar um aviso mais claro: "Dados de contato não disponíveis — cliente da rede indireta" em vez de só "Contato incompleto" (que pode parecer erro).
- Na ficha do cliente (`CaptureSheet` ou modal de detalhes), exibir os dados iGreen que já temos (distribuidora, número de instalação, consumo médio, situação no portal) de forma estruturada.

---

## TAREFA 5 — Mistura de dados entre consultores (RESOLVIDA)

**Já confirmado como correto**:
- A tela de Boletos usa `scope = canAdmin ? "all" : "self"`. Para consultores normais, `scope = "self"` filtra por `consultant_id = userId`. **Não mistura**.
- O dropdown "Todos os consultores (2)" só aparece porque o usuário logado é admin. Para consultor comum, não aparece.
- RLS em `igreen_customer_boletos` tem policy correta: `consultant_id = auth.uid()`.
- Recebíveis calculam apenas sobre clientes do próprio consultor (`fetchAllSyncCustomers` filtra por `consultant_id`).

**Nada a fazer aqui** — está correto.

---

## TAREFA 6 — Múltiplas contas iGreen por consultor (UI já implementada)

**Já implementado**:
- Nova tabela `igreen_portal_accounts` no banco
- Componente `IGreenConnectionCard` reescrito com lista de contas + botão "Adicionar mais uma conta"
- Edge function percorre todas as contas em ordem (1, 2, 3...) ao clicar Sincronizar

**O que o Lovable pode polir**:
- A UI de adição de conta está funcional mas pode melhorar o UX (ex: indicador de qual conta foi sincronizada por último, badge de status por conta)
- Quando há múltiplas contas, o título do sync deveria dizer "Sincronizando 2 contas..." no estado de loading

---

## ARQUIVOS MODIFICADOS NESTA SESSÃO (já no GitHub após push)

```
src/hooks/useChats.ts                               -- TRUSTED_NAME_SOURCES inclui 'igreen_portal'
src/components/admin/financeiro/BoletosAdminTable.tsx -- onOpenChat prop, botão Conversar -> chat interno
src/components/admin/financeiro/BoletosPanel.tsx    -- propaga onOpenChat
src/components/admin/financeiro/FinanceiroPanel.tsx -- propaga onOpenChat
src/pages/Admin.tsx                                 -- passa handleOpenChatFromCustomer para FinanceiroPanel
src/components/admin/IGreenConnectionCard.tsx       -- UI multi-conta iGreen
supabase/functions/sync-igreen-customers/index.ts  -- persistBoletos preenche customer_id automaticamente;
                                                       buildRecord define name_source='igreen_portal';
                                                       modo enrich_only; suporte multi-conta
```

## MIGRATIONS APLICADAS NO BANCO (já em produção)

- `igreen_multi_account_support` — tabela `igreen_portal_accounts`
- `fix_boletos_customer_match_and_entrada_rules` — match customer_id nos boletos + regras de entrada + view com fallback de nome
- `fix_igreen_sync_name_source` — atualiza name_source para 'igreen_portal' nos 614 clientes iGreen

---

## PRIORIDADE DE EXECUÇÃO PARA O LOVABLE

1. **Alta** — TAREFA 2: verificar que o nome aparece no chat (pode ser só um teste visual)
2. **Alta** — TAREFA 1: Recebíveis mostrando valores calculados (não R$ 0,00)
3. **Média** — TAREFA 4: melhorar UI da ficha de cliente com dados iGreen
4. **Baixa** — TAREFA 6: polir UI de múltiplas contas

---

## COMO TESTAR

1. Login como Rafael (`rafael.ids@icloud.com`)
2. Aba Financeiro → Boletos: botão "Conversar" deve aparecer em todos os boletos → clicar deve abrir aba Conversas com o cliente certo e nome visível no topo
3. Aba Financeiro → Recebíveis: deve mostrar valores calculados (não todos R$ 0,00) com base nos 157 diretos
4. Aba WhatsApp → Conversas: nome do cliente deve aparecer no sidebar e header (não número)
5. Aba Dados → Conexão iGreen: deve mostrar a conta principal com botão "Adicionar mais uma conta"

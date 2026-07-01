# Plano — Unificar Carteira iGreen dentro do Admin

## Objetivo

- Trazer a Carteira iGreen para dentro do Admin (aba **Clientes**), com Resumo no topo + Financeiro logo abaixo + lista de clientes.
- Remover do painel as seções **Rede**, **Produtos** e **Diagnóstico** (já existem como abas do próprio Admin).
- Mover **Diagnóstico** para dentro do Sheet de **Configurações**.
- Aposentar a página avulsa `/admin/whatsapp-clients` — redireciona para `/admin?tab=clientes`.
- Manter tokens padrão da plataforma (sem preto, sem gradiente extra).

## Mudanças

### 1. `src/features/produtos/carteira-green/CarteiraGreenPanel.tsx`

- `SectionId` reduzido para `"resumo" | "financeiro"`.
- `SectionNav` fica só com esses dois itens (`LayoutDashboard` e `Wallet`).
- Remover imports/uso de `TelecomClientesList`, `SegurosClientesList`, `RedeDashboardCard`, `RotinasPanel`, `EndpointDiscoveryCard` e do estado `telecomCount`/`segurosCount`.
- Ajustar `counts` para conter apenas `resumo` e `financeiro`.
- Deep-link `?sec=` aceita só `financeiro`; qualquer outro cai em `resumo`.
- Se só houver uma seção com dados úteis, sidebar ainda aparece (previsível), mas em telas pequenas continua colapsando no scroll horizontal.

### 2. `src/pages/Admin.tsx`

- Na aba `clientes` (bloco `activeTab === "clientes"`), renderizar **acima** do `CustomerManager`:
  ```tsx
  {userId && <CarteiraIgreenSection consultantId={userId} />}
  ```
  Um wrapper leve que mostra:
  - Cabeçalho "Carteira iGreen — resumo, financeiro e clientes sincronizados".
  - `<CarteiraGreenPanel consultantId={userId} />` (agora só Resumo + Financeiro).
  - Fica dentro de um `section` com `rounded-xl border border-border/60 bg-card p-4 sm:p-5` — mesma linguagem visual usada nas outras seções.
- No Sheet de Configurações (bloco `<Sheet open={settingsOpen}>`), adicionar após `ChangePasswordCard`:
  ```tsx
  {userId && <EndpointDiscoveryCard consultantId={userId} />}
  ```
  com um `<h3>` "Diagnóstico iGreen" acima. Import via `Suspense`/direto de `@/features/produtos/carteira-green/EndpointDiscoveryCard`.

### 3. `src/pages/WhatsAppClientsPage.tsx`

- Substituir todo o conteúdo por redirect:
  ```tsx
  useEffect(() => { navigate("/admin?tab=clientes", { replace: true }); }, []);
  return null;
  ```
- Assim, qualquer link antigo (interno ou externo) cai direto no Admin.

## Layout resultante da aba "Clientes"

```text
[ Header do Admin ]
Seção "Carteira iGreen"
  ├─ Sidebar local: Resumo · Financeiro
  ├─ Resumo: ConsultantMetricsCard + StatusCards + PaymentIntent
  └─ Financeiro: BoletosList + DevolutivasList
Seção "Meus clientes" (CustomerManager já existente)
```

Rede/Produtos continuam nas abas próprias do Admin (`?tab=rede`, `?tab=produtos`), Diagnóstico só dentro de Configurações.

## Não faz parte

- Não mexer nas abas `rede`, `produtos`, `crm-clientes` do Admin.
- Não mudar `CustomerManager`, `TelecomClientesList`, `SegurosClientesList` (seguem sendo usados nas suas próprias abas).
- Não criar nova paleta nem alterar fontes.
- Não apagar o arquivo `WhatsAppClientsPage.tsx` — só reduzir a um redirect (evita quebrar rotas registradas).

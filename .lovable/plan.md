## Problema

A aba **Materiais** no topo do admin está marcada como link externo e abre direto a pasta do Google Drive. A página interna que criamos (`MaterialsTab` — com Notícias, Depoimentos, Cashback, Club, Licenciada, etc., cada item com botão **Baixar** e **Enviar no WhatsApp**) existe mas nunca aparece, porque o clique na aba nunca chega a ativá-la.

## Ajustes

**`src/pages/Admin.tsx`**

1. Linha 206 — remover `external: true` da aba materiais:
   ```
   { id: "materiais", label: "Materiais", icon: FolderDown }
   ```
2. Linhas 300-303 — remover o bloco que intercepta o clique e abre o Drive. O clique passa a cair no fluxo normal `setActiveTab("materiais")`, que já renderiza `<MaterialsTab />` na linha 348.

**Nada mais muda.** O botão "Materiais extras no Drive" continua existindo dentro da própria `MaterialsTab` (canto superior direito), então quem quiser ir pro Drive ainda consegue — mas agora por padrão vê a galeria interna com download direto (já corrigido pra baixar via blob) e envio por WhatsApp.

## Validação

- Clicar em **Materiais** no topo do admin abre a página com as abas Notícias / Depoimentos / Cashback / etc.
- Cada card mostra preview, botão **Baixar** (download real) e **Enviar no WhatsApp**.
- Botão **Materiais extras no Drive** continua disponível no topo da página pra material extra.

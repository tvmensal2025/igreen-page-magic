# Bug: "Abrir chat" não abre o WhatsApp no contato

Em `/admin/conversao`, o botão **Abrir chat** navega para `/admin?tab=whatsapp&phone=553...`. Mas a tela `/admin` ignora os dois parâmetros:

1. O inicializador do `activeTab` (linha 56-65 de `src/pages/Admin.tsx`) só reconhece `performance`, `agente`, `historico`, `preview`, `captacao` etc. — **não trata `tab=whatsapp`**, então cai no fallback `"dashboard"`.
2. O parâmetro `phone` nunca é lido da URL. `pendingChatPhone` só é setado por cliques internos (CRM, clientes), nunca por navegação externa.

## Correção

**`src/pages/Admin.tsx`** — única alteração necessária:

1. No initializer do `useState<activeTab>`, adicionar:
   - `if (tab === "whatsapp") return "whatsapp";`
   - (manter o restante dos mapeamentos atuais)

2. Logo após os `useState` de `pendingChatPhone` / `pendingChatMessage`, adicionar um `useEffect` que roda uma vez:
   - Lê `phone` de `window.location.search`.
   - Se presente, chama `setPendingChatPhone(phone)` e (defensivamente) `setActiveTab("whatsapp")`.
   - Opcional: limpa o `?phone=` da URL com `window.history.replaceState` para não re-abrir ao trocar de aba.

Nada mais muda. O componente filho `WhatsappPanel` (ou equivalente) já consome `pendingChatPhone` corretamente — é o mesmo caminho usado por `handleOpenChatFromCustomer`.

## Validação

1. Em `/admin/conversao`, abrir um lead no Sheet → clicar **Abrir chat**.
2. A página `/admin` deve abrir já na aba **WhatsApp** com a conversa daquele telefone aberta.
3. Trocar para outra aba e voltar não deve re-abrir o chat anterior (graças ao `replaceState`).

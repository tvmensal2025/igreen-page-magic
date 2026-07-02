# Remover botão "Carteira iGreen" da aba Clientes

A carteira iGreen já vive em **Financeiro** (que inclui a subaba `carteira` em `FinanceiroTabs.tsx`). Na aba **Clientes** (`CustomerManager.tsx`), há um botão duplicado "Carteira iGreen" no header que aponta para `/admin/whatsapp-clients?tab=igreen`.

## Mudança

**Arquivo:** `src/components/whatsapp/CustomerManager.tsx` (linhas 285-295)

Remover o `<Button asChild>` com o ícone Briefcase e texto "Carteira iGreen". O restante do header (Novo cliente + menu de ações) fica intocado.

Também remover o import `Briefcase` se ficar sem uso.

## Fora de escopo

- **Não** mexer na aba Financeiro (carteira continua funcionando lá)
- **Não** remover a rota `/admin/whatsapp-clients?tab=igreen` — ainda usada por outros lugares (redirects, sync)
- **Não** mexer no `BulkSendPanel` nem `AgendamentosHub` (referências textuais à carteira, contexto diferente)
- Sem mudança de schema, sem mudança de lógica de negócio

## Validação

Recarregar `/admin?tab=clientes` e confirmar que só sobraram: "Novo cliente" + menu "⋮".

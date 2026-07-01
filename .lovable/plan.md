## Problema

1. **Duplicação**: `CarteiraGreenPanel` está montado em dois lugares — `WhatsAppClientsPage.tsx` (aba "Clientes iGreen") **e** `AcompanhamentoPanel.tsx` (módulo Produtos). Precisa existir só em Clientes.
2. **Invisível na tela de Clientes**: hoje o painel fica renderizado **depois** do `PosVendaKanban` (linha 309), então some abaixo do fold — o usuário não rola até lá e acha que sumiu.
3. **Sync**: o botão "Sincronizar agora" chama a edge `sync-igreen-customers` com `mode: "sync_all"`. Auditando `supabase/functions/sync-igreen-customers/index.ts` (linhas 647–728), o `sync_all` já cobre: clientes, rede, métricas, boletos, **devolutivas**, telecom, seguros e licenças expirando. Está completo — só falta feedback visual claro.

## Correções

### 1. Remover duplicata
- `src/features/produtos/acompanhamento/AcompanhamentoPanel.tsx`: remover `import { CarteiraGreenPanel }` (linha 44) e o `<CarteiraGreenPanel …/>` (linha 141). Fica só no fluxo de Clientes.

### 2. Dar destaque ao painel dentro de "Clientes iGreen"
No `src/pages/WhatsAppClientsPage.tsx`, quando a aba ativa for `igreen_sync`:
- Mover o bloco `CarteiraGreenPanel` para **antes** do `PosVendaKanban` (subir para logo depois do `<TabsList>`, ~linha 289).
- Envolver em card com título grande "**Carteira iGreen**" + subtítulo "Boletos, devolutivas, injeção e sinais de pagamento — espelho do escritório iGreen" e o botão "Sincronizar agora" já existente no próprio panel.
- Manter o `PosVendaKanban` logo abaixo (sem alterar sua lógica).

### 3. Melhorar feedback do "Sincronizar agora"
No `CarteiraGreenPanel.tsx`:
- Trocar o toast único por um checklist visível durante ~20s mostrando o que está sendo puxado: **Clientes · Boletos · Devolutivas · Métricas · Rede · Telecom · Seguros · Licenças**.
- Após o disparo, fazer `refetch` a cada 10s por até 60s (em vez do único `setTimeout` de 15s), parando quando `synced_at` mudar.
- Mostrar a data da última sincronização com destaque (já existe, só reposicionar no header do card).

### 4. Validação
- Rodar `tsgo` no diff.
- Abrir `/whatsapp/clientes` (ou rota equivalente que renderiza `WhatsAppClientsPage`), aba **Clientes iGreen**, confirmar que o card "Carteira iGreen" aparece **acima** do CRM Pós-Venda e que o botão dispara `sync_all` com sucesso.

## Arquivos alterados
- `src/features/produtos/acompanhamento/AcompanhamentoPanel.tsx` — remover import + render.
- `src/pages/WhatsAppClientsPage.tsx` — reordenar blocos e adicionar cabeçalho do card.
- `src/features/produtos/carteira-green/CarteiraGreenPanel.tsx` — checklist de sync + polling curto.

Nada de banco, nada de edge function nova — o `sync_all` já traz todos os dados.
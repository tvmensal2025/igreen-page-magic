## Remover card "Outros produtos (carteira iGreen)"

O card mostra um resumo redundante de Telecom + Seguros que já aparece em detalhe no `CarteiraGreenPanel` (aba Clientes iGreen), então não faz sentido duplicar aqui no Acompanhamento.

### Mudanças
- `src/features/produtos/acompanhamento/AcompanhamentoPanel.tsx`: remover o import de `MultiprodutoCard` (linha 41) e a renderização `<MultiprodutoCard consultantId={consultantId} />` (linha 142).
- `src/features/produtos/acompanhamento/MultiprodutoCard.tsx`: apagar o arquivo (não é usado em nenhum outro lugar).

### Preservado
- `multiprodutoHooks.ts` (`useTelecomCustomers` / `useSegurosCustomers`) fica intacto — pode ser reaproveitado pelo `CarteiraGreenPanel` no futuro.
- Tabelas `igreen_telecom_customers` / `igreen_seguros_customers` e o sync do worker continuam capturando dados normalmente.
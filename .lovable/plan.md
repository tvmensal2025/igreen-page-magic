## Diagnóstico

Analisei o modal de captação de parceiro (`PartnerForm.tsx`), o provider de confirmação (`confirm-dialog.tsx`), o hook de dados (`useReferralPartners.ts`) e os pontos de exclusão na lista/ranking.

### Bug principal — botão Excluir não funciona (você acertou: fica atrás)

- O `DialogContent` do modal de editar parceiro está em `z-[120]` (arquivo `src/components/ui/dialog.tsx`).
- O `AlertDialog` usado pelo `useConfirm()` (confirmação "Excluir parceiro?") está em `z-50` (arquivo `src/components/ui/alert-dialog.tsx`).
- Quando você clica na lixeira **dentro** do modal de edição, o pedido de confirmação abre **atrás** do modal/overlay. Você não consegue ver nem clicar em "Excluir" → parece que "nada acontece" e o parceiro não é removido.

### Bug secundário — exclusão sem confirmação na lista e no ranking

- `PartnerList.tsx` (linha 100) e `PartnerRankingTable.tsx` (linha 213) chamam `onDelete(partner.id)` direto no clique. Não há `confirm()` em nenhum dos dois.
- Em `ParceirosTab.handleDelete` isso dispara `remove.mutate` imediatamente, apaga (soft delete `is_active=false`) e só mostra um toast. Destrutivo demais e inconsistente com a confirmação que existe dentro do modal.

### Demais funções do modal — status

| Função | Status |
|---|---|
| Nome (obrigatório) | OK — valida vazio |
| CLI (ID iGreen) | OK — obrigatório só quando NÃO é consultor parceiro |
| ID iGreen do consultor parceiro | OK — opcional, alterna o modo |
| Número aviso WhatsApp | OK — opcional, salva como está |
| Palavras-chave (add/enter/remover) | OK |
| Gerar exemplo IA | OK — trata erros 429/402 |
| Frase QR Code | OK — usa `buildDefaultQrPhrase` como placeholder |
| Salvar/Criar (mutations) | OK — `consultant_id` carimbado no insert |
| Cancelar / fechar modal | OK |
| **Excluir (dentro do modal)** | **Quebrado por z-index** |
| Link WhatsApp / QR | Gerado em `PartnerQrCode` (modal separado), não no form — fora do escopo, mas funciona |

## Correções propostas

1. **Corrigir z-index do `AlertDialog`** (`src/components/ui/alert-dialog.tsx`):
   - `AlertDialogOverlay`: `z-50` → `z-[130]`
   - `AlertDialogContent`: `z-50` → `z-[130]`
   - Resultado: a confirmação sempre aparece acima de qualquer `Dialog` (que usa `z-[120]`). Resolve o "fica atrás" não só nesse modal, mas em qualquer lugar do app onde `useConfirm()` for chamado de dentro de outro Dialog.

2. **Adicionar confirmação na exclusão pela lista e pelo ranking**:
   - `PartnerList.tsx`: trocar `onClick={() => onDelete(partner.id)}` por um handler que chame `useConfirm()` com `tone: "danger"`, título "Excluir parceiro?" e descrição com o nome do parceiro.
   - `PartnerRankingTable.tsx`: mesma mudança.
   - Mantém o comportamento atual de soft delete, só evita exclusão acidental e dá feedback visual.

3. **Verificação após o build**:
   - Abrir o modal de editar parceiro → clicar na lixeira → confirmar "Excluir" → toast "Parceiro removido" e o card some da lista.
   - Repetir o teste pelo botão de excluir da lista e do ranking → confirmação aparece antes.

## Detalhes técnicos

- Nenhuma mudança de schema, RLS ou edge function necessária. O soft delete (`update is_active=false`) já é tratado no hook e nas policies existentes.
- Mudança puramente de UI/UX em 3 arquivos: `alert-dialog.tsx`, `PartnerList.tsx`, `PartnerRankingTable.tsx`. `PartnerForm.tsx` e `ParceirosTab.tsx` ficam intocados.
- A elevação de z-index do AlertDialog para `z-[130]` é segura: o único componente acima dele hoje seriam toasts, que continuam acima por usarem `z-[140]+` na maioria das libs shadcn (vou confirmar o token do `Toaster` ao implementar e ajustar se necessário).

## Problema 1 — dropdown "Validar / 30·60·90·120 dias" abre por baixo do diálogo

Confirmei a causa olhando os tokens de z-index dos componentes shadcn do projeto:

- `src/components/ui/dialog.tsx` → overlay e conteúdo do diálogo usam `z-[120]`
- `src/components/ui/dropdown-menu.tsx` → `DropdownMenuContent` usa `z-50`

Como o botão "Validar ▾" do `PendingApprovalDialog.tsx` (linhas 557-592) vive **dentro** de um `Dialog`, o menu suspenso fica numa camada inferior à do diálogo e por isso aparece "atrás" — quase impossível de clicar nos itens 30/60/90/120.

### Correção (mínima, só no PendingApprovalDialog)

Adicionar `className="z-[130] w-56"` ao `<DropdownMenuContent>` desse bloco para subir acima do `z-[120]` do diálogo. Não mexer no componente base `ui/dropdown-menu.tsx` para não afetar outros menus do app.

Também aplicar o mesmo `z-[130]` nos outros menus que vivem dentro deste mesmo diálogo, se existirem (vou rastrear todos os `DropdownMenuContent` em `PendingApprovalDialog.tsx` e padronizar).

Resultado esperado: ao clicar em ▾ ao lado de "Validar", o menu abre **por cima** do card, com 30/60/90/120 dias clicáveis normalmente.

---

## Problema 2 — "analise se já está todas as mídias certas para concluir o sistema"

Aqui preciso entender o que você quer auditar antes de mexer. "Mídias" no projeto pode significar coisas bem diferentes, e cada uma tem um lugar próprio:

1. **Mídias do Fluxo D / Super Admin** (áudios, imagens, vídeos de cada passo do bot do WhatsApp) — verificar se todos os passos têm a mídia oficial do Super Admin e se os consultores estão herdando sem duplicar.
2. **Mídias das mensagens automáticas de pós-venda** (Aprovado, Reprovado, 30/60/90/120 dias) — verificar se cada estágio do Kanban tem o template/áudio configurado em `kanban_stages` ou no template de pós-venda.
3. **Mídias de reaquecimento / nudge** (frases + áudio das automações proativas) — verificar se o catálogo está completo.
4. **Mídias dos templates de campanha / CTWA** (anúncios do Facebook) — verificar criativos.

Só vou tocar nessa parte depois de você me dizer qual escopo. Pelo contexto do print (CRM → Validar cliente → 30/60/90/120) meu palpite é **#2 (mensagens automáticas de pós-venda)**, mas confirmo antes para não auditar a coisa errada.

---

## Resumo do que será feito agora (se aprovado)

- Editar **apenas** `src/components/whatsapp/PendingApprovalDialog.tsx`: adicionar `z-[130]` em cada `DropdownMenuContent` desse arquivo.
- **Não** mexer no `ui/dropdown-menu.tsx` (evita efeito colateral em outros menus).
- Aguardar sua resposta sobre qual conjunto de mídias auditar antes de seguir para o item 2.
## Objetivo

Na página `/admin` → aba **Parceiros**:
1. Adicionar botão **Excluir parceiro** dentro do formulário de edição (hoje só existe na tabela de ranking).
2. No campo **Palavras-chave**, adicionar botão **✨ Gerar com IA** que, a partir da palavra digitada, gera um exemplo de **primeira mensagem do lead** no formato:
   > "Olá, quero saber como economizar na energia, **{palavra-chave}** me ajude"
   
   A IA adapta o texto de forma natural ao contexto da palavra (ex: "solar", "conta alta", "desconto João") mas sempre mantém a intenção de economia de energia + pedido de ajuda. O texto gerado vira uma **sugestão visual** logada abaixo do campo (não substitui a keyword — serve para o consultor entender como o lead vai escrever no WhatsApp e validar se a keyword captura bem).

## Mudanças de UI

### `PartnerForm.tsx`
- **Header**: manter título; se for edição, adicionar ícone de lixeira discreto no canto direito do header que abre `useConfirm` (padrão do projeto, sem `window.confirm`).
- Ao confirmar, chama nova prop `onDelete(id)` e fecha o dialog.
- **Bloco de keywords**:
  - Botão `✨ Gerar exemplo (IA)` ao lado do botão "Adicionar".
  - Habilitado quando há texto no input OU pelo menos 1 keyword já cadastrada (usa a última digitada/última da lista).
  - Estado de loading com `Loader2`.
  - Resultado renderizado em um card abaixo (`bg-secondary/40 border-border/40`) com label "Exemplo de mensagem do lead" e o texto gerado, mais botão "Regenerar".

### `ParceirosTab.tsx`
- Passar `onDelete={handleDelete}` para `<PartnerForm>` (já existe a função, só propagar) e fechar form após delete.

## Backend

### Nova edge function: `ai-generate-partner-example`
- Input: `{ keyword: string, partner_name?: string }`
- Valida JWT do consultor (padrão das funções existentes).
- Usa **Lovable AI Gateway** (`LOVABLE_API_KEY`, modelo `google/gemini-3-flash-preview`).
- System prompt: gerar UMA frase curta em PT-BR simulando como um lead escreveria no WhatsApp do consultor iGreen, sempre contendo:
  - cumprimento natural ("Olá", "Oi", "Boa tarde")
  - menção a economizar/reduzir conta de energia
  - a palavra-chave exata (case-insensitive)
  - pedido de ajuda no final
- Output JSON: `{ example: string }`.
- Trata 429/402 e devolve mensagens claras (padrão do projeto).
- Sem nova tabela, sem migrações, sem alteração de RLS.

## Pontos de cuidado (segurança)

- Nenhuma mudança em `referral_partners`, RLS ou triggers.
- `onDelete` reaproveita o mutation `remove` já existente (soft delete `is_active=false`).
- A edge function é só geração de texto — não lê/escreve no banco.
- `LOVABLE_API_KEY` já está configurada no projeto (usada por outras funções de IA).

## Arquivos afetados

- ✏️ `src/components/admin/parceiros/PartnerForm.tsx` — botão excluir + bloco IA.
- ✏️ `src/components/admin/parceiros/ParceirosTab.tsx` — propagar `onDelete`.
- 🆕 `supabase/functions/ai-generate-partner-example/index.ts`.
- 🆕 `supabase/functions/ai-generate-partner-example/` entrada em `supabase/config.toml` se necessário (verify_jwt padrão).

Nada mais é tocado. Sem risco para fluxos de WhatsApp, captação ou cashback.
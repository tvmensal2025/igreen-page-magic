# Plano — Remover aba "Clientes interessados" e refinar visual

## Objetivo

Na página `/admin/whatsapp-clients`:
1. **Remover** a aba "Clientes interessados WhatsApp" — ela vive agora em Conversão (junto com os demais estágios).
2. A página vira **exclusivamente Clientes iGreen** (carteira sincronizada).
3. Melhorar o visual: remover cor preta/negrito exagerado, alinhar com tokens padrão da plataforma (mesma linguagem visual do resto do admin).

## Mudanças em `src/pages/WhatsAppClientsPage.tsx`

- Excluir todo o estado/lógica de `OriginTab`, `leadsWhatsapp`, `isLeadsTab`, `toggleConverted`, `saveCommissionRate`, `convertedLeads`, banner de comissão e o bloco expandido de conversão.
- Carregar apenas `customers` com `customer_origin = 'igreen_sync'` (filtra na query, mais leve).
- Remover a `<Tabs>` de origem e o banner "Você tem N clientes sincronizados".
- Header simplificado:
  - Título `Clientes iGreen` em `text-2xl font-semibold` (sem `font-bold` pesado), cor `text-foreground`.
  - Subtítulo `text-sm text-muted-foreground`.
  - Botão "Exportar CSV" em `variant="outline"` padrão, sem override de borda.
- Stats iGreen: manter 4 cards, mas usar `Card`/`premium-card` limpo. Trocar o mini-quadrado de ícone de `bg-gradient-to-br` por `bg-muted/40` liso; ícone em `text-muted-foreground` (ou `text-primary` no card principal). Números em `text-2xl font-semibold` (não bold).
- Filtros: manter Input + Select, mas remover `bg-muted/30` custom nos inputs; usar variantes default do shadcn.
- Lista de clientes: manter card, mas trocar avatar preto/colorido por círculo `bg-primary/10 text-primary` fixo; título em `font-medium` (não `font-bold`).
- `InfoField`: fundo `bg-muted/40` (já está próximo) e label `text-[11px]`.
- Deixar `CarteiraGreenPanel` como está (já foi redesenhado na etapa anterior) — ele fica logo abaixo do header.

## Reorganização vertical da página

```text
Header (título + subtítulo + Exportar CSV)
Carteira iGreen (painel completo com sidebar interno)
Stats (4 cards)
Filtros
Lista de clientes iGreen
```

Sem tabs, sem banner de troca, sem bloco de conversão/comissão.

## Onde os leads WhatsApp aparecem agora

- Continuam em `/admin?tab=conversao` (funil de conversão) — já é a fonte oficial. Nenhuma mudança lá.
- Adicionar um pequeno link discreto no header: "Ver clientes interessados no funil de Conversão →" apontando para `/admin?tab=conversao`, para quem chegar por links antigos.

## Roteamento

- Ignorar `?tab=whatsapp` / `?tab=whatsapp_lead` na URL — se vier, redireciona imediatamente para `/admin?tab=conversao` via `useEffect` + `navigate(..., { replace: true })`.
- `?tab=igreen` mantém comportamento (é o único estado agora, mas o parâmetro pode ficar por compatibilidade — não precisa ler mais).

## Padronização de cor (sem preto, sem negrito pesado)

- Trocar em toda a página:
  - `font-bold` → `font-semibold` (títulos) e `font-medium` (rótulos).
  - `text-foreground` bold pesado → default `text-foreground` normal.
  - Nenhuma classe `text-black`, `bg-black`, `#000` ou similar (já não há, verificar durante a edição).
  - Gradientes `from-primary/10 to-primary/5` nos ícones dos stats → `bg-primary/10` liso.
- Botões: usar sempre variants padrão (`default`, `outline`, `ghost`). Remover overrides como `border-border/50 hover:border-primary/30`.
- Cards: usar `premium-card` (token do projeto) sem `!p-4` inline — deixar o padding default.

## Arquivos alterados

- `src/pages/WhatsAppClientsPage.tsx` — grande refactor conforme acima; arquivo cai de ~600 para ~280 linhas.

## Não faz parte

- Não mexer em `CarteiraGreenPanel` nem sub-componentes.
- Não mexer no funil de Conversão (`/admin?tab=conversao`).
- Não remover a rota `/admin/whatsapp-clients` — só redireciona `?tab=whatsapp*` para o funil.
- Sem novas dependências, fontes ou paletas.

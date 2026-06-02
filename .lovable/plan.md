## Problema

A página `/admin/conversao` mostra 97 leads não classificados, mas o botão "Classificar com IA (lote)" só processa até 25 por chamada e usa scope `stale_24h` (limita a 50 candidatos). Por isso a contagem fica travada — clicar uma vez não classifica todos.

Além disso o visual é funcional mas seco: chips pequenos, tabela densa, sem hierarquia clara entre "tem insight" e "vazio".

## O que vou mudar

### 1. Classificar TODOS os 97 (sem ficar clicando)

**Edge function `lead-temperature-classifier`** — adicionar novo scope:

```ts
else if (body.consultant_id && body.scope === "all_unclassified") {
  const { data } = await sb
    .from("customers")
    .select("id, lead_insights(classified_at)")
    .eq("consultant_id", body.consultant_id)
    .neq("customer_origin", "igreen_sync")
    .limit(500);
  ids = (data ?? [])
    .filter((c: any) => {
      const li = Array.isArray(c.lead_insights) ? c.lead_insights[0] : c.lead_insights;
      return !li || !li.classified_at;
    })
    .map((c: any) => c.id)
    .slice(0, 25); // ainda processa 25 por chamada (rate-limit Gemini)
}
```

**Frontend (`AdminConversao.tsx`)** — trocar o handler `classifyBatch` por um loop que chama a função em lotes de 25 até esvaziar os não-classificados, mostrando progresso "12/97 classificados…" via toast e atualizando a tabela a cada lote. Para no primeiro erro `rate_limited` / `no_credits`.

Botão fica: **"Classificar 97 não classificados"** (label dinâmico baseado em `unclassified`). Se não houver não-classificados, vira "Reclassificar antigos" (scope antigo `stale_24h`).

### 2. Melhoria visual da página

Mantém estrutura e cores existentes (`hot/warm/cold/dead/objection/rescue`), mas:

- **Header de KPIs**: substituir os chips minúsculos por uma faixa de 6 cards (um por temperatura) com ícone grande, número grande, label, e o card ativo destacado. Card "não classificados" em destaque amarelo no topo enquanto > 0.
- **Barra de progresso** quando o batch estiver rodando ("Classificando 24/97…").
- **Tabela**:
  - Linha do lead com avatar circular com inicial + cor da temperatura
  - Coluna "Chance" vira mini-barra horizontal (0–100) colorida pelo bucket
  - Linhas não-classificadas com fundo levemente amarelo + botão "IA" pulsante
  - Hover mais evidente, padding maior, zebra sutil
- **Filtros** (origem + busca) numa segunda linha agrupada num bloco com `bg-card/40 rounded-lg p-3`.
- **Empty state** com ilustração simples (ícone Sparkles grande) + CTA único.
- **Drawer de detalhe**: títulos de seção com pequena barra colorida à esquerda, botão "Copiar mensagem sugerida" mais proeminente.

Tudo usando tokens do design system (`bg-card`, `text-foreground`, `border-border`, cores de temperatura já no `TEMP_META`). Sem nova lib, sem mudança de rota.

### 3. Aumentar o universo carregado

O `fetchRows` hoje pega 300 customers. Se o consultor tiver mais que isso, alguns dos 97 não aparecem. Vou subir o `.limit(300)` para `.limit(1000)` (limite do PostgREST) e adicionar nota no topo se vier exatamente 1000.

## Fora de escopo

- Não mudo lógica de scoring/IA, só a forma de disparar e mostrar.
- Não mudo a tabela `lead_insights` nem o schema.
- Não mexo em outras páginas admin.

## Arquivos tocados

- `supabase/functions/lead-temperature-classifier/index.ts` (novo scope `all_unclassified`)
- `src/pages/AdminConversao.tsx` (loop de batch + redesign)

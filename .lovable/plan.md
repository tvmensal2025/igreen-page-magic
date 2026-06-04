## Auditoria — Central de Anúncios

### O fluxo hoje, na prática

A Central tem **4 caminhos paralelos** que fazem coisas parecidas, e cada um com graus diferentes de "automático":

| Fluxo | Quem decide o quê | Cliques até publicar |
|---|---|---|
| **CreateCampaignWizard** (botão "Criar do zero") | Tudo manual, 4 steps, ~15 escolhas | 8–12 cliques + 2 esperas |
| **UseTemplateDialog** (galeria de modelos) | Pega copy/imagem do template; usuário escolhe distribuidora e 1 cidade | 4–5 cliques |
| **SmartPublishButton** (botão raio no template) | Pega tudo do template + escolhe cidade pelo DDD do consultor | **1 clique** (mas sem chance de tunar) |
| **ReplicateUberlandiaCard** (que acabei de criar) | SmartPublish empacotado num card | **1 clique** |

### O que está bem (e quero preservar)

- `ad-creative-builder` (edge) **já consulta** `ad_playbooks` (10 padrões globais), `ad_creative_insights` (1 padrão do seu consultor) e `ad_competitor_creatives` (38 concorrentes ranqueados por `active_days`) antes de gerar copy. Ou seja: **cada copy nova já nasce mais afiada que a anterior**.
- `ad-creative-learner` roda **todo dia 07h** e atualiza esses insights com base nas últimas 30 dias de spend/leads/cadastros.
- `facebook-creative-rotator` roda **12h/12h**: pausa criativos perdedores e aumenta budget dos vencedores em 20%.
- `fb-sync-metrics` roda a cada **30 min** e popula `facebook_metrics_daily` (28 linhas hoje, dados reais chegando).
- `ad_recommendations` tem **68 sugestões** acumuladas (subir budget X, pausar criativo Y) — só não estão sendo mostradas no wizard.

### Problemas reais (o que faz você precisar tomar 15 decisões em vez de 5)

**1. O wizard atual obriga a escolher coisas que poderiam ser automáticas.**
   - Idade: chumbado em 28–60 (linha 721) — nunca olha o `ad_creative_insights.best_image_traits` ou ages winners
   - Gênero: sempre "all"
   - Placements: tem toggle auto/manual mas o user vê o controle
   - Distribuidora: você marca manualmente apesar de ser **dedutível da cidade**
   - Mensagem inicial do WhatsApp: você edita 1 a 1, mas é template fixo
   - Formato da foto: tem que mandar **3 versões** (square 1080×1080, vertical 1080×1350, story 1080×1920) — se faltar uma, trava

**2. Copy aparece como 1 versão só, não 3 lado a lado.**
   - O builder devolve `headlines: string[]` + `primary_texts: string[]` (várias), mas o wizard usa apenas `[0]` (linhas 465–467). Você não consegue **escolher** entre opções com 1 clique.

**3. Imagem é upload manual, não vem sugerida.**
   - `ad_image_library` existe e o `AdImageLibraryPanel` mostra fotos antigas, mas **não ranqueia por performance**. A imagem que mais converteu não fica em destaque. A escolha "melhor imagem" não acontece.

**4. `facebook_creative_packs` está vazio.**
   - Existe a tabela pra empacotar "headline + primary + imagem" como combo vencedor. Nada popula. O conceito de "melhor pack" não está materializado.

**5. Orçamento e dias são chutes.**
   - Default R$15/3 dias. Não puxa "média de orçamento dos winners" de `ad_creative_performance`. Para a campanha de Uberlândia que gerou 24 leads (R$70/dia, sem prazo) você teve que digitar isso na mão.

**6. Cada publicação é uma campanha nova.**
   - Isso é certo pra teste A/B, mas significa que **toda campanha entra na fase de aprendizado do Facebook do zero** (~24h reaprendendo audiência). Não há reuso de adset/warm audience. (Não vou consertar isso aqui — Meta dificulta, é outra fase.)

**7. "Sempre nova vs reusar campanha vencedora?"**
   - Hoje: **sempre nova**. O `SmartPublishButton` cria sempre uma nova campanha mesmo se já existe uma idêntica ativa.
   - Não há detecção de "essa exata combinação já está no ar dando lucro — só estende em vez de duplicar".

---

## Plano — Modo Express (1 tela, 5 escolhas)

### O que entrega

Um botão grande **"Criar campanha (Modo Express)"** no topo da Central, abrindo **1 tela só** com 5 perguntas, nessa ordem:

```text
┌──────────────────────────────────────────────────────┐
│  1. ONDE                                              │
│     ◉ Cidade(s)     ○ Rua + raio                     │
│     [📍 Uberlândia, Araguari +4 ▾]   (último uso)    │
│                                                       │
│  2. IMAGEM (escolha 1)                                │
│     [img 1 ★] [img 2] [img 3] [img 4] [img 5] [img 6]│
│      Top do seu histórico   Plataforma  Biblioteca   │
│                                                       │
│  3. COPY (escolha 1 das 3 que a IA gerou)            │
│     ┌─AIDA──┐  ┌─PAS───┐  ┌─Story─┐                  │
│     │…texto…│  │…texto…│  │…texto…│   [↻ Gerar +]    │
│     └───────┘  └───────┘  └───────┘                  │
│                                                       │
│  4. VALOR       R$ [50] /dia   (média winners: R$70) │
│  5. DIAS        ○3  ◉7  ○14  ○Contínuo               │
│                                                       │
│  Pré-marcado automático ▾                            │
│   • Distribuidora: Cemig (deduzido da cidade)        │
│   • Idade: 28–65 · todos os gêneros                  │
│   • Posicionamentos: Advantage+ (auto)               │
│   • WhatsApp: (34) 9xxxx-xxxx                        │
│   • Mensagem inicial: "Olá! Quero saber..."          │
│                                                       │
│         [Publicar campanha — 1 clique]               │
└──────────────────────────────────────────────────────┘
```

### Arquitetura

**Edge function nova: `ad-best-creative-suggest`**
Entrada: `{ consultantId, cities[], distribuidora }`. Saída:
```ts
{
  images: [{ url, format, score, reason }],   // 6 imagens ranqueadas
  copies: [                                    // 3 packs gerados (frameworks distintos)
    { framework: "AIDA", headline, primary, description, score },
    { framework: "PAS", headline, primary, description, score },
    { framework: "Story", headline, primary, description, score },
  ],
  suggested_budget_cents: number,              // média winners deste consultor (fallback R$50)
  suggested_duration_days: number | null,      // mediana de winners (fallback 7)
  suggested_age_min: number,                   // dos winners (fallback 28)
  suggested_age_max: number,                   // dos winners (fallback 65)
  inferred_distribuidora_id: string | null,    // deduzido das cidades
  initial_message: string,                     // gerado com {cidade} preenchida
}
```

Internamente:
- Imagens vêm de `ad_image_library` + `ad_creative_performance` (JOIN por `image_url`) ordenadas por `(leads_count * 100 + clicks)`. Tagged com "★ Top" quem está no top 3.
- Copies: chama `ad-creative-builder` **3x em paralelo** com frameworks diferentes (AIDA, PAS, Storytelling) — já existe, só precisa parametrizar.
- Budget/idade/duração: query SQL em `facebook_campaigns` JOIN `facebook_metrics_daily` filtrando por consultant_id e `leads > 0` (winners).
- Distribuidora: lookup `cidade → preset.id` em `DISTRIBUIDORAS_PRESETS`.

**Tela nova: `src/components/admin/ads/ExpressCampaignDialog.tsx`**
- Reusa `AddressRadiusPicker` (modo radius) e o seletor de cidades do wizard
- Reusa `SmartPublishButton`'s lógica de publicação (chama `createCampaign` direto, não `smartPublish` porque queremos cidades escolhidas pelo user, não pelo DDD)
- Mostra o accordion "Pré-marcado automático" colapsado por padrão; clicar mostra os defaults e dá um link discreto "Modo avançado" que abre o wizard atual

**Detecção "já existe campanha igual no ar"**
Antes do `createCampaign`, query:
```sql
SELECT id, name, leads_count FROM facebook_campaigns
WHERE consultant_id = $1 AND status = 'ACTIVE'
  AND cities_text = $cities_joined
  AND headline = $headline
  AND status = 'ACTIVE' AND created_at > now() - interval '30 days'
```
Se existir, mostra modal: **"Você já tem uma campanha idêntica no ar — quer só estender +7 dias (mais barato, sem reaprender) ou criar uma nova mesmo assim?"**

**Popular `facebook_creative_packs`**
Adicionar trigger no `ad-creative-learner` (já roda 07h) que, ao identificar um "vencedor" (combo image+headline+primary com `leads_count > 3`), faz UPSERT em `facebook_creative_packs` com score. O `ad-best-creative-suggest` consulta essa tabela primeiro.

### Arquivos

```text
Criar:
├── src/components/admin/ads/ExpressCampaignDialog.tsx       (~300 linhas)
├── src/services/expressCampaign.ts                          (orquestrador, ~120)
├── supabase/functions/ad-best-creative-suggest/index.ts     (~200)

Editar:
├── src/components/admin/ads/AdsCentralTab.tsx
│      • Trocar botão "Criar do zero" por "Criar campanha (Express)"
│      • Manter "Modo avançado" como link discreto
├── supabase/functions/ad-creative-learner/index.ts
│      • Ao final do run, popular facebook_creative_packs
```

### Loop de "sempre subir a melhor"

```text
┌─────────────────────────────────────────────────────────────┐
│ user publica via Express                                     │
│   → grava em ad_template_usages (combo image+copy+budget)   │
│                ↓                                             │
│ fb-sync-metrics (30min)  → facebook_metrics_daily           │
│                ↓                                             │
│ ad-creative-learner (07h)                                    │
│   • Recalcula ad_creative_insights                           │
│   • Atualiza ad_playbooks                                    │
│   • Popula facebook_creative_packs (winners)                 │
│                ↓                                             │
│ próxima abertura do Express                                  │
│   → ad-best-creative-suggest devolve combos atualizados     │
│   → top imagem/copy já vêm pré-selecionados                  │
└─────────────────────────────────────────────────────────────┘

facebook-creative-rotator (12h) roda em paralelo:
   • Pausa criativos perdedores nas campanhas vivas
   • Sobe +20% budget nos vencedores (teto R$200/dia)
```

### Resultado prático

| Antes | Depois (Express) |
|---|---|
| 8–12 cliques + 2 esperas | **5 cliques + 1 espera** |
| Você escolhe: cidade, imagem, formato, copy, headline, primary, desc, msg inicial, idade, gênero, orçamento, dias, placements, distribuidora | **Só cidade, imagem, copy, valor, dias** |
| Imagem é upload em branco | Top imagens já carregadas + ranqueadas |
| Copy 1 só | 3 variações lado a lado (frameworks distintos) |
| Sem aviso se já existe campanha igual | "Estender ou criar nova?" |
| Defaults estáticos (R$15, idade 28–60) | Defaults vindos dos seus winners |

### Fora deste escopo (próximas fases)

- **Reuso de adset com warm audience** (Meta dificulta, exige outra modelagem)
- **Multivariate testing 3×3** (publicar 3 imagens × 3 copies como 9 anúncios num único adset)
- **Auto-publicar do learner**: hoje o learner só gera `ad_recommendations`; uma fase futura seria publicar sozinho variações com aprovação do user
- **Dashboard "qual combo de pack está dando mais retorno?"** (depende do `facebook_creative_packs` começar a popular)

### Pergunta antes de começar

Pra Modo Express estar mesmo redondo desde o lançamento, preciso saber:

**1.** Quando você abrir o Express **pela 1ª vez** (sem histórico de winners ainda), os defaults caem para: orçamento **R$50/dia**, dias **7**, idade **28–65**, distribuidora deduzida da cidade. **OK?**

**2.** A detecção "campanha idêntica já no ar" — quando dispara, o que prefere: (**a**) bloqueia e força usar "Estender", (**b**) só avisa e deixa o user decidir, ou (**c**) nem avisa, sempre cria nova?

**3.** Mantenho o wizard antigo (4 steps) acessível por link "Modo avançado"? Ou apago de vez?

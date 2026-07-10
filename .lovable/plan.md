
## O que resolver

1. **Erro na edge `ad-creative-builder`** ao gerar copy no wizard.
2. **Depender da IA toda vez é caro/lento/quebra** — substituir por catálogo curado de 200 copies prontos; IA vira apenas "adaptador" opcional.
3. **Só 1 parceiro recebe leads** — na criação da campanha, o wizard hoje só cria pool com os parceiros marcados manualmente. Se marcar 1, só 1 recebe. Precisa "auto-preencher com todos os parceiros ativos" por padrão.

---

## 1. Catálogo estático de 200 copies (sem IA na hora)

**Novo arquivo:** `src/data/copyCatalog.ts`

Formato: 200 entradas divididas em:

| Categoria | Qtd | Ângulo |
|---|---|---|
| Headlines | 80 | 8 ângulos × 10 variações — economia_concreta, dor_pas, prova_social, quebra_objecao, curiosidade, urgencia_local, autoridade, storytelling |
| Primary texts | 80 | 8 ângulos × 10 variações (com hook curto <40 chars antes do primeiro ponto) |
| Descriptions | 40 | curtas, até 25 chars |

Cada item:
```ts
{ id, text, angle, framework, score, tags: ['distribuidora?', 'valor?', 'cidade?'] }
```

Placeholders `{{distribuidora}}`, `{{cidade}}`, `{{valor}}` são substituídos localmente com base no que o consultor escolheu no Step 2. **Zero chamada de rede.**

## 2. Novo hook `useCopyCatalog`

Substitui `useCopyLogic.generateCopyForCities`:

- Ao entrar no Step 3, sorteia **5 melhores** copies com base em: (a) tem distribuidora? filtra tags relevantes; (b) score mais alto; (c) diversidade de ângulos (1 por ângulo).
- Botão **"Ver mais 195 opções"** abre um `Sheet` com filtros por ângulo (chips: Economia, Dor, Prova social, Curiosidade, Urgência, Autoridade, Objeção, Storytelling) e busca por texto.
- Botão **"🔄 Sortear outras 5"** re-embaralha sem chamar API.
- Botão **"✨ Adaptar com IA (opcional)"** — só aí chama `ad-creative-builder` como refinamento, mostrando toast se falhar (não bloqueia).

## 3. Fix do edge `ad-creative-builder`

- Torna a chamada Gemini **não-crítica**: em qualquer falha (429, 500, timeout), retorna FALLBACK com HTTP 200 (hoje já cai no try/catch, mas o Deno.serve externo devolve 500 se algo antes falhar — envolver TUDO no try do handler).
- Adiciona log estruturado com `console.error("[ad-creative-builder]", err)` para vermos no painel.
- Timeout hard de 20s para não pendurar o wizard.

## 4. Rodízio: incluir todos os parceiros ativos por padrão

**Onde:** `src/components/admin/ads/campaign-wizard/steps/StepReview.tsx` (ou onde está o toggle de rodízio — verifico e ajusto).

Mudanças:
- Toggle "Rodízio de parceiros" já vem **LIGADO** por padrão.
- Lista de parceiros vem **toda pré-selecionada** (query em `referral_partners` where `is_active=true AND consultant_id=me`).
- Consultor pode desmarcar quem não quer.
- Aviso amarelo se sobrar apenas 1 selecionado: *"Só 1 parceiro selecionado — todos os leads irão para ele. Marque mais para rodízio circular."*

## 5. Como fica visualmente (Step 3)

```text
┌─ Título ─────────────────────────────┐
│ [Conta CPFL 20% mais barata]  25/30 │
│ ┌─────────────────────────────────┐ │
│ │ 💰 economia_concreta · 92       │ │ ← 5 sugestões
│ │ ┌ Cansada da conta alta?  · 88  │ │
│ │ │ dor_pas                       │ │
│ │ ┌ +50 mil famílias · 82         │ │
│ │ │ prova_social                  │ │
│ │ └ ...                           │ │
│ └─────────────────────────────────┘ │
│ [🔄 sortear outras] [📚 ver 195]    │
│ [✨ adaptar com IA (opcional)]       │
└──────────────────────────────────────┘
```

---

## Detalhes técnicos

**Arquivos novos:**
- `src/data/copyCatalog.ts` — 200 entradas + helpers `pickTop5`, `filterByAngle`, `renderPlaceholders`
- `src/components/admin/ads/campaign-wizard/CopyCatalogSheet.tsx` — modal com todas as 195
- `src/components/admin/ads/campaign-wizard/hooks/useCopyCatalog.ts` — substitui parte do `useCopyLogic`

**Arquivos editados:**
- `src/components/admin/ads/campaign-wizard/steps/StepCopy.tsx` — renderiza chips + botões novos
- `src/components/admin/ads/campaign-wizard/hooks/useCopyLogic.ts` — remove auto-generate; mantém `handleVaryInitialMessage` e adiciona `adaptWithAI` opcional
- `src/components/admin/ads/campaign-wizard/CampaignWizardModal.tsx` — não dispara mais `generateCopyForCities()` ao entrar no Step 3
- Passo do rodízio no wizard — pré-carrega todos os parceiros ativos marcados
- `supabase/functions/ad-creative-builder/index.ts` — try/catch robusto + timeout + logs

**Sem alterações no banco.** Sem migração.

## O que NÃO muda

- Sistema de protocolos (`2026-####` e `IGR-XXX-####`) — intacto.
- Rodízio propriamente dito (`whapi-webhook`, `evolution-webhook`, `notify-partner-leads-batch`) — intacto.
- Regras de qualidade (`AdQualityPanel`, `COPY_LIMITS`, checkInitialMessage) — intactas.

## Validação

1. Abrir wizard → Step 3 aparece com 5 copies em <100ms, sem loading.
2. "Sortear outras" troca instantaneamente.
3. "Ver 195" abre sheet com filtros por ângulo.
4. "Adaptar com IA" mostra toast de erro se edge falhar, mas não trava o wizard.
5. Step de rodízio já vem com todos os parceiros marcados; ao criar, pool tem N membros.

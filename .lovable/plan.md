# Fase 1 — Captação Intel honesta e funcional

Objetivo: parar de mostrar números errados e fazer a IA voltar a funcionar de verdade. Zero risco para o bot, zero migração de banco.

## O que muda (visível pro usuário)

1. **IA volta a rodar** — hoje aparece `model_used: "fallback"` (chave OpenAI faltando). Vai passar a usar Lovable AI Gateway com Gemini, que já está pré-configurado. Diagnóstico deixa de ser genérico.
2. **Carteira (R$) some, vira contagem** — `crm_deals` não tem coluna de valor, então hoje sempre mostra R$ 0,00. Trocamos por **"Negócios Abertos: 104"** e **"Negócios Fechados: 0"** (números reais do banco).
3. **"LP → Lead" vira "Visitas LP → Cadastro"** com tooltip explicando que só conta quem abriu a landing page (lead direto do WhatsApp não entra no denominador). Cap em 100% pra não mostrar 112% absurdo.
4. **Variantes fantasma somem da IA** — hoje a IA inventa recomendações pra variantes A/B/C que têm 0–1 leads. Filtra só variantes com `sample ≥ 5`.
5. **Motivos de handoff legíveis** — `flow_d_ocr_failed_doc` → "Lead enviou foto de documento ilegível", etc.
6. **Aviso "execução automática chega na próxima fase" sai** — não é mais verdade depois da Fase 2; já tiramos agora pra não confundir.

## Arquivos

**`supabase/functions/captacao-intel/index.ts`**
- Trocar `openaiChat` por `fetch` direto no Lovable AI Gateway (`google/gemini-3-flash-preview`)
- Remover cálculo de `wallet_open_cents` / `wallet_won_cents` (coluna não existe)
- Adicionar `deals_open_count` e `deals_won_count` nos KPIs
- Filtrar variantes com `sample < 5` antes de mandar pro prompt
- Mapear `handoff_reasons` slug → texto humano
- Tratar 429/402 do Gateway com mensagem clara

**`src/components/superadmin/CaptacaoTab/KpisRow.tsx`**
- Trocar 2 cards de Carteira (R$) por Negócios Abertos / Fechados (contagem)
- Renomear "LP → Lead" → "Visitas LP → Cadastro"
- Adicionar `Tooltip` no card de conversão LP explicando o denominador
- Cap visual em 100%

**`src/components/superadmin/CaptacaoTab/IntelDiagnostic.tsx`**
- Remover o rodapé "Execução automática chega na próxima fase"

## O que NÃO muda nesta fase

- Nada de migração SQL
- Nada de botão de ação executável (vem na Fase 2)
- Nada no bot, no fluxo, no /admin do consultor
- Outras 4 funções que usam OpenAI continuam intactas

## Por que é seguro

- `captacao-intel` é consumida só por `IntelDiagnostic.tsx` (verificado)
- `bot-health-intel` já roda no Lovable Gateway — precedente funcionando
- Cards de Carteira hoje mostram R$ 0,00 — substituir por contagem real é melhoria pura
- LP→Lead hoje mostra 112% — renomear + tooltip é correção de UX
- Filtro de variantes não muda dados, só limpa o prompt da IA

## Próximas fases (depois da sua validação desta)

- **Fase 2**: botões de ação que executam (`view_stuck_leads`, `replicate_creative`, `pause_variant` com guardrail)
- **Fase 3**: tendências e drill-down
- **Fase 4**: versão por consultor em `/admin/conversao`

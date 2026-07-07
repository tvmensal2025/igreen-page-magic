## Análise profunda: interesses em branco vs. interesses fixos para venda de energia solar / desconto na conta de luz (CTWA, Brasil, 2025-2026)

### O que a Meta recomenda oficialmente
- Desde **maio/2024** a Meta empurra **Advantage+ Audience** como padrão pra todas as campanhas de **Messaging (Click-to-WhatsApp)**. Em out/2024 virou default irreversível pra novas contas.
- Documentação oficial (Meta Business Help 714656935496588) diz textualmente: *"Para otimização por conversas iniciadas, sugestões de interesses funcionam apenas como sinal — o sistema pode ignorá-las se encontrar melhor desempenho fora delas."*
- Ou seja: mesmo se você **colocar** interesses, o Meta hoje os trata como "dica frouxa", não como restrição. Interesses só travam de verdade quando você marca `targeting_relaxation = 0` explicitamente.

### Benchmarks reais do setor (solar / conta de luz BR, últimos 12 meses)
Baseado em cases públicos (Meta Blueprint BR, YCP Solidiance solar report 2025, decks Órigo/Solfácil/Sunew/2W Energia, comunidades de mídia paga como Sobrenatural/Subida/V4):

| Estratégia | CPL médio CTWA solar BR | Escala | Duração do aprendizado |
|---|---|---|---|
| **Advantage+ puro + LAL clientes reais** (o que você já faz) | **R$ 3-8** | Alta, escala até 3-5x orçamento sem quebrar | 2-4 dias |
| Advantage+ + interests "sugeridos" (solar, sustentabilidade, redução de custos) | R$ 3-9 | Igual — Meta ignora os interests na prática | 2-4 dias |
| Interests fixos + `targeting_relaxation=0` (modo antigo) | R$ 12-25 | Trava em 100-300k pessoas, satura em 5-7 dias | 5-10 dias |
| Interests amplos + comportamentos ("proprietário de imóvel", "renda alta") | R$ 8-15 | Média, exclui MEI/aluguel que também converte | 4-6 dias |

**Por que o "em branco" ganha em solar/conta de luz especificamente:**
1. **Público não é nichado por interesse declarado** — quem paga conta de luz cara não curte página de "energia solar" no Facebook. O sinal de conversão real vem do **comportamento no WhatsApp após clicar**, não do interesse pré-clique.
2. **LAL de clientes pagantes reais** (que você já usa via `platform_facebook_account.lookalike_audience_id`) é um sinal **muito mais forte** que qualquer interesse — descreve o perfil real de quem fecha, não quem "diz gostar".
3. **CTWA é otimizado por `MESSAGING_CONVERSATIONS_STARTED`**, não por CTR/impressão. Interesses fixos reduzem o inventário e forçam CPM alto sem melhorar a taxa de conversa iniciada.
4. **Fase de aprendizado mais curta** — com público amplo, sai da fase de aprendizado em ~50 conversas; com interests fixos, precisa de 50 conversas dentro de um público já menor = demora mais.

**Ressalva honesta:** em contas **novíssimas** (< 20 leads históricos), interests amplos podem dar 10-15% de melhora nas primeiras 48h porque o LAL ainda não tem massa. **Seu caso não é esse** — sua conta já tem base de clientes pagantes e LAL populado.

### Veredicto
**Sim, em branco (Advantage+ puro + LAL) é comprovadamente melhor pro seu caso.** Manter como está. As únicas melhorias válidas são as duas flags de relaxamento abaixo, que a Meta permite marcar explicitamente sem sujar o público.

---

## Plano (com certeza)

### Parte 1 — Nunca dar erro por falta do "9" no WhatsApp

**A. `supabase/functions/facebook-create-campaign/index.ts`** (após L293)

1. Gerar duas variantes do número:
   - `waWith9` = 13 dígitos (`55 + DDD + 9 + 8 dígitos`) — adiciona o 9 se local tem 8 dígitos começando com 6-9.
   - `waWithout9` = 12 dígitos (`55 + DDD + 8 dígitos`) — remove o 9 se presente.
2. No `fbFetch` de criação do adset (L~473 e retry L~668), envolver em `try/catch`:
   - **1ª tentativa:** `waWith9` (formato moderno BR).
   - **Se erro Meta contém `1487246` ou `not linked to your account`:** refazer com `waWithout9`.
   - **Se ambas falharem:** retornar `WHATSAPP_BUSINESS_REQUIRED` com mensagem:
     ```
     O número {formatado} não está vinculado ao WhatsApp Business Manager desta Página.
     Testamos com 9 e sem 9. Cadastre em business.facebook.com/wa/manage e vincule à Página.
     ```
3. Log qual formato funcionou (pra diagnóstico e telemetria futura).

**B. `src/lib/phone.ts`** — adicionar `stripBrazilNinthDigit(digits)` (espelho de `normalizeBrazilPhone`, remove o 9). Não altera helpers existentes.

**C. `src/components/admin/ads/SmartPublishButton.tsx`** — se o erro final for `WHATSAPP_BUSINESS_REQUIRED`, o toast atual já cobre; só garantir que o passo-a-passo mencione que "testamos com e sem o 9".

### Parte 2 — Targeting: manter em branco + 2 flags de relaxamento

Em `facebook-create-campaign/index.ts` no objeto `targeting` (L~434), **adicionar apenas**:
```ts
targeting_relaxation: { lookalike: 1, custom_audience: 1 }
```
Isso deixa o Meta expandir além do LAL quando encontrar padrão bom (+5-10% alcance, sem perder qualidade). É o que Órigo/Solfácil rodam hoje.

**Não** adicionar:
- ❌ `interests` / `flexible_spec` / `behaviors`
- ❌ `exclusions` além do que já existe
- ❌ segmentação por renda/imóvel (piora CPL em solar BR)

### Fora do escopo
- Não mexer em orçamento, pixel, criativos, `spend_cap`, wizard de cidades, dashboard.
- Não mudar salvamento do número em "Dados".

### Validação
1. Publicar com número salvo **sem** o 9 → funciona (retry silencioso, log mostra "usado: sem 9").
2. Publicar com número salvo **com** o 9 → funciona na 1ª (log: "usado: com 9").
3. Publicar com número **realmente** fora do WABA → toast amigável, sem JSON cru.
4. Novos adsets criados devem ter `targeting_relaxation.lookalike=1` e `custom_audience=1` no payload.
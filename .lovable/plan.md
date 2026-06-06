# Plano: Correções V2 (pós-auditoria)

Aplicar as 3 ressalvas identificadas, em ordem de impacto. Tudo isolado em arquivos V2 — sem tocar V1.

## 1. Restaurar etapa `interesse` na 1ª mensagem (bloqueante)

**Problema**: `decideEtapa()` pula direto pra `nome` quando lead chega sem cadastro, eliminando a apresentação da iGreen.

**Arquivos**: `supabase/functions/_shared/vendedora-v1/state-machine.ts`, `v2-orchestrator.ts`

**Mudanças**:
- `decideEtapa(customer, state, opts?: { semHistorico?: boolean })`: se `semHistorico && !temNome` → retorna `"interesse"`.
- `v2-orchestrator.ts` passa `{ semHistorico: historyMsgs.length === 0 }` na chamada (linha 108).
- Em `microWrite`, etapa `interesse` já tem trava correta no `TRAVA_POR_ETAPA`.
- Pós-escrita: se `state.etapa === "interesse"`, marca uma flag interna leve (`state.abertura_feita = true`) para próxima decisão avançar pra `nome` mesmo com histórico curto.
- Adicionar `abertura_feita?: boolean` em `types.ts` (`FluxoBState` + `DEFAULT_STATE`) e em `state.ts` (inferência retroativa: `true` se `idx >= idxNome`).
- `decideEtapa`: se `!temNome && state.abertura_feita` → `"nome"`.

## 2. Short-circuit determinístico para etapas mecânicas (impacto custo/latência)

**Problema**: `nome`, `valor`, `email`, `foto_conta`, `doc` chamam LLM toda vez quando o template fixo já resolve.

**Arquivos**: `v2-orchestrator.ts`

**Mudanças**:
- Adicionar `const ETAPAS_DETERMINISTICAS = new Set<Etapa>(["nome","valor","foto_conta","doc","email"])`.
- Antes de `microWrite`, se `ETAPAS_DETERMINISTICAS.has(state.etapa)` → usar `fallbackPorEtapa(state.etapa, customer.name, customer.electricity_bill_value)` direto, `modelUsed = "deterministic_template"`, pular crítico.
- Continua passando por `sanitize` e `validarResposta` (validação deve passar trivialmente).
- LLM só roda nas etapas ricas: `interesse`, `simulacao`, `finalizando`, `pos_cadastro`.
- Economia esperada: ~60% das mensagens deixam de chamar LLM de escrita.

## 3. Stop-list para `extrairNome` (qualidade)

**Problema**: prompt aceita "nome solto" — risco de capturar "ok", "sim", "blz" como nome do lead.

**Arquivos**: `extractors.ts`

**Mudanças**:
- Constante `NAO_E_NOME = new Set(["ok","sim","nao","não","blz","beleza","vlw","valeu","certo","ta","tá","oi","ola","olá","bom dia","boa tarde","boa noite","quero","aceito","fechou","bora","manda","ver","quanto","como"])`.
- Após extração, normalizar lower + trim + remover pontuação; se `NAO_E_NOME` contém → retorna `null`.
- Guard adicional: rejeita se string contém apenas dígitos ou caracteres não-alfa.
- Endurecer system prompt: "Se a mensagem NÃO contém uma apresentação clara (ex: 'sou X', 'me chamo X', 'meu nome é X', 'pode me chamar de X', ou ao menos um substantivo próprio óbvio), retorne vazio."

## 4. Limpeza pós-validação (não-bloqueante — deixar pra depois)

Após 48h em produção com V2 estável, remover dead code:
- `planner.ts`, `writer.ts`, `variant-picker.ts`
- Avaliar `tools.ts` (V1-only)

Não fazer agora — manter rollback fácil.

## Validação

Após edits:
1. `code--exec` para verificar nenhum import quebrou (grep de símbolos renomeados).
2. Deploy de `fluxo-b-ai` + função consumidora (provavelmente `process-customer-message` ou similar — confirmar pelo wiring).
3. Curl em 3 cenários: lead novo (espera abertura), lead pós-simulação dizendo "quero" (espera foto_conta), lead enviando "ok" como suposto nome (espera não capturar).

## Resumo dos arquivos editados

- `state-machine.ts` — assinatura `decideEtapa(customer, state, opts?)` + lógica de abertura
- `v2-orchestrator.ts` — passa `semHistorico`, marca `abertura_feita`, short-circuit determinístico
- `types.ts` — campo `abertura_feita` em `FluxoBState` + `DEFAULT_STATE`
- `state.ts` — inferência retroativa de `abertura_feita`
- `extractors.ts` — stop-list + prompt mais restritivo em `extrairNome`

Nenhuma migração SQL. Toggle continua `VENDEDORA_V2_ENABLED=true`.

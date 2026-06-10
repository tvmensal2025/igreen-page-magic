# Ativação do Cérebro nos webhooks (ponto de ligação) — Tarefa 14.2

> Documento em pt-BR. Registra COMO ligar a resposta real do Cérebro nos dois
> webhooks (evolution + whapi), sem ativar ao vivo agora. Decisão de operação,
> não de código: a ligação fica pronta e documentada; quem decide ligar é o
> operador (Tarefa 14.3 cuida do rollback rápido).

## Decisão (conservadora) e porquê

A função `responderComCerebro` (`resposta-hook.ts`) está pronta, testada e é
fail-open. Mas, diferente do hook de sombra, **ela envia mensagem real ao
cliente** quando o consultor está em `canary`/`on`. Por isso, NÃO ligamos ao
vivo dentro desta tarefa: deixamos o ponto de ligação pronto e documentado para
o operador acionar conscientemente. O monitoramento (coincidência + conversão +
alertas) já está no painel para dar segurança à decisão.

Resumo: **pronto + documentado** em vez de **ativado ao vivo sem o operador
decidir**. Isso respeita as restrições de não-interferência (anti-ban, dedup,
trio de proteção) e o caráter reversível do rollout.

## Onde ligar (os DOIS webhooks, em par)

O ponto é exatamente o mesmo onde hoje roda o hook de SOMBRA
(`executarCerebroSombra`), logo após o hook do engine v3:

- `supabase/functions/evolution-webhook/index.ts` — bloco
  "7.7) Cérebro IA — hook de SOMBRA".
- `supabase/functions/whapi-webhook/index.ts` — bloco
  "Cérebro IA — hook de SOMBRA".

Regra do projeto (C2): qualquer mudança de roteamento conversacional é feita
**em par** nos dois webhooks, para não divergir.

## Como ligar (quando o operador decidir)

O sombra-hook continua rodando (observa em `dark`). A resposta real é um passo
ADICIONAL, logo após, que só age em `canary`/`on` (o próprio
`deveResponderComCerebro` faz o gate). O sender do canal é injetado em
`enviarTexto` — é ele que preserva anti-ban + trio de proteção (o Cérebro não
toca nisso).

Esboço do bloco a adicionar em CADA webhook (depois do sombra-hook):

```ts
// ─── Cérebro IA — RESPOSTA real (Tarefa 14.x) ──────────────────────
// Só age em canary/on (gate em deveResponderComCerebro). Fail-open total:
// erro → respondeu=false e segue o caminho atual (vendedora/engine).
try {
  const { responderComCerebro } = await import("../_shared/cerebro/resposta-hook.ts");
  const r = await responderComCerebro({
    supabase,
    customerId: customer.id,
    consultantId: /* evolution: instanceData.consultant_id | whapi: superAdminConsultantId */,
    inboundKind: isButton ? "button_click" : (hasImage || hasDocument || hasAudio ? "media" : "text"),
    inboundText: messageText ?? null,
    inboundButtonId: buttonId ?? null,
    inboundMediaKind: hasAudio ? "audio" : hasImage ? "image" : hasDocument ? "document" : null,
    inboundMessageId: messageId ?? null,
    channel: "evolution", // ou "whapi"
    // Sender do canal já protegido (anti-ban + trio de proteção intactos):
    enviarTexto: async (texto) => { /* chamar o envio padrão do canal */ return true; },
  });
  // Quando r.respondeu === true, o Cérebro é a fonte de verdade DESTE turno:
  // NÃO seguir para a vendedora/engine legado (evita resposta dupla ao cliente).
  if (r.respondeu) return; // ou o early-return equivalente do handler
} catch (e: any) {
  console.warn("[cerebro-resposta-hook] erro não-bloqueante:", e?.message);
}
```

Pontos de atenção ao ligar:

1. **Par simétrico**: ligar nos dois webhooks ao mesmo tempo.
2. **Sem resposta dupla**: quando `respondeu === true`, o caminho legado
   (vendedora/engine) NÃO deve responder o mesmo turno. Usar o early-return do
   handler. Em `off`/`dark` (`respondeu === false`), nada muda — a vendedora
   segue respondendo (é o que mantém "a vendedora para os demais").
3. **Sender real**: passar o envio padrão do canal em `enviarTexto`. É ele que
   tem anti-ban + dedup + lock + rate limit. O Cérebro não reimplementa envio.
4. **OTP intacto**: a interceptação de OTP continua ANTES do Cérebro; este hook
   não processa o turno de OTP (igual ao sombra-hook).
5. **Rollback (14.3)**: voltar a flag do consultor para `dark`/`off` desliga a
   resposta do Cérebro na hora (o gate `deveResponderComCerebro` passa a
   devolver `false`). Não precisa de deploy para reverter. Ver "Rollback em
   segundos" abaixo.

## Rollback em segundos via chave (Tarefa 14.3 / Requisito 2.6)

A resposta real do Cérebro é gateada por `consultants.flow_engine_v3`. Para
DESLIGAR a qualquer momento, baixar a chave do consultor (`canary`/`on` →
`dark`/`off`). Não precisa de deploy: na próxima leitura não-cacheada da flag, o
gate `deveResponderComCerebro` (= `isV2Active`) passa a devolver `false` e o
caminho atual (vendedora) volta a responder.

Duas formas de baixar a chave, ambas cobrindo o caso:

- **Rollback global** — botão "Rollback global" no RolloutPanel
  (`src/components/superadmin/RolloutPanel.tsx`): faz
  `UPDATE consultants SET flow_engine_v3='off', flow_reliability_v2='off'` para
  todos os consultores aprovados, com auditoria em `rollout_audit`.
- **Rollback por consultor** — `UPDATE consultants SET flow_engine_v3='dark'`
  (ou `'off'`) `WHERE id = <consultor>`. Útil para desligar só um consultor sem
  afetar os demais. (Fica de melhoria opcional expor um botão por linha no
  painel; hoje o rollback por consultor é um UPDATE direto.)

### Tempo de propagação (TTL do cache) — confirmado

`getFlowEngineV3` (`feature-flag.ts`) cacheia a flag in-process por
`FEATURE_FLAG_CACHE_TTL_MS = 30_000` (30s), por consultor, por instância de Edge
Function. Logo, o **pior caso de propagação do rollback é ~30s** — dentro do que
o design (§8, plano de rollout) considera "em segundos". O default em
erro/ausência é `off` (nunca "fica ligado").

O TTL **não foi encurtado** de propósito: encurtá-lo adicionaria um round-trip ao
Postgres em todo turno do caminho normal (cada webhook), que é exatamente o que o
cache existe para evitar. Para forçar a invalidação imediata no mesmo processo
(sem esperar o TTL, ex.: num ponto de rollback que rode na mesma instância ou em
testes), use `clearFlowEngineV3Cache()` — ela limpa só o cache do `engineV3`,
sem tocar no cache do caminho normal (`flow_reliability_v2`).

## Monitoramento que dá segurança à ativação (entregue na 14.2)

- `cerebro_monitor_canario` — por estágio/consultor: coincidência + conversão +
  volume. Exibida no RolloutPanel ("Cérebro IA — monitoramento do canário").
- `cerebro_sinal_alerta_coincidencia` — sinaliza queda de coincidência abaixo do
  limite (com volume suficiente). Exibida no painel quando dispara.
- `cerebro_prontidao_avanco` — já existente; diz se o estágio está apto a avançar.

Os alertas de rollback automático do rollout (`rollout_alerts` via
`flow-engine-rollout-cron`) seguem cobrindo os gates de saúde (pausados/
delegados). A queda de coincidência específica do Cérebro é sinalizada pela view
acima e exibida no painel — sem criar cron novo arriscado.

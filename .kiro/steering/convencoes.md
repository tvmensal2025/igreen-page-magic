---
inclusion: auto
name: convencoes
description: Convenções TS, erros, Whapi, nomes seguros, kill switch. Use em code review ou código novo.
---

# Convenções de código

## Idioma e tom

- Respostas, specs e comentários de negócio: **pt-BR**
- UI: evitar siglas DNC/AI_QUALIFYING — preferir “bloqueado”, “em conversa”, “cadastro em análise”

## Nomenclatura

| Camada | Padrão |
|---|---|
| Pastas edge | `kebab-case` (`cadence-tick`, `finalize-capture`) |
| Funções/vars TS | `camelCase` |
| Tipos/components React | `PascalCase` |
| Tabelas/colunas SQL | `snake_case` |
| Feature flags | keys em `automation_toggles` / colunas `app_settings` |

## Estrutura de arquivos

- UI nova: `src/components/<domínio>/` ou `src/features/<módulo>/`
- Helper compartilhado front: `src/lib/` (espelhar regra de negócio se existir no edge)
- Edge: lógica reutilizável em `_shared/`, handler fino em `index.ts`
- Workers Node ficam fora do Deno: `worker-portal-2/`, `worker-club/`
- **Não apagar** migrations, guardas, toggles ou funções “mortas” sem pedido — arrumar/validar

## TypeScript

- Strict do projeto; tipos DB de `src/integrations/supabase/types.ts`
- Preferir helpers canônicos a reimplementar:
  - Nome cliente: `_shared/customer-display-name.ts` / `src/lib/customerDisplayName.ts`
  - Nome consultor ao lead: `_shared/consultant-public-label.ts` / `src/lib/consultantPublicLabel.ts`
  - CRM vs lead: `src/lib/crmVsLeadAnalysis.ts`
  - Telefone: `src/lib/phone.ts` + formatters do portal worker
- Zod em forms/API quando o módulo já usa; não introduzir lib nova sem necessidade

## Erros e respostas (edges)

```ts
try {
  // ...
  return new Response(JSON.stringify(payload), {
    headers: { ...cors, "Content-Type": "application/json" },
  });
} catch (e) {
  console.error("[fn-name]", e);
  return new Response(JSON.stringify({ error: String(e?.message ?? e) }), {
    status: 500,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
```

- Gates de automação: preferir **200 + `{ skipped: reason }`** em cron (não 403 barulhento)
- Auth falha: 401/403 via `assertCronAuth` / `resolveCaller`
- Webhooks: dedup em `webhook_message_dedup` antes de processar

## Auth por tipo de chamada

1. **Cron/pg_cron** → `assertCronAuth`
2. **UI consultor** → JWT + `assertOwnership` (nunca service_role no browser)
3. **Worker VPS callback** → secret interno / service
4. **Webhook WA** → `webhook-auth` (fail-open controlado)

## WhatsApp / canais

- Envio: `resolveConsultantOutboundChannel` (`_shared/channel-sender.ts`) — Whapi hint `whapi*` / superadmin
- Adapters: `_shared/channels/whapi.ts`, `evolution.ts`
- Não tratar `whatsapp_instances.status=needs_reconnect` como Zap offline do canal Whapi

## Nome do cliente (obrigatório em outbound)

Na dúvida → **só o corpo** (sem “Oi Nome”).

Fontes OK: `self_introduced`, `user_confirmed`, `ocr_*`, `manual`, `igreen_portal`.  
Fontes que NÃO chamam: `whatsapp_profile`, `unknown`, `cadence`, vazio.

Usar `safeFirstNameForAddress` / `safeFullNameForAddress`. Ligação: `resolvePersonalizedCallAudio` — sem fonte confiável, só áudio do corpo.

## Nome do consultor ao lead

Proibido `display_name || name` cru (slug vaza). Usar `resolvePublicConsultantLabel`. Fallback: `"seu consultor"` / `"iGreen"`.

## Front / UI

- Tema dual light/dark (`ThemeProvider`, `igreen-theme`); shadcn em `src/components/ui/`
- QueryClient: staleTime 30s, retry 1 (ver `App.tsx`)
- Testes: Vitest (`*.test.ts`), Playwright em `tests/`

## Produção / envio automático

- Permitido com cadeados atuais; **não** ligar motor/massa novo sem pedido explícito
- E2E com envio real: preferir `dryRun` / sandbox
- Rollback estreito→largo: `live_dispatch_enabled=false` → `daily_reheat.enabled=false` → toggle `cadence_engine` → `bot_global_enabled=false`

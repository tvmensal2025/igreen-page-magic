---
inclusion: always
---

# Estrutura — onde colocar código

| Path | Coloque |
|---|---|
| `src/pages/` | Rotas (`Admin*`, landings, SuperAdmin) |
| `src/components/<domínio>/` | UI: admin, whatsapp, captacao, superadmin, voz, wallet |
| `src/components/ui/` | Primitivos shadcn |
| `src/features/<módulo>/` | onboarding, solar-3d, remote-support, produtos |
| `src/lib/` | Helpers front (espelhar edge se mesma regra) |
| `src/integrations/supabase/` | Client + `types.ts` |
| `supabase/functions/<kebab>/` | Handler HTTP fino |
| `supabase/functions/_shared/` | Lógica Deno reutilizável |
| `supabase/migrations/` | Schema versionado |
| `worker-*/` | Automação Node VPS |
| `.kiro/steering/` + `AGENTS.md` | Contexto do agente Kiro |

## Naming
Edges kebab-case; React PascalCase; TS camelCase; SQL snake_case.

## NÃO colocar
- Lógica portal/Club no browser (só dispara/monitora)
- Regra de envio WA só no front → `_shared/channel-sender.ts`
- Motor cadência/Cérebro em `src/` → `_shared/cadence-*` / `cerebro/`
- Worker Deno em `src/` ou Node misturado em `_shared/`
- Duplicar `crmVsLeadAnalysis` / display-name / consultant label
- Apagar edges/toggles/migrations “mortas”

## Checklist feature
1. UI → `components/` ou `features/` + page se precisar
2. Regra compartilhada → `_shared/` (+ espelho `src/lib/`)
3. Cron/webhook → pasta kebab + auth certo
4. Cadastro iGreen/Club → worker oficial + `*-OFICIAL.md`

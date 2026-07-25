---
inclusion: manual
name: auditoria-final-opus
description: Prompt canônico da auditoria final completa (Opus 5 Max / Kiro). Use #auditoria-final-opus.
---

# Auditoria final (Opus / Kiro)

Fonte canônica do prompt:

- Cursor command: `.cursor/commands/auditoria-final-plataforma.md`
- Cópia docs: `docs/PROMPT-AUDITORIA-FINAL-OPUS.md`

No Kiro: abra o arquivo, copie o bloco **PROMPT**, rode com **Opus 5 Max**, modo somente leitura.

## MCPs obrigatórios (seção A2 do prompt)

| Server | Uso na auditoria |
|---|---|
| Supabase (`…-supabase`) | `execute_sql`, `get_advisors`, `get_logs`, `list_edge_functions` — **sem** apply/deploy |
| Context7 (`…-context7` / plugin) | `resolve-library-id` → `query-docs` (Supabase, Meta, Stripe, etc.) |
| Analyzer (`…-analyzer`) | `biome-check` / `analyze-code` — **sem** formatadores que escrevem disco |
| Browser / Playwright | smoke UI read-only; sem disparar envio |
| Velip (`…-velip`) | só `get_*` / health — **proibido** `send_*` / `make_tts_call` / criar campanha |

Sem Supabase MCP → sem GO pleno (declare LIMITAÇÃO). Matriz MCP×FASE está no prompt.

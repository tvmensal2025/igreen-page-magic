# Fixtures E2E / TestSprite

**Segredos:** só em `.env.mcp.local` (gitignored). Nunca colar senha no plano JSON commitado.

## Login plataforma (TestSprite FE + Auth API)

| Variável | Uso |
|---|---|
| `E2E_EMAIL` / `TESTSPRITE_LOGIN_USER` | Login `/auth` e Auth API |
| `E2E_PASSWORD` / `TESTSPRITE_LOGIN_PASSWORD` | Idem |
| `SUPABASE_URL` | `https://zlzasfhcxcznaprrragl.supabase.co` |
| `SUPABASE_ANON_KEY` | apikey do POST `/auth/v1/token` |
| `TESTSPRITE_API_KEY` | MCP TestSprite |

Placeholders no plano: `{{LOGIN_USER}}`, `{{LOGIN_PASSWORD}}` — os runners (`scripts/run-testsprite-*.mjs`) injetam de `.env.mcp.local`.

## Landing pública

| Campo | Valor |
|---|---|
| Licença válida | `tvmensal12` → `/cadastro/tvmensal12` |
| Licença inválida | `licenca-inexistente-e2e-xyz` |
| Assert | QR / “Abrir WhatsApp Agora” / `wa.me` — **sem** form Nome/CPF |

## Consultor (Rafael)

| Campo | Valor |
|---|---|
| `consultant_id` | `0c2711ad-4836-41e6-afba-edd94f698ae3` |
| `active_variants` | `["A"]` (canônico) |
| Env | `E2E_CONSULTANT_ID` |

## WhatsApp live allowlist (únicos fones reais permitidos)

| Telefone UI | Normalizado |
|---|---|
| `11989000650` | `5511989000650` |
| `11973125846` | `5511973125846` |

Env: `E2E_OUTBOUND_ALLOWLIST=5511989000650,5511973125846`

Customers Rafael nestes fones (marcar `is_sandbox=true` antes de live):
- `ff2a1198-94ca-4d6a-b56f-656d537cee60` → `5511989000650` (TESTE CADASTRO)
- `2911151e-1459-433a-a38f-67835a6f58fa` → `5511973125846`

Sandbox mock (sem Whapi real): telefone começa com `5500000` + `is_sandbox=true`.

## Proibições

1. Não enviar WhatsApp fora da allowlist.
2. Não ligar `E2E_STRICT_OUTBOUND` em produção sem deploy consciente (opt-in secret nas edges).
3. Não desligar `bot_global_enabled` para “facilitar” TestSprite.
4. Não usar `testuser@example.com` / apikey vazio no backend.
5. Senha EasyPanel vazou no chat — **rotacionar**; não vai para fixtures versionadas.

## Como rodar

```bash
# 1) UI rewrite já em testsprite_frontend_test_plan.json
# 2) Credenciais
set -a && source .env.mcp.local && set +a

# 3) Preview em :8081 (ou endpoint configurado no runner)
# 4) Re-run só IDs críticos:
#    TC001 TC002 TC003 TC007 TC008 TC010 TC013 TC016 + backend TC001

node scripts/run-testsprite-stage2.mjs   # ou full/max conforme necessidade
```

Dry-run reheat (sem envio):

```bash
# via edge com body { "dryRun": true } / preview — não ligar live_dispatch
```

Live allowlist (somente após gate deployado + secret):

```text
E2E_STRICT_OUTBOUND=true
E2E_OUTBOUND_ALLOWLIST=5511989000650,5511973125846
```

Depois: 1 mensagem curta / 1 tick controlado só nos 2 customers sandbox acima.

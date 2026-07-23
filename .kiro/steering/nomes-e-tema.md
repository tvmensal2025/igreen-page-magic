---
inclusion: auto
name: nomes-e-tema
description: Nome seguro do lead, nome público do consultor, tema light/dark. Use ao editar mensagens, TTS, templates, ThemeProvider ou UI de tema.
---

# Nomes e tema

## Lead — só chamar se digitou / confirmou

Na dúvida → **só o corpo** (sem "Olá Nome"). Com confiança → personaliza (`Oi Maria`).

**Fontes OK:** `self_introduced`, `user_confirmed`, `ocr_conta`, `ocr_doc`, `ocr_cnh`, `ocr_rg`, `ocr`, `manual`, `igreen_portal`

**Fontes NÃO (só corpo):** `whatsapp_profile`, `unknown`, `freeform_multi`, `cadence`, vazio

Helper: `supabase/functions/_shared/customer-display-name.ts`

| Export | Uso |
|---|---|
| `isUsableCustomerName` | texto parece pessoa? |
| `isAddressableNameSource` | fonte confiável? |
| `safeFirstNameForAddress` | prenome ou `""` |
| `safeFullNameForAddress` | nome curto ou `""` |
| `scrubEmptyNameGreeting` | remove "Oi {{nome}}" órfão |

Plugar: `renderTemplateVars({ name, name_source })`, `resolvePersonalizedCallAudio({ rawName, nameSource })`.

| name | name_source | Resultado |
|---|---|---|
| Maria Silva | self_introduced | "Oi Maria, …" |
| Marcus Medau | whatsapp_profile | só o corpo |
| Ixi Kkk / vazio | qualquer / unknown | só o corpo |

## Consultor — nunca slug, nunca outra pessoa

Mensagem ao lead = **só nome humano**. Na dúvida → `"seu consultor"` / `"iGreen"`.

Helper: `_shared/consultant-public-label.ts` · UI: `src/lib/consultantPublicLabel.ts`

| Export | Uso |
|---|---|
| `resolvePublicConsultantLabel` | label completo seguro |
| `resolvePublicConsultantFirstName` | prenome; slug → `""` |
| `isSlugLikeConsultantLabel` | detecta login |
| `looksHumanConsultantName` | nome humano? |
| `displayNameMatchesOwner` | display = mesma pessoa? |

```ts
// ERRADO: cons.display_name || cons.name
// CERTO:
resolvePublicConsultantLabel(cons.name, cons.display_name, "iGreen");
```

Slug (`silviaclaudiaalmeida`, `tvmensal12`) → fallback. Display de outra pessoa (sem overlap) → ignora display, usa `name`. Sem nome humano → cadastre `display_name` na aba Dados.

## Tema — light + dark (dual)

- `ThemeProvider`: `html.light` / `html.dark` + `color-scheme` + `localStorage` (`igreen-theme`).
- Só `light` \| `dark` (sem `system`). Default / FOUC = `"light"`.
- FOUC: `index.html` script síncrono lê `igreen-theme` antes do React. Toggle: `ThemeToggle` no `AppTopbar`.
- `.painel-elite`, `.ads-central-2026`, `.ads-wizard-scope` seguem `html.dark` (não forçar light-only).
- Academy: `useAC()` — não cravar `#111` no light. Sonner via `ThemeContext` (não `next-themes`). Preview WA pode ficar preto.

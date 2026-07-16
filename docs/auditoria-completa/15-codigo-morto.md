# 15 — Código morto e superfícies órfãs

**Data:** 2026-07-16  
**Método:** heurística (imports em `src/` vs `src/pages` e nomes de EFs). **Não** é prova definitiva de dead code — crons/webhooks legítimos não aparecem no front.

---

## 1. Páginas frontend

| Arquivo | Veredito |
|---|---|
| `AdminFaq.tsx` | **Vivo** — importado por `AdminKnowledge.tsx` (embedded) |
| `Index.tsx` | **Suspeito** — nenhum import `pages/Index` encontrado em `src/`; pode ser legado do template Vite |

**Ação:** confirmar rota em `App.tsx` / router; se órfão, marcar deprecated (não apagar sem pedido).

---

## 2. Edge Functions não mencionadas em `src/`

~58/195 EFs sem string do nome no front. Esperado para crons/webhooks.

### Candidatos a revisar (API/diagnóstico / experimento)

| EF | Por quê |
|---|---|
| `solar-hd-probe` | Diagnóstico temporário público (AUD-012) |
| `dev-fire-all-steps` | Dev — risco se deployado em prod |
| `bot-e2e-runner` / `bot-audit-runner` | Teste — deve ser dryRun / secret |
| `flow-simulate-reset` | Reset de fluxo — auth crítica |
| `spy-igreen-spa` | Nome sugere scraping/diagnóstico |
| `dump-igreen-detail` | Dump — dados sensíveis |
| `sim-upload-pdf` | Simulação |
| `facebook-diagnose-page` | Ops (OK se autenticado) |

### Falsos positivos comuns

`lead-intake`, `submit-otp`, `notify-partner-leads-batch`, OAuth callbacks Meta — usados por landing/worker/Meta, não pelo SPA.

---

## 3. Workers / experiments

- `experiments/solar-3d-ai/` — spike documentado; não é runtime prod.
- Duplicação bot-flow Evolution/Whapi: **vivo** (AUD-006), não morto.

---

## 4. Shared legado

- `_shared/voice-dialer/twilio.ts` — confirmar se ainda referenciado; se não, candidato a isolamento (não deletar).

---

## 5. Política (produção)

**Não apagar** arquivos nesta auditoria. Marcar, restringir auth/`verify_jwt`, ou feature-flag. Remoção só com pedido explícito + checklist de dependências.

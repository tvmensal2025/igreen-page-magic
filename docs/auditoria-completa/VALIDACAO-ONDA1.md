# Validação Onda 1 — Python + Context7

**Data:** 2026-07-16  
**Objetivo:** confirmar se a Onda 1 proposta está correta antes de alterar código.

---

## Método

1. **Python** — varredura estrutural dos arquivos citados em AUD-001…008.  
2. **Context7** — docs oficiais Supabase (Edge Functions `verify_jwt` / webhooks) e React Router 6 (guards).  
3. **Contraste interno** — padrões já usados no próprio repo (`voice-dialer-cron`, `SuperAdminRemoteSupport`, `assertCanContact`).

Artefato bruto: `/tmp/onda1-validation.json`

---

## Resultado por achado

| Achado | Evidência Python | Context7 / padrão oficial | Fix Onda 1 | Veredito |
|---|---|---|---|---|
| **AUD-001** | `reactivation-send` sem `assertCanContact`; selects sem `do_not_contact`; só `canSendProactive`. `reactivation-cron` filtra DNC. | N/A (regra de negócio) | Usar `assertCanContact` (já usado em `manual-step-send` / `start-customer-attendance`) | **CORRETO — fazer** |
| **AUD-002** | catch com comentário “se falhar, segue” | Fail-closed é alinhado ao backend `assertCanContact` (`lookup_error` → `allowed:false`) | Fail-closed no front | **CORRETO — fazer** |
| **AUD-003** | `SuperAdmin` gate `!isAdmin`; **não** usa `isSuperAdmin`. `RemoteSupport` **já** usa `isSuperAdmin`. Enum `app_role` = `admin\|user`; super é RPC separada. | RR6: redirect/Navigate por condição de auth/role é o padrão de guard | Trocar para `isSuperAdmin` | **CORRETO — fazer** (alinha página irmã) |
| **AUD-004** | healthcheck: `authConsultant` só se `campaign_id`; **sem** CRON/service secret. Irmãs Meta também fracas. `voice-dialer-cron` exige cron **ou** service secret (timing-safe) → 401 | Supabase: `verify_jwt=false` OK para cron/webhook **desde que** autentique no handler (secret/assinatura) | Exigir secret no modo cron, espelhando `voice-dialer-cron` | **CORRETO — fazer** (atualizar pg_cron header) |
| **AUD-007** | grace: `!ok` → só `console.warn`, **não** 401 | Docs: webhook externo = `verify_jwt=false` **+ verificar assinatura/secret no handler e rejeitar** | **Não** enforce agora | **CORRETO — diferir** (risco de matar inbound) |
| **AUD-008** | `WORKER_SECRET \|\| 'change-me'`; sem `process.exit` se default | Boas práticas: não aceitar secret default em prod | Abortar boot se ausente/`change-me` | **CORRETO — fazer** (confirmar env em prod antes do deploy) |
| **AUD-005/006** | — | Unificação ampla | Fora da Onda 1 | **CORRETO — diferir** |

---

## Context7 — o que a doc oficial confirma

### Supabase Edge Functions
- `verify_jwt = false` é **esperado** para webhooks/crons externos.
- A segurança deve ser **no handler**: assinatura do provedor ou shared secret; rejeitar com 4xx se falhar.
- Logo: AUD-007 (grace sem bloquear) **diverge** da orientação oficial — o achado é válido; a correção exige rollout cuidadoso (não flip cego).

### React Router 6
- Guards via condição + `Navigate`/`redirect` são o padrão.
- Trocar critério de role no gate do SuperAdmin é o padrão correto de autorização na UI (defesa em profundidade; RLS continua no banco).

---

## Nuances / cuidados antes de patch

1. **AUD-003:** se na prática só super_admins têm role `admin`, o bug é latente. Mesmo assim o fix é certo: `RemoteSupport` já usa `isSuperAdmin`.
2. **AUD-004:** após o patch, o job `pg_cron`/`net.http_post` precisa enviar o mesmo header secret — senão o cron para (regressão operacional, não de produto).
3. **AUD-008:** se algum ambiente EasyPanel ainda usa o default, o worker **não sobe** — isso é desejável; validar secret em prod antes do deploy.
4. **AUD-002:** fail-closed pode bloquear chat se a query DNC estiver quebrada — trade-off aceitável vs LGPD; mensagem de erro clara ao consultor.

---

## Conclusão

**A Onda 1 proposta está correta.** Ordem validada:

1. AUD-001 → 2. AUD-002 → 3. AUD-003 → 4. AUD-004 → 5. AUD-008  
**Não** incluir AUD-007 nesta onda.

Pronto para implementar quando autorizado.

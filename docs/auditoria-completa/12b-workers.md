# Workers Portal 2 e Club (Etapa 12) — evidências

**Data:** 2026-07-16  
**Arquivos:** `worker-portal-2/server.mjs`, `worker-club/server.mjs`  

---

## 1. Isolamento pretendido

| Aspecto | Portal 2 | Club |
|---|---|---|
| Porta default | 3101 | 3102 |
| Fila BullMQ | `portal-worker-2-leads` | `club-worker-leads` |
| Colunas DB | `portal2_*` | `club_*` apenas |
| dryRun default | (fluxo cadastro real no process) | **true** + `ALLOW_LIVE_CLUB_POST` |
| Doc | PORTAL-OFICIAL.md | CLUB-OFICIAL.md / APP-LINKS |

Comentário Club L2–3: *"Serviço INDEPENDENTE. Não usa Portal 2"*.  
Update Club: `updateCustomerClub` só patch `club_*` — **não** toca `portal2_*`.

---

## 2. Autenticação

Ambos:

```js
const SECRET = process.env.WORKER_SECRET || 'change-me';
// Bearer ${SECRET}
```

| Risco | Nota |
|---|---|
| Default `change-me` | Se deploy sem env, auth fraca — **AUD-008** |
| Comparação auth | `!==` string simples (não timing-safe) — P3 |
| Fallback Supabase key | Aceita `VITE_SUPABASE_PUBLISHABLE_KEY` se service role ausente — risco de worker sem permissão ou com chave errada |

---

## 3. Redis / filas

- Mesmo default `REDIS_URL=redis://evolution-api-redis:6379`.
- **Filas com nomes distintos** → não processam jobs um do outro.
- Risco: mesmo Redis compartilhado com Evolution — isolamento por nome de fila OK se secrets/ACLs forem iguais.

---

## 4. Controles Club (bons)

- `dryRun` default true.
- Live só com `ALLOW_LIVE_CLUB_POST=true` **e** `dryRun:false`.
- Retry: dryRun 1 attempt; live 3.

---

## 5. Portal 2 — pontos a aprofundar

- [ ] Idempotência de job / lock por customer_id  
- [ ] Heartbeat / job stuck recovery  
- [ ] Fechamento Playwright (`closeBrowser`) em todos os paths  
- [ ] Vazamento de OTP em logs  
- [ ] Separação WORKER_SECRET entre club e portal2 em produção  

---

## 6. worker-igreen-sync / compress

- Sync: legado Tor/Playwright, fila própria, não Club/Portal2.
- Compress: MinIO/multer — mídia.

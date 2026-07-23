---
inclusion: fileMatch
fileMatchPattern:
  - "worker-club/**"
  - "supabase/functions/finalize-club/**"
  - "supabase/functions/_shared/club-worker.ts"
  - "supabase/functions/_shared/clubValidation.ts"
  - "src/lib/clubCadastroUrl.ts"
---

# iGreen Club — fatos oficiais

Fonte: #[[file:worker-club/CLUB-OFICIAL.md]]  
Serviço **`worker-club` ≠ `worker-portal-2`**.

## Ouro
1. API `https://api.igreenenergy.com.br` — JWT `/auth/consultor` (não HMAC Portal)
2. PF: `POST /cliente/club` + máscaras + `uf_select` IBGE
3. PF = 2 passos; sem OCR/OTP/upload
4. Porta **3102**, fila `club-worker-leads`, colunas `club_*`
5. `ALLOW_LIVE_CLUB_POST=true`; `/submit-lead` default `dryRun:true`
6. `club_cadastro_url` = `https://club.igreenenergy.com.br/?id=<igreen_id>`
7. Edge: `finalize-club` → `dispatchClubWorker`

## Proibido
Misturar fluxo/HMAC do Portal; re-mapear API do zero; live sem dryRun consciente.

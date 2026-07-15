# Easypanel — subir **somente** o Worker Club

Guia para ativar o cadastro no **iGreen Club** (`club.igreenenergy.com.br`).

Este serviço **não** é o Portal 2. Não altere / não redeploye `worker-portal-2`.

| | Worker Club (este) | Portal 2 (não mexer) |
|---|---|---|
| Pasta | `/worker-club` | `/worker-portal-2` |
| Porta | **3102** | 3101 |
| Fila Redis | `club-worker-leads` | `portal-worker-2-leads` |
| API | `api.igreenenergy.com.br` | `api-green-connection…` |

---

## 1. Pré-requisitos (já feitos no banco)

Confirme no Supabase (projeto IGREEN):

- [x] Coluna `consultants.club_cadastro_url`
- [x] Colunas `customers.club_*` (status do job)
- [x] Seu link modelo: `https://club.igreenenergy.com.br/?id=124170`

Se faltar, rode as migrations:

- `20260715180000_worker_club_status_columns.sql`
- `20260715181000_consultant_club_cadastro_url.sql`

---

## 2. Criar o App no Easypanel

1. Abra o **mesmo projeto/rede** onde já rodam Redis e (se houver) o Portal 2.
2. **Create Service → App**
3. **Source → GitHub**
   - Owner: `tvmensal2025` (ou o dono atual do repo)
   - Repo: `igreen-page-magic`
   - Branch: `main` (ou a branch onde está o `worker-club/`)
4. **Build**
   - Build method: **Dockerfile**
   - **Docker Context / Build Path**: `/worker-club`  
     ⚠️ Não use a raiz do monorepo.
   - Dockerfile: `Dockerfile` (default)
5. **Port**: `3102`
6. **Domain** (opcional): ex. `worker-club.SEU.easypanel.host`
7. **Resources sugeridos**: 1 CPU / 1 GB RAM (Chromium)

### Healthcheck

- Path: `/health`
- Port: `3102`
- Já está no Dockerfile: `curl -f http://localhost:3102/health`

---

## 3. Variáveis de ambiente (só Club)

Cole no Easypanel → Environment:

```env
NODE_ENV=production
PORT=3102
HEADLESS=1

# Auth dos endpoints HTTP do worker
WORKER_SECRET=GERE_UM_SEGREDO_FORTE_AQUI

# Libera POST real no /cliente/club quando dryRun=false
ALLOW_LIVE_CLUB_POST=true

# Mesmo Redis da rede interna (NÃO cria fila do Portal 2)
REDIS_URL=redis://evolution-api-redis:6379

# Supabase (grava só club_* — opcional mas recomendado)
SUPABASE_URL=https://zlzasfhcxcznaprrragl.supabase.co
SUPABASE_SERVICE_ROLE_KEY=sua_service_role_key

# Consultor padrão (seu)
CLUB_DEFAULT_CONSULTOR=124170
```

### Se o Cloudflare bloquear o IP do servidor

Use o mesmo proxy residencial que o Portal usa nos probes (só neste serviço):

```env
CLUB_PROXY_SERVER=http://core-residential.evomi.com:1000
CLUB_PROXY_USER=seu_user
CLUB_PROXY_PASS=sua_senha
```

Sem proxy, teste primeiro: se `/health` sobe mas `probe:auth` / dry-run falha com CF, aí adiciona.

---

## 4. Rede

- Coloque o serviço na **mesma network** do Redis (`evolution-api-redis`).
- **Não** precisa apontar para o `worker-portal-2`.
- **Não** compartilhe `WORKER_SECRET` com o Portal 2 (pode ser o mesmo se quiser, mas preferível um secret só do Club).

---

## 5. Deploy e validação

1. **Deploy** / Rebuild
2. Abra: `https://SEU-DOMINIO/health`

Resposta esperada:

```json
{
  "ok": true,
  "service": "worker-club",
  "landing": "https://club.igreenenergy.com.br",
  "api": "https://api.igreenenergy.com.br",
  "allow_live_post": true,
  "dry_run_default": true
}
```

3. Teste **dry-run** (não cria cliente):

```bash
curl -s -X POST https://SEU-DOMINIO/submit-lead \
  -H "Authorization: Bearer $WORKER_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "dryRun": true,
    "dados": {
      "idconsultor": 124170,
      "cpf": "11144477735",
      "nome": "TESTE WORKER CLUB",
      "dtnasc": "01/01/1990",
      "rg": "123456789",
      "email": "teste.club@example.com",
      "celular": "11987654321",
      "cep": "01310100",
      "endereco": "Avenida Paulista",
      "numero": "100",
      "bairro": "Bela Vista",
      "cidade": "São Paulo",
      "uf": "SP"
    }
  }'
```

4. Cadastro **real** (só quando quiser):

```bash
# mesmo body, trocando:
"dryRun": false
```

Sem `dryRun: false`, o worker **nunca** posta no Club (default seguro).

---

## 6. Ativar “apenas o Club” no dia a dia

| Quer… | Faça |
|---|---|
| Só Club | Suba **só** este app (`worker-club`). Deixe Portal 2 como está. |
| Link do consultor | Painel → Dados → “Link iGreen Club” = `https://club.igreenenergy.com.br/?id=SEU_ID` |
| Cadastrar cliente | `POST /submit-lead` com `dados` + `dryRun:false` |
| Só simular | `dryRun:true` (default) |
| Pausar posts reais | `ALLOW_LIVE_CLUB_POST=false` e redeploy |

O bot / Portal 2 **não** chamam o Club automaticamente ainda. Ativação operacional = chamar este worker (CRM, script, ou integração futura).

---

## 7. Checklist pós-deploy

- [ ] `/health` → `service: worker-club`, `allow_live_post: true`
- [ ] `POST /preview-payload` monta CPF/CEP mascarados
- [ ] `POST /submit-lead` com `dryRun:true` → `wouldPost` / `dry_run_ok`
- [ ] Um cadastro real de teste com `dryRun:false` (CPF/e-mail de teste)
- [ ] Confirmou que **não** redeployou `worker-portal-2`

---

## 8. Troubleshooting

| Sintoma | Causa provável | Ação |
|---|---|---|
| Build falha no Playwright | deps Chromium | Dockerfile já instala; rebuild limpo |
| 403 / CF no dry-run | IP datacenter | configurar `CLUB_PROXY_*` |
| 401 no endpoint | secret errado | bater `WORKER_SECRET` no header Bearer |
| 403 `live_post_disabled` | env | `ALLOW_LIVE_CLUB_POST=true` |
| Fila some / modo sync | Redis | checar `REDIS_URL` e network |
| Portal energia parou | outro serviço | este app **não** mexe no Portal 2 |

---

## 9. Documentos oficiais

- `CLUB-OFICIAL.md` — API e payload (fonte da verdade)
- `README.md` — visão geral do worker
- Este arquivo — **só Easypanel / ativação Club**

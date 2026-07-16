# worker-club

Worker **independente** para cadastrar pessoas no **iGreen Club**
(`https://club.igreenenergy.com.br`).

Não é Portal 2. Não usa `api-green-connection`, HMAC, OCR, OTP nem colunas
`portal2_*`. Fila, porta e client próprios.

| | Worker Club | Portal 2 (outro serviço) |
|---|---|---|
| Landing | `club.igreenenergy.com.br` | `green…/autoconexao` |
| API | `api.igreenenergy.com.br` | `api-green-connection…` |
| Auth | JWT `/auth/consultor` | HMAC `x-frontend-*` |
| Porta | **3102** | 3101 |
| Fila Redis | `club-worker-leads` | `portal-worker-2-leads` |

## Fonte da verdade

- **[`CLUB-OFICIAL.md`](./CLUB-OFICIAL.md)** — API e fluxo (mapa oficial)
- **[`DADOS-OBRIGATORIOS.md`](./DADOS-OBRIGATORIOS.md)** — campos mínimos para cadastrar PF
- **[`APP-LINKS-CLIENTE.md`](./APP-LINKS-CLIENTE.md)** — Play Store / App Store para enviar ao cliente
- **[`EASYPANEL.md`](./EASYPANEL.md)** — deploy no Easypanel


## Stack

- Node 20 + Express
- BullMQ (Redis) — fila `club-worker-leads`
- Playwright Chromium (só tunnel TLS / Cloudflare)
- Supabase opcional — grava só `club_*`

## Endpoints

| Método | Path | Auth | Função |
|---|---|---|---|
| GET | `/health` | público | healthcheck |
| POST | `/preview-payload` | Bearer | monta body oficial sem API |
| POST | `/lookup-cep` | Bearer | ViaCEP + UF IBGE |
| POST | `/submit-lead` | Bearer | enfileira cadastro PF |
| GET | `/queue/status` | Bearer | contagem da fila |

`Authorization: Bearer ${WORKER_SECRET}`

## Segurança (produção)

- `dryRun: true` **por default** no `/submit-lead` (seguro para preview)
- POST real: enviar `dryRun: false` — worker com `ALLOW_LIVE_CLUB_POST=true`
- Sem envio automático de WhatsApp neste worker

## Variáveis de ambiente

```
PORT=3102
WORKER_SECRET=<segredo>
ALLOW_LIVE_CLUB_POST=true
REDIS_URL=redis://evolution-api-redis:6379
SUPABASE_URL=…
SUPABASE_SERVICE_ROLE_KEY=…
CLUB_DEFAULT_CONSULTOR=124170
# Opcional se CF bloquear datacenter:
CLUB_PROXY_SERVER=http://host:port
CLUB_PROXY_USER=
CLUB_PROXY_PASS=
```

## Uso

```bash
# Preview (sem rede Club)
curl -s -X POST http://localhost:3102/preview-payload \
  -H "Authorization: Bearer $WORKER_SECRET" \
  -H 'Content-Type: application/json' \
  -d '{
    "dados": {
      "idconsultor": 124170,
      "cpf": "11144477735",
      "nome": "Nome Completo Teste",
      "dtnasc": "01/01/1990",
      "rg": "123456789",
      "email": "cliente@example.com",
      "celular": "11987654321",
      "cep": "01310100",
      "endereco": "Avenida Paulista",
      "numero": "100",
      "bairro": "Bela Vista",
      "cidade": "São Paulo",
      "uf": "SP"
    }
  }'

# Dry-run (auth real, NÃO posta cadastro)
curl -s -X POST http://localhost:3102/submit-lead \
  -H "Authorization: Bearer $WORKER_SECRET" \
  -H 'Content-Type: application/json' \
  -d '{ "dryRun": true, "dados": { …mesmo… } }'
```

`customer_id` é **opcional** e só atualiza colunas `club_*` — o body `dados`
é sempre obrigatório (este worker não monta ficha a partir do Portal).

## Easypanel

**Guia completo:** [`EASYPANEL.md`](./EASYPANEL.md) (só Club — não mexe no Portal 2).

Resumo:

1. App Docker, **build path** `/worker-club`, porta **3102**
2. Env: `WORKER_SECRET`, `ALLOW_LIVE_CLUB_POST=true`, `REDIS_URL`, `SUPABASE_*`
3. Health: `GET /health`
4. Validar com `dryRun:true` antes de `dryRun:false`

## Dev local

```bash
cd worker-club
npm install
npm test
npm run probe:auth    # login + planos (precisa CF/proxy ok)
npm run dryrun        # payload + auth, sem POST
npm start
```

## Migration

`supabase/migrations/20260715180000_worker_club_status_columns.sql`
→ colunas `club_status`, `club_error`, `club_payload`, …

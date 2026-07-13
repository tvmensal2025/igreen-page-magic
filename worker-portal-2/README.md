# worker-portal-2

Worker dedicado ao **Portal 2** (`https://green.igreenenergy.com.br/autoconexao`).

Diferente do `worker-portal` original (que automatiza UI clicando passo a passo
com Playwright), este chama a **API direta** com HMAC-SHA256, usando Playwright
apenas como "tunnel TLS" pra passar pelo Cloudflare.

**Performance**: 1ª chamada ~5s (boot + CF challenge), demais 40-800ms.
Comparado ao Playwright original (30-60s por cadastro).

## Stack

- Node 20 + Express
- BullMQ (Redis) pra fila persistente
- Playwright Chromium (singleton, só TLS tunnel)
- Supabase pra estado dos leads

## Endpoints

| Método | Path | Auth | Função |
|---|---|---|---|
| GET | `/health` | público | healthcheck |
| POST | `/submit-lead` | Bearer | enfileira lead pra cadastrar |
| POST | `/confirm-otp` | Bearer | valida código OTP |
| GET | `/lead/:idcliente/status` | Bearer | status (OTP + contrato) |
| GET | `/queue/status` | Bearer | contagem de jobs na fila |

Todos requests autenticados precisam de header `Authorization: Bearer ${WORKER_SECRET}`.

## Variáveis de ambiente

```
PORT=3101                                # porta HTTP
WORKER_SECRET=<segredo-bearer>           # auth dos endpoints
REDIS_URL=redis://evolution-api-redis:6379
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-key>
HEADLESS=1                               # já default
NODE_ENV=production
```

## Como subir no Easypanel

Criar novo serviço com:

1. **Tipo**: App (Docker build)
2. **Source**: GitHub
   - **Proprietário**: `tvmensal2025`
   - **Repositório**: `igreen-page-magic`
   - **Ramo**: `main`
3. **Build path**: `/worker-portal-2`
4. **Dockerfile**: `Dockerfile` (default)
5. **Porta**: 3101
6. **Env vars**: as listadas acima — copiar `WORKER_SECRET` do `worker-portal` original ou gerar novo
7. **Healthcheck**: `GET /health` (já está no Dockerfile)
8. **Network**: mesma do `worker-portal` original (pra acessar Redis e Postgres internos)
9. **Recursos sugeridos**: 1 CPU / 1 GB RAM (Chromium consome)

Não compartilha estado com o `worker-portal` original — tem fila própria
(`portal-worker-2-leads`) e endpoints separados. Pode rodar em paralelo
sem conflito.

## Uso (cliente)

```bash
# Submeter lead
curl -X POST https://worker-portal-2.SEU.easypanel.host/submit-lead \
  -H 'Authorization: Bearer SEU_SECRET' \
  -H 'Content-Type: application/json' \
  -d '{
    "customer_id": "uuid-do-customer-no-supabase",
    "dados": {
      "idconsultor": 124170,
      "indcli": 1110798,
      "cpf": "11144477735",
      "nome": "Lucas Henrique Moreira",
      "dataNascimento": "15/08/1992",
      "whatsapp": "11999887766",
      "email": "cliente@example.com",
      "cep": "13323-072",
      "endereco": "Rua Cabreúva",
      "numero": "100",
      "complemento": "Apto 1",
      "bairro": "Jardim da Cidade II",
      "cidade": "Salto",
      "uf": "SP",
      "numeroInstalacao": "9999999991",
      "consumoMedio": 350,
      "sendcontract": true
    }
  }'
```

Resposta:
```json
{ "ok": true, "queued": true, "job_id": "1" }
```

Depois cliente recebe SMS com OTP. Frontend envia:
```bash
curl -X POST .../confirm-otp \
  -H 'Authorization: Bearer SEU_SECRET' \
  -d '{"idconsultor": 124170, "idcliente": 1501853, "code": "123456"}'
```

## Schema do banco (sugestão de migration)

```sql
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS portal2_idcliente bigint,
  ADD COLUMN IF NOT EXISTS portal2_idsolcontratovalidacao bigint,
  ADD COLUMN IF NOT EXISTS portal2_status text,
  ADD COLUMN IF NOT EXISTS portal2_error text,
  ADD COLUMN IF NOT EXISTS portal2_created_at timestamptz;
```

## Como o cliente decide qual portal usar

No app/CRM, `consultant.portal_kind`:
- `'digital'` (default) → roteia pro `worker-portal` original
- `'autoconexao'` → roteia pro `worker-portal-2`

Migração consultor por consultor, sem risco no Portal 1.

## Documentação técnica

**`PORTAL-OFICIAL.md` (nesta pasta) — FONTE DA VERDADE** do portal oficial:
endpoints, shapes, gates (regra `fz` de legibilidade, `is_authentic`),
semântica de `contaunica`, armadilhas históricas e como revalidar.
**Ler antes de mexer no fluxo de cadastro.**

Docs complementares (históricos, com avisos de atualização no topo):
- `docs/portal-api/PORTAL2_API_COMPLETO.md` — API completa, HMAC, payload
- `docs/portal-api/PORTAL2_FLUXO_CANONICO.md` — trace canônico do worker
- `docs/portal-api/PORTAL2_EXTRACTOR_VEREDITO.md` — shapes dos extractors

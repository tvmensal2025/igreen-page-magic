# Cloudflare Worker Proxy — Setup (5 minutos, gratuito)

## Por que isso funciona?

O Cloudflare WAF bloqueia IPs de datacenter (VPS, GitHub Actions).
Mas requests **de dentro do Cloudflare** (Workers) são tratados como confiáveis.

## Passo 1 — Criar o Worker

1. Acesse: https://dash.cloudflare.com/workers
2. Clique em **Create Worker**
3. Cole o conteúdo do arquivo `cf-proxy-worker.js`
4. **IMPORTANTE:** mude `PROXY_SECRET` para um segredo longo (ex: `openssl rand -hex 32`)
5. Clique em **Deploy**
6. Copie a URL do worker (ex: `https://igreen-proxy.SEU-USUARIO.workers.dev`)

## Passo 2 — Configurar no Supabase

```sql
INSERT INTO public.settings (key, value) VALUES
  ('cf_worker_proxy_url', 'https://igreen-proxy.SEU-USUARIO.workers.dev'),
  ('cf_worker_proxy_secret', 'SEU_SEGREDO_AQUI')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
```

## Passo 3 — Configurar no Easypanel

Adicionar env vars no app `worker-igreen`:
```
CF_PROXY_URL=https://igreen-proxy.SEU-USUARIO.workers.dev
CF_PROXY_SECRET=SEU_SEGREDO_AQUI
```

## Limites do plano gratuito

- 100.000 requests/dia
- Para 500 consultores × 10 requests/sync = 5.000 requests/sync
- Permite ~20 syncs completos por dia no plano gratuito
- Mais que suficiente para 1 sync diário automático

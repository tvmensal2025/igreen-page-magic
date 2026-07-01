# Plano — Rodar tudo que a API iGreen aceita e listar

## Objetivo
Descobrir de forma **empírica** (sem chutar) quais endpoints da API `https://api-vo.igreenenergy.com.br/v1` respondem para a sessão do usuário `rafael.ids@icloud.com`, listar todos que aceitam (HTTP 200) e usar isso como fonte-da-verdade para atualizar o `worker-igreen-sync`.

## Por que agora é possível
- Já confirmamos que `POST /v1/auth/session` retorna 201 e emite JWT válido.
- Já confirmamos os 6 endpoints extraídos do bundle carregado do SPA:
  - `POST /auth/session`, `POST /auth/recaptcha`
  - `GET /consultant`, `GET /consultant/activation-code`
  - `GET /dashboard/daily-analysis`, `GET /dashboard/customers-by-region`
- A base URL da API (`api-vo.igreenenergy.com.br`) **não** está sob a WAF que bloqueia `/painel` no host `escritorio.*` — chamadas diretas de servidor passam.

## Etapas

### 1. Coleta de candidatos (fonte controlada, sem invenção)
Fontes que serão unidas em uma única lista:
- 6 endpoints extraídos do bundle real do SPA (confirmados).
- 78 rotas e nomes de chunks Vite já listados em `/tmp/browser/igreen-discover/chunks.json` — cada chunk (`ClientesGreenPage`, `RotinasPage`, `CrmPage`, `RedePage`, `FinanceiroLicenciadoPage`, `SegurosPage`, `TelecomPage`, etc.) implica um conjunto de endpoints REST associado ao seu nome.
- Endpoints que o `worker-igreen-sync/server.mjs` atual já usa em produção (histórico do repositório).
- Registry central de endpoints usado na v16 do worker.

### 2. Probe autenticado no worker (Node, não Playwright)
Rodar em `worker-igreen-sync`:
- Login uma vez → JWT.
- Para cada candidato: `GET`/`POST` com header `Authorization: Bearer <jwt>`, timeout 10s, sem retry.
- Registrar por candidato: `status`, `content-type`, `bytes`, primeiros 300 chars do body (para diagnóstico), tempo em ms.
- Classificar em 4 baldes:
  - `ok_200_json`
  - `ok_204`
  - `denied` (401/403)
  - `not_found` (404)
  - `bad_request` (400/422) — sinaliza que precisa de parâmetro; salvar mensagem para próxima iteração.
  - `error_5xx` (marcar para retry único em outra rodada).

### 3. Persistência dos resultados
Criar tabela `igreen_endpoint_discovery` (Supabase):
- `path`, `method`, `status`, `content_type`, `bytes`, `sample_body`, `notes`, `checked_at`, `is_alive` (bool).
- Grants padrão + RLS: leitura só para admins autenticados; escrita só via `service_role` (worker).

### 4. Relatório visível
- Escrever `/mnt/documents/igreen-endpoints-alive.md` com a lista final agrupada por área (Auth, Consultant, Dashboard, Clientes Green, Telecom, Seguros, Rede, Financeiro, Rotinas, CRM, Digital), mostrando shape resumido de cada resposta.
- Aba `Diagnóstico` no `CarteiraGreenPanel.tsx` que lê `igreen_endpoint_discovery` e mostra semáforo verde/amarelo/vermelho por endpoint, com data da última verificação e botão "Reexecutar probe".

### 5. Atualizar o worker com base no que passou
- Só depois do probe: reescrever o registry central do `worker-igreen-sync/server.mjs` incluindo apenas os endpoints classificados como `ok_200_json` ou `ok_204`.
- Endpoints em `bad_request` viram TODOs com a mensagem do servidor (ex.: "campo `mes` obrigatório").
- `sync-all` passa a chamar somente endpoints vivos, com `Promise.allSettled`, e grava resultado por endpoint em `worker_phase_logs` (que já existe).

## Detalhes técnicos

### Nova Edge Function `igreen-endpoint-probe`
- Entrada: `{portal_email, portal_password}` (ou usa segredos já salvos).
- Faz login, roda probe da lista consolidada, persiste em `igreen_endpoint_discovery`.
- Retorna resumo `{alive: N, denied: N, missing: N, total: N}`.
- Timeout global: dispara em background via `EdgeRuntime.waitUntil` e responde imediatamente para não estourar 150s.

### Migration
```sql
CREATE TABLE public.igreen_endpoint_discovery (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  path TEXT NOT NULL,
  method TEXT NOT NULL,
  status INT,
  content_type TEXT,
  bytes INT,
  sample_body TEXT,
  is_alive BOOLEAN NOT NULL DEFAULT false,
  category TEXT,
  notes TEXT,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (method, path)
);
GRANT SELECT ON public.igreen_endpoint_discovery TO authenticated;
GRANT ALL ON public.igreen_endpoint_discovery TO service_role;
ALTER TABLE public.igreen_endpoint_discovery ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read discovery" ON public.igreen_endpoint_discovery
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
```

### Fluxo do probe (pseudocódigo)
```text
login -> jwt
for cand in candidates:
  res = fetch(base+cand.path, {method: cand.method, headers:{Authorization}})
  save row(cand, res)
summary = agg by status
```

## Segurança
- Sem chutar payloads em POST/PUT/DELETE nesta fase — probe faz apenas `GET` para candidatos desconhecidos; `POST` só nos já confirmados (auth).
- Credenciais do portal ficam em `IGREEN_PORTAL_EMAIL` / `IGREEN_PORTAL_PASSWORD` (segredos já existentes; se não, `add_secret` antes de rodar).
- Nada de gravar `sample_body` de endpoints de auth (filtro para não persistir JWT).

## Entregáveis
1. Migration `igreen_endpoint_discovery`.
2. Edge Function `igreen-endpoint-probe`.
3. Atualização do `worker-igreen-sync/server.mjs` com endpoint `POST /probe-all` que retorna o JSON completo.
4. Aba `Diagnóstico` no `CarteiraGreenPanel` com semáforo.
5. Relatório `/mnt/documents/igreen-endpoints-alive.md`.

## Sem quebrar nada
- Nada existente é removido. O registry atual do worker continua ativo; a nova rota `/probe-all` é aditiva.
- A reescrita do `sync-all` só entra num PR seguinte, depois de você ver a lista viva e aprovar.

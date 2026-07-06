## Objetivo

Rodar recon completo com rafael.ids (124170) e voltar com catálogo REAL de rotas para acabar com esse loop.

## Mudanças

### 1. `IGreenBulkSyncPanel.tsx`

Remover credenciais hardcoded. Passar apenas o email do rafael para a edge resolver a senha do banco:

```ts
body: { portal_email: "rafael.ids@icloud.com" }
```

### 2. `supabase/functions/recon-igreen-endpoints/index.ts`

- Aceitar `portal_email` sem `portal_password` → busca senha em `consultants.igreen_portal_password` pelo email.
- Se não achar por email, cair no fallback atual (primeiro consultor com credenciais).
- Guarda anti-lockout: se última chamada foi < 3 min, retornar 429 com "aguarde X segundos".
- Timeout do fetch: 10 min (recon navega ~40 rotas + 12 meses de network-map, pode passar de 8 min).

### 3. Após o recon voltar OK

Com o catálogo em mãos (persistido em `igreen_endpoint_discovery` bucket `portal_recon`), na próxima mensagem eu:

- Rescrevo `collectFullExtras` no `worker-igreen-sync/server.mjs` com endpoints REAIS.
- Crio migrations para tabelas faltantes (`igreen_green_faturas`, `igreen_green_injecao`, `igreen_telecom_recargas`, `igreen_telecom_bonus`, `igreen_telecom_portabilidade`, `igreen_seguros_sinistros`, `igreen_seguros_renovacoes`, `igreen_seguros_cashback`, etc.) com GRANT + RLS.
- Atualizo `sync-igreen-customers` para registrar `saved/total/gap` por rota em `igreen_sync_runs.details`.

## Pré-requisito (você já fez? confirmar)

Worker v19 tem que estar rodando. Se `docker logs igreen-sync-worker` não mostrar `v19 (tor+playwright+api-vo, recon-endpoints)`, o botão vai continuar dando 404. Só posso avançar depois do redeploy.

## Confirma?

Só clico e sigo. Sem mais perguntas. sim  
NAO PODE FICAR NADA DE FORA  
[https://escritorio.igreenenergy.com.br/clientes-green](https://escritorio.igreenenergy.com.br/clientes-green)  
[https://escritorio.igreenenergy.com.br/produtos/telecom](https://escritorio.igreenenergy.com.br/produtos/telecom)  
[https://escritorio.igreenenergy.com.br/seguros](https://escritorio.igreenenergy.com.br/seguros)  
[https://escritorio.igreenenergy.com.br/rede-lider](https://escritorio.igreenenergy.com.br/rede-lider)  
[https://escritorio.igreenenergy.com.br/rotinas](https://escritorio.igreenenergy.com.br/rotinas)  
  
LEIA TODA A ESTRUTURA NAO DEIXE NADA DE FORA
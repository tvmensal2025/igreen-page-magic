# Mapeamento do portal iGreen via Playwright (sem chutar endpoints)

## Mudança de estratégia

Nada de `PROBE_ALLOWLIST` com paths inventados. Em vez disso, **entro no portal de verdade com Playwright, navego em cada menu como um usuário faria, e capturo as chamadas de rede reais** que o próprio front do iGreen dispara. Só entra na v17 do worker aquilo que o próprio portal usa.

## Como funciona a descoberta

Script Playwright local (`worker-igreen-sync/discover.mjs`) que roda 1x:

1. Login em `https://escritorio.igreenenergy.com.br/login` via Tor com as credenciais do usuário (`rafael.ids@icloud.com`).
2. Instala `page.on('request')` e `page.on('response')` **antes** de qualquer navegação. Filtra só `api-vo.igreenenergy.com.br`.
3. Para cada request/response captura: `method`, `url` (path + query), `status`, `request_headers` relevantes, `response_shape` (primeiras 2 chaves + tipo de cada campo do primeiro item se for array).
4. Navega automaticamente pelos menus do portal:
  - Dashboard / Painel
  - Clientes → Green, Telecom, Seguros, Expansão (cada aba e cada coluna do Kanban)
  - Um cliente aberto no detalhe (Green + Telecom + Seguros)
  - Rede / Network Map (com troca de mês)
  - Financeiro / Extrato / Saques / Notas Fiscais (se existir no menu)
  - Rotinas (diária, semanal, mensal)
  - Devolutivas (ativas + histórico se houver)
  - Boletos / Faturas
  - Cashback / Comissões (Green, Telecom, Seguros)
  - Qualquer outro item de menu não catalogado — abre e observa.
5. Salva o inventário em `/tmp/igreen-endpoints.json` **e** grava em `worker_phase_logs` (uma linha por endpoint com `sample`).
6. Faz screenshot de cada tela + salva o HTML para eu ter contexto visual do que cada endpoint alimenta.

## Entregável da descoberta

Um único arquivo `docs/igreen-endpoints-map.md` gerado a partir do JSON com:

- Path exato + método + params obrigatórios (deduzidos das query strings observadas)
- Shape real do response (campos + tipos)
- Qual tela do portal usa cada endpoint (pra saber o que é "carteira", o que é "dashboard", o que é "detalhe")
- Status (200 real, 4xx real) — não achismo

## Só depois da descoberta: reescrita do worker (v17)

Com o mapa em mãos, reescrevo `server.mjs` como planejado antes:

- Registry central `ENDPOINTS` populado só com paths **observados no portal**.
- `safeCall` wrapper: nenhum endpoint derruba o `sync-all`.
- `Promise.allSettled` + bloco `_diagnostics` no response.
- `fetchCashback` sem SEGUROS (a menos que a descoberta mostre um path real).
- `enrichCustomerRich` puxando campos ricos do detalhe do cliente e devolvendo-os no array.
- Novos blocos (Telecom Linhas, Seguros Comissões, Financeiro, Rede Qualificações) **só entram se o portal os expuser**.

## Migration + edge + UI

Depois do worker rodar e trazer dados reais:

- Migration aditiva com colunas/tabelas para os blocos confirmados.
- Edge `sync-igreen-customers` consome `_diagnostics` e grava em `worker_phase_logs`.
- Aba "Diagnóstico" no `CarteiraGreenPanel` mostrando verde/vermelho por endpoint.

## Ordem de execução

1. **Descoberta** — escrevo e rodo `discover.mjs` no sandbox via Playwright (Tor + credenciais). Output: JSON + markdown + screenshots.
2. Você revisa o mapa e valida se cobri tudo (ou pede pra abrir menus que faltaram).
3. Reescrevo `server.mjs` com base 100% no observado.
4. Migration + edge + UI de diagnóstico.

## Riscos e cuidados

- **Credenciais**: uso as suas (`rafael.ids@icloud.com`) só dentro do script, jamais logo/exponho.
- **Tor**: portal exige (CF bloqueia datacenter). Sandbox tem network egress; se Tor não subir no sandbox, rodo direto (o script vai reportar CF 403 se bloquear).
- **Zero impacto** no fluxo D/WhatsApp/portal-worker.
- `**.lovable/**` está no `.gitignore` — este plano não persiste no próximo snapshot.

## O que preciso de você

Só confirmar que posso rodar a descoberta agora com as credenciais que você já mandou antes. Ao aprovar o plano, começo por `discover.mjs`.  
  
PODE RODAR
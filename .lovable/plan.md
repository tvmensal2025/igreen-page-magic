# Enriquecimento de clientes via API do Escritório Oficial

Fonte: `https://escritorio.igreenenergy.com.br` (API `api-vo.igreenenergy.com.br/v1`) — mesma que o worker `worker-igreen-sync` já usa. Sem tocar em `worker-portal-2`.

## Estado atual
- Fase 2 antiga (via `worker-portal-2`) já foi revertida.
- Fase 1 (colunas no banco: endereço, PJ, procurador, `signature_summary`, `otp_status`, `document_verify`, `last_enriched_at`, etc.) permanece intacta.
- `worker-igreen-sync` já tem rota `POST /probe-customer-detail` implementada (12 candidatos de endpoint).

## Campos-alvo (confirmados no modal do escritório)
Situação, Licenciado responsável, Fornecedora, Distribuidora, Conta, Titularidade, Instalação, Consumo médio, Ativo desde, CPF/CNPJ, Data de nascimento, Email, Telefone, Cidade/UF, além dos boletos (já sincronizados por outra rota).

---

## Fase A — Descoberta do endpoint (probe)

1. Deploy do `worker-igreen-sync` na VPS (rota `/probe-customer-detail` já commitada).
2. Rodar via curl com um `consultant_id` aprovado e um `idcliente` real (ex.: 1117549 - SANDRA).
3. Analisar resposta: identificar qual dos 12 candidatos retorna status 200 com o payload completo.
4. Registrar em `docs/portal-api/ESCRITORIO_API_MAP.md` o endpoint vencedor + shape do JSON + mapa `campo API → coluna DB`.

Entregável: endpoint definitivo + mapeamento de campos.

## Fase B — Fetch de detalhe no worker

- Adicionar `fetchCustomerDetail(session, idcliente)` em `worker-igreen-sync/server.mjs` usando o endpoint da Fase A.
- Adicionar `POST /enrich-customer-batch { consultant_id, ids: string[] }` com concorrência 3, retornando `{ ok, results: [{ id, mapped, raw_size, error? }] }`.
- Mapeamento (`mapDetailToColumns`): normaliza para as colunas já existentes da Fase 1 (endereço, concessionária/fornecedora, PJ, procurador, flags, `signature_summary`, `otp_status`, `document_verify`).

## Fase C — Edge function `sync-igreen-customers` (modo enrich)

- Reintroduzir bloco `ENRICH MODE`, mas chamando `worker-igreen-sync` (não Portal2).
- Seleção por `igreen_code` (não `portal2_idcliente`).
- Parâmetros: `mode: "enrich"`, `enrichCustomerIds?: string[]`, `enrichLimit?: number` (default 50).
- Persistir campos + `last_enriched_at = now()`.

## Fase D — UI (admin customer card)

- 4 blocos: **Endereço completo**, **Concessionária/Fornecedora**, **Dados PJ/Procurador**, **Status contratuais** (assinatura, OTP, docs).
- Botão "Enriquecer agora" (cliente único) e "Enriquecer todos pendentes" (bulk, top-nav).
- Chip com timestamp `last_enriched_at`.

## Fase E — Automação

- Cron noturno via `pg_cron` + `pg_net`: `mode: enrich, limit: 200` por consultor aprovado.
- Trigger em `INSERT` de novo `igreen_code` para enriquecer imediatamente (via `pg_net`).

---

## Fora de escopo (não tocar)
`worker-portal-2`, `Portal2Client`, cadastro, OTP, contratos, `sync-portal2-*`.

## Próximo passo imediato
Você (usuário) precisa fazer o **deploy do `worker-igreen-sync` na VPS** e rodar:

```bash
curl -X POST https://<worker-url>/probe-customer-detail \
  -H "Content-Type: application/json" \
  -d '{"consultant_id":"<uuid>","sample_idcliente":"1117549"}'
```

Cole aqui a resposta JSON → sigo direto para Fase B com o endpoint certo.

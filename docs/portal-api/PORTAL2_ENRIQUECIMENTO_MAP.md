# Portal 2 — Mapa de Enriquecimento (Fase 0)

**Objetivo:** listar campo-a-campo o que a API `api-green-connection.igreenenergy.com.br` devolve por cliente, comparar com a coluna correspondente em `public.customers`, e destacar o que hoje fica vazio.

**Fonte dos endpoints:** `worker-portal-2/portal2-api-client.mjs` e `docs/portal-api/PORTAL2_API_COMPLETO.md`.
**Sync atual:** `supabase/functions/sync-igreen-customers/index.ts` (raspa só a lista — nunca chama detalhe).

---

## 1) `GET /customers/{idcliente}` — detalhe completo

Endpoint que **já está implementado** no client (`getCustomer`) mas **nunca é chamado** pelo sync. É de longe a maior fonte de enriquecimento.

| Campo do portal | Coluna em `customers` | Existe? | Sync atual preenche? | Ação |
|---|---|---|---|---|
| `nome` | `name` | ✅ | ✅ (lista) | manter |
| `cpf_cnpj` | `cpf` | ✅ | ✅ | manter |
| `dtnasc` | `data_nascimento` / `data_nascimento_iso` | ✅ | ✅ | manter |
| `celular` | `phone_whatsapp` / `portal2_celular_alt` | ✅ | ✅ | manter; alt em `portal2_celular_alt` |
| `email` | `email` | ✅ | ✅ | manter |
| `cep` | `cep` | ✅ | ❌ | **enriquecer** |
| `endereco` | `address_street` | ✅ | ❌ | **enriquecer** |
| `numero` | `address_number` | ✅ | ❌ | **enriquecer** |
| `complemento` | `address_complement` | ✅ | ❌ | **enriquecer** |
| `bairro` | `address_neighborhood` | ✅ | ❌ | **enriquecer** |
| `cidade` | `address_city` | ✅ | ✅ | manter |
| `uf` | `address_state` | ✅ | ✅ | manter |
| `numinstalacao` | `numero_instalacao` | ✅ | ✅ (lista) | manter |
| `num_cliente_distribuidora` | `num_cliente_distribuidora` | ✅ | parcial (só via boletos) | **enriquecer** |
| `concessionaria` | `concessionaria` | ✅ | ❌ (só `distribuidora`) | **enriquecer** |
| `fornecedora` | `fornecedora` | ✅ | ❌ | **enriquecer** |
| `consumomedio` | `media_consumo` | ✅ | ✅ | manter |
| `desconto_cliente` | `desconto_cliente` | ✅ | ✅ | manter |
| `possui_placas` | `possui_placas` | ✅ | ❌ | **enriquecer** |
| `contaunica` | `contaunica` | ✅ | ❌ | **enriquecer** |
| `transferir_titularidade` | `transferir_titularidade` | ✅ | ❌ | **enriquecer** |
| `logindistribuidora` | `logindistribuidora` | ✅ | ❌ | **enriquecer** (sensível — ver §5) |
| `senhadistribuidora` | `senhadistribuidora` | ✅ | ❌ | **enriquecer** (sensível — ver §5) |
| `indcli` | `customer_referred_by_consultant_id` (indireto) | ✅ | parcial | **enriquecer** — resolve via `/customers/indicator/{id}` |
| **PJ:** `cnpj, razao, fantasia, naturezajuridica, cargo, ie, localregistro` | `pj_jsonb` (jsonb agregado) | ✅ | ❌ | **enriquecer** (dump completo no jsonb) |
| **Procurador:** `testemunha_nome, cpf, datanasc, email, celular` | `procurador_jsonb` | ✅ | ❌ | **enriquecer**; setar `possui_procurador=true` |

**Conclusão §1:** 15+ campos hoje sempre vazios. **Nenhuma coluna nova necessária** — a tabela já foi provisionada para receber tudo isso.

---

## 2) `GET /customers/{id}/signature-summary`

Resumo detalhado das duas assinaturas (cliente vs iGreen), com timestamps individuais.

| Campo | Coluna hoje | Existe? | Ação |
|---|---|---|---|
| status cliente | `assinatura_cliente_status` | ✅ | **enriquecer** |
| status iGreen | `assinatura_igreen_status` | ✅ | **enriquecer** |
| payload completo (timestamps, hashes) | — | ❌ | **criar `signature_summary JSONB`** |

---

## 3) `GET /contracts/customer/{id}/generated` e `/signed`

| Campo | Coluna hoje | Ação |
|---|---|---|
| `linkassinatura` (contrato gerado) | `portal2_contract_link` ✅ / `link_assinatura` ✅ | **enriquecer** — hoje só é setado no cadastro |
| `hasSignature` (booleano do /signed) | — | derivar em `assinatura_cliente_status` |
| status/timestamps de geração | — | opcional — pode ir no `signature_summary` do §2 |

---

## 4) `GET /verification-codes/status/{id}`

Estado do OTP: `pending | completed | failure | expired | used`.

| Campo | Coluna hoje | Existe? | Ação |
|---|---|---|---|
| `status` do OTP | — | ❌ | **criar `otp_status TEXT`** |
| timestamp da última mudança | `portal2_otp_sent_at` / `portal2_otp_validated_at` | ✅ (parciais) | **criar `otp_status_checked_at TIMESTAMPTZ`** |

---

## 5) `GET /file-upload/verify/{id}` — validação de docs pela IA

Hoje o worker roda o extractor no cadastro mas descarta a resposta detalhada (ver `PORTAL2_EXTRACTOR_VEREDITO.md`). No enriquecimento, essa chamada dá o **veredito atual** do documento no portal.

| Campo | Coluna hoje | Existe? | Ação |
|---|---|---|---|
| status agregado (aprovado/reprovado/pendente) | — | ❌ | **criar `document_verify_status TEXT`** |
| timestamp | — | ❌ | **criar `document_verify_at TIMESTAMPTZ`** |
| payload cru (tipo doc, validade, correções) | `portal2_ocr_doc_result` | ✅ | reaproveitar (merge) |

---

## 6) Extras já suportados que NÃO precisam de enriquecimento por API

- Boletos → tabela `igreen_customer_boletos` já sincroniza.
- Devolutivas → tabela `igreen_customer_devolutivas` já sincroniza.
- Cashback / nível / andamento → vem na lista.
- Telecom/seguros iGreen → tabelas dedicadas.

---

## 7) Colunas novas a criar (Fase 1)

Apenas **6 colunas** — a maior parte do enriquecimento cabe nas colunas existentes.

```sql
ALTER TABLE public.customers
  ADD COLUMN signature_summary          JSONB,
  ADD COLUMN otp_status                 TEXT,
  ADD COLUMN otp_status_checked_at      TIMESTAMPTZ,
  ADD COLUMN document_verify_status     TEXT,
  ADD COLUMN document_verify_at         TIMESTAMPTZ,
  ADD COLUMN last_enriched_at           TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS customers_last_enriched_at_idx
  ON public.customers (last_enriched_at NULLS FIRST)
  WHERE portal2_idcliente IS NOT NULL;
```

O índice parcial serve pro cron da Fase 4 (varrer quem tem `idcliente` iGreen e nunca foi enriquecido).

---

## 8) Sensibilidade / segurança

- `logindistribuidora` e `senhadistribuidora` são credenciais da concessionária do cliente. Já existem colunas TEXT, mas recomendo:
  - Nunca expor na UI padrão (só em bloco "avançado" pra admin).
  - Não sincronizar `senhadistribuidora` sem explicit opt-in — decisão do usuário na Fase 2.
- `pj_jsonb` e `procurador_jsonb`: nada novo do ponto de vista de LGPD (já coletamos no cadastro).

---

## 9) Custo estimado

- Worker Playwright: ~500ms por chamada `_fetch` (após boot).
- 5 chamadas por cliente enriquecido (`getCustomer` + `signature-summary` + `contracts/*/generated` + `verification-codes/status` + `file-upload/verify`) → **~2,5s por cliente**.
- ~2500 clientes ativos → **~1h45min** de enriquecimento completo.
- Rate-limit sugerido: 5 req/s por consultor (ver limitação do CF).
- Cron noturno (§Fase 4): 200 clientes/noite ≈ **8min de worker**, cabe folgadamente na janela ociosa.

---

## 10) Próximo passo

Aprovar este mapa. Ao aprovar, executo:

1. **Fase 1** — migration com as 6 colunas + índice do §7.
2. **Fase 2** — `POST /enrich-customer` no worker + modo `enrich` na edge function.
3. **Fase 3** — UI com bloco "Endereço", "Concessionária", "Status detalhado", "PJ".
4. **Fase 4** — cron noturno + trigger no primeiro cadastro.

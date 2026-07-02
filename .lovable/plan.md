# Enriquecimento de dados dos clientes vindos do portal iGreen

## Diagnóstico

O portal `escritorio.igreenenergy.com.br` (front) conversa com `api-green-connection.igreenenergy.com.br` (backend HMAC — já mapeado em `docs/portal-api/PORTAL2_API_COMPLETO.md`). O worker `worker-portal-2/portal2-api-client.mjs` **já implementa** os endpoints ricos, mas o sync (`supabase/functions/sync-igreen-customers`) só consome a **lista** raspada — nunca puxa o detalhe por cliente.

### O que sincronizamos hoje (list-view, ~22 campos)
`name, phone_whatsapp, cpf, email, address_city, address_state, distribuidora, andamento_igreen, devolutiva, observacao, igreen_code, media_consumo, desconto_cliente, data_cadastro, data_ativo, data_validado, status_financeiro, cashback, nivel_licenciado, assinatura_cliente, assinatura_igreen, link_assinatura, registered_by_name/id, customer_referred_by_name/phone, numero_instalacao, data_nascimento`

### O que está disponível na API e não puxamos (por endpoint)

**`GET /customers/{idcliente}`** (detalhe completo — nunca chamamos no sync)
- Endereço completo: `endereco, numero, complemento, bairro, cep` (só temos city/uf)
- `concessionaria` + `fornecedora` (só temos `distribuidora`)
- `num_cliente_distribuidora` (código do cliente na CPFL/Enel/etc.)
- Flags de conta: `possui_placas, contaunica, transferir_titularidade`
- PJ: `cnpj, razao_social, fantasia, natureza_juridica, cargo, ie, local_registro`
- Procurador/testemunha: `testemunha_nome, cpf, datanasc, email, celular`
- `sendcontract, indcli` (indicador ID numérico)

**`GET /customers/{id}/signature-summary`**
- Status detalhado de assinatura (cliente vs iGreen) com timestamps

**`GET /contracts/customer/{id}/generated` e `/signed`**
- `linkassinatura` real do contrato, `hasSignature`, status de geração

**`GET /verification-codes/status/{id}`**
- Estado do OTP: `pending|completed|failure|expired|used` — hoje só sabemos que "assinou" pelos campos da lista

**`GET /file-upload/verify/{id}`**
- Status de validação de documentos (aprovado/reprovado/pendente pela IA da iGreen)

**Extractors (só rodam no cadastro; resposta é descartada)**
- `tipo_documento` (RG/CNH), `validade` do documento, `corrections` da IA

### Colunas alvo (novas ou existentes vazias)

A tabela `customers` já tem 226 colunas — a maioria dos campos acima já tem coluna correspondente. Vou mapear na Fase 0 quais precisam ser criadas (provavelmente poucas: `num_cliente_distribuidora`, `fornecedora`, `contaunica`, `transferir_titularidade`, `signature_status_summary`, `document_verify_status`, `otp_status`, `contract_link_generated`).

## Plano em fases

### Fase 0 — Análise formal (entregável)
Gerar `docs/portal-api/PORTAL2_ENRIQUECIMENTO_MAP.md`:
- Tabela: **campo do portal ↔ coluna do DB ↔ status hoje (ok/vazio/faltando coluna)**
- Lista de colunas novas que precisamos criar
- Estimativa de custo por chamada (worker Playwright ~500ms cada; ~2500 clientes = ~20min por sync completo)

Sem alteração de código nesta fase. Você aprova o mapa antes de executar Fase 1.

### Fase 1 — Migration das colunas faltantes
Migration que adiciona só o que não existe (a checar contra o schema). Provavelmente:
- `num_cliente_distribuidora TEXT` (já existe — vem de boletos)
- `fornecedora TEXT`
- `contaunica BOOLEAN`
- `transferir_titularidade BOOLEAN`
- `possui_placas BOOLEAN`
- `signature_summary JSONB` (payload rico)
- `document_verify_status TEXT` + `document_verify_at TIMESTAMPTZ`
- `otp_status TEXT` + `otp_status_at TIMESTAMPTZ`
- `contract_link_generated TEXT`
- `pj_razao_social, pj_fantasia, pj_natureza_juridica, pj_ie, pj_cargo` (se não existirem)

### Fase 2 — Endpoint de enriquecimento por cliente
Adicionar no `worker-portal-2/server.mjs`:
- `POST /enrich-customer` `{ idcliente, idconsultor }` → chama `getCustomer + getSignatureSummary + getContractGenerated + getVerificationCodeStatus + getFileUploadVerify` e devolve objeto normalizado

Adicionar no edge function `sync-igreen-customers`:
- Novo modo `enrich` (por cliente) que consome esse endpoint e faz `UPDATE` incremental
- Modo `sync-all` ganha flag opcional `enrich=true` para rodar enriquecimento em batch **após** a listagem
- Rate limit: 5 req/s por consultor (limitado pelo browser Playwright do worker)

### Fase 3 — UI
Na tela do cliente (`CustomerDetail` / drawer), mostrar as novas seções:
- Endereço completo (com CEP formatado)
- Concessionária + fornecedora + n° cliente distribuidora + n° instalação
- Status detalhado: assinatura, contrato, OTP, validação de documentos
- Bloco PJ (só quando `cnpj` existir)

Botão "Enriquecer agora" (por cliente) no drawer, e opção "Enriquecer todos" na tela de sync.

### Fase 4 — Automação
- Cron: enriquecimento noturno dos clientes com `last_enriched_at IS NULL` (200 por noite pra não estourar o portal)
- Trigger imediato no primeiro cadastro / quando `idcliente` aparece pela primeira vez

## Fora de escopo (não vou fazer nesta rodada)

- Substituir a raspagem da lista por API pura (a lista completa não tem endpoint público equivalente sem HMAC de sessão diferente)
- Escrever/atualizar dados no portal via API (só leitura enriquecendo nosso lado)
- Reengenhar autenticação do worker

## Ordem de execução

1. Você aprova este plano
2. Entrego Fase 0 (mapa detalhado) — sem tocar código
3. Você revisa o mapa e aprova as colunas
4. Executo Fase 1 → 2 → 3 → 4 com sua aprovação entre cada uma

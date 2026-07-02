## Objetivo

Preencher os 2 campos que faltam (endereço completo + licenciado responsável) para atingir 100% de paridade com o modal do escritório iGreen, e revalidar todos os 15 campos da Sandra (idcliente 1117549).

## Situação atual

Sync automático já traz 13/15 campos via `worker /sync-all` (endpoint `api-vo /clientes-green/boletos/{id}`). Faltam:
- **Endereço:** rua, número, complemento, bairro, cidade, UF, CEP
- **Licenciado responsável:** nome do consultor dono do cliente no iGreen (ex.: "Rafael Ferreira Dias")
- **Bug menor:** data de nascimento salva invertida (mês/dia trocados) — corrigir parser

## Passos

**1. Descobrir endpoints faltantes (probe automático)**
Rodar `probe-igreen-detail` (já implementado) contra Sandra com lista expandida de candidatos que costumam expor endereço/licenciado no portal iGreen:
- `/clientes-green/dados/{id}`, `/clientes-green/endereco/{id}`, `/clientes-green/completo/{id}`
- `/clientes/{id}`, `/clientes/detalhe/{id}`, `/clientes/full/{id}`
- `/consultores/cliente/{id}`, `/licenciado/cliente/{id}`

Registrar em `igreen_endpoint_discovery`, inspecionar `sample_body` dos status 200 e escolher o vencedor para cada campo (pode ser 1 ou 2 endpoints).

**2. Estender worker (VPS)**
Adicionar no worker `igreen-worker`:
- Função `fetchCustomerAddress(idcliente)` → chama endpoint vencedor
- Função `fetchCustomerLicensee(idcliente)` → chama endpoint vencedor
- Incluir os campos no payload do `/sync-all` (dentro do enrich, junto com boletos)

**Nota:** worker roda em VPS Easypanel — deploy manual. Vou gerar o patch pronto para o usuário aplicar (`git pull && docker compose up -d --build`).

**3. Estender schema do Supabase (migration)**
Adicionar em `igreen_seguros_customers` (ou tabela equivalente Phase 1):
- `endereco_rua`, `endereco_numero`, `endereco_complemento`, `endereco_bairro`, `endereco_cidade`, `endereco_uf`, `endereco_cep`
- `licenciado_nome`, `licenciado_codigo`

**4. Atualizar `sync-igreen-customers` (edge function)**
Mapear os novos campos do payload do worker para as colunas novas. Corrigir parser de `data_nascimento` (trocar formato `dd/mm/yyyy` para ISO correto).

**5. Rodar sync + validar 15/15 campos**
Executar `sync-igreen-customers` para Sandra, ler linha do DB, comparar 1-a-1 com screenshot do modal escritório. Meta: 15/15 ✅.

**6. Rodar sync completo**
Após validação, rodar `sync-igreen-customers` sem filtro (todos os clientes da consultora) e reportar estatísticas: total, sucesso, falha, campos preenchidos.

## Detalhes técnicos

- **Sem mudança de contrato do worker** para o Lovable além dos novos campos em `enrich` (backward-compatible).
- **Sem alteração** em `worker-portal-2`, cadastro, OTP, contratos.
- **Rate limit:** manter concorrência 3 no worker; endpoints extras multiplicam por ~2 as chamadas por cliente.
- **Fallback:** se probe não achar endereço/licenciado em nenhum endpoint, reportar ao usuário e parar (não inventar).

## Riscos

- Worker precisa de redeploy manual (VPS) — vou entregar patch + comando exato.
- Se iGreen bloquear login (Cloudflare/WAF), paro no passo 1.

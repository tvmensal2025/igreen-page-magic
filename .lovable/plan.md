# Descoberta automática do endpoint de detalhe (sem VPS/curl manual)

Você pediu para automatizar: em vez de você fazer deploy do worker e rodar curl, crio uma **edge function Supabase** que faz o probe direto contra `api-vo.igreenenergy.com.br`, salva o resultado no banco e mostra na UI.

## O que muda no plano

Fase A vira automática. Fases B–E permanecem iguais.

## Nova Fase A (automática)

**1. Edge function `probe-igreen-detail`**
- Recebe: `{ consultant_id, sample_idcliente? }`
- Faz login em `api-vo.igreenenergy.com.br/v1/auth/*` reusando as credenciais do consultor (mesmo fluxo do `worker-igreen-sync`, mas em Deno).
- Se `sample_idcliente` não vier, busca 1 cliente em `/crm/green` e usa o primeiro.
- Testa 12 endpoints candidatos:
  - `/clientes-green/{id}`, `/crm/green/{id}`, `/customer/{id}`, `/customers/{id}`
  - `/clientes-green/detalhe/{id}`, `/clientes-green/{id}/completo`
  - `/clientes-green/{id}/dados-cadastrais`, `/clientes-green/{id}/endereco`
  - `/clientes-green/dados/{id}`, `/green/{id}`, `/clientes/{id}`, `/cliente/{id}`
- Para cada: status, tamanho, duração, top 3 KB do body.
- Persiste em nova tabela `igreen_endpoint_discovery` (já existe no schema — reaproveitar).
- Retorna JSON com resultados classificados (ok / denied / missing / bad_request).

**2. Migration**
- Reaproveitar tabela `igreen_endpoint_discovery` existente (15 colunas, 2 policies). Se faltar coluna, adiciono.

**3. UI de admin (`/admin` → nova seção "Descoberta de endpoint")**
- Dropdown de consultor aprovado.
- Input opcional `sample_idcliente` (default: SANDRA 1117549).
- Botão "Rodar probe".
- Tabela de resultados: endpoint, status, tamanho, preview do body expansível.
- Botão "Marcar como vencedor" → salva em `app_settings` chave `igreen_customer_detail_endpoint`.

## Fase B (após vencedor marcado)
- `worker-igreen-sync` (ou edge function nova) lê o endpoint de `app_settings` e implementa `/enrich-customer-batch`.
- Restante das fases C-E mantido.

## Vantagem
Você clica "Rodar probe" na UI, vê o resultado e marca o vencedor com 1 clique — sem VPS, sem curl, sem terminal.

## Escopo
- Nova edge function: `probe-igreen-detail`
- Nova página admin: `src/pages/admin/IgreenEndpointProbe.tsx` (ou aba dentro de página existente)
- Nenhuma alteração em `worker-portal-2`, `Portal2Client`, cadastro.

## Próximo passo
Aprovar → implemento a edge function + UI. Depois você roda o probe pelo painel e me diz o vencedor (ou eu leio direto de `igreen_endpoint_discovery` na próxima interação).

# Nunca deixar cliente ativo aparecer na Conversão

Entendi: analisar por **nome completo + telefone** e todos os sinais de "já é cliente/licenciada", removendo do Conversão. O botão de reativar puxou 0 porque a lógica estava errada — vou reescrever.

## Regra de "já é cliente" (união — se qualquer sinal existir, fora do funil)

Um customer é considerado cliente ativo (não pode aparecer no Conversão) se **qualquer uma** for verdadeira:

1. `customer_origin = 'igreen_sync'` (já é registro sincronizado do portal)
2. `igreen_code` preenchido (não nulo, não vazio)
3. `data_ativo` OU `data_validado` OU `data_cadastro` preenchidos
4. `andamento_igreen` ∈ (`ativo`, `aprovado`, `validado`, `licenciada`, `licenciado`)
5. `assinatura_cliente = true`
6. **Match por nome+telefone**: existe outro customer (qualquer consultor) com o mesmo `phone_whatsapp` normalizado (só dígitos, ignorando +55) E com nome parecido (normalizado sem acentos/case) que satisfaz 1–5.

## Mudanças

### 1. `ConversaoCockpit.tsx` — filtro na query
Adicionar cláusulas ao `.select()` de `customers`:
- `.is('igreen_code', null)`
- `.is('data_ativo', null)`
- `.is('data_validado', null)`
- `.is('data_cadastro', null)`
- `.not('andamento_igreen', 'in', '(ativo,aprovado,validado,licenciada,licenciado)')`
- `.not('assinatura_cliente', 'eq', true)`

Depois, no cliente, cruzar por telefone normalizado: buscar em `customers` (com service via edge) todos os telefones "de cliente ativo" e remover das linhas exibidas. Fazer isso no próprio fetch usando um segundo query rápido só do conjunto de `phone_whatsapp` da fila filtrada.

### 2. Reescrever a edge function `admin-promote-parked-leads` → `admin-clean-conversao`
- Deixa de tentar "promover". Passa a fazer **limpeza**:
  - Percorre `customers` do consultor autenticado.
  - Marca `pos_venda_stage = 'cliente_ativo'` em todos que baterem qualquer sinal (1–5) OU cujo telefone normalizado coincide com um customer ativo de qualquer consultor.
  - Retorna `{ scanned, cleaned }`.
- Grava em `admin_audit_log` como `conversao.clean_active_clients`.

### 3. Botão do cockpit
- Renomear para **"Limpar clientes ativos"** (ícone `Broom`).
- Toast: `"X clientes ativos removidos do funil (varredura de Y). Captação intocada."`
- Reload após execução.

## Resultado

- Lucineia e qualquer outro que já tenha código iGreen, cadastro, ativo, validado ou nome+telefone batendo com cliente ativo **desaparecem** do Conversão automaticamente e ficam marcados para não voltar.
- Botão faz uma limpeza retroativa em massa.
- Captação (`captured_leads`) e `igreen_sync` continuam intocados.

## Detalhes técnicos

- Sem migração de schema.
- Edita: `supabase/functions/admin-promote-parked-leads/index.ts` (renomear internamente) e `src/components/admin/conversao/ConversaoCockpit.tsx` (fetch + label do botão + handler).
- Normalização de telefone: `raw.replace(/\D/g,'')` e strip `55` inicial se >= 12 dígitos, para dedup consistente entre `whatsapp_lead` e `igreen_sync`.

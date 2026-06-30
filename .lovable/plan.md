# Plano auditado — Fechar lacunas do cadastro iGreen sem quebrar produção

Auditoria confirmou no banco real: nenhuma das colunas alvo existe (`orgao_expedidor`, `fornecedora`, `contaunica`, `possui_placas`, `transferir_titularidade`, `logindistribuidora`, `senhadistribuidora`, `pj_jsonb`, `procurador_jsonb`, `terms_accepted_at`). O worker (`portal2-api-client.mjs`) **já lê** essas chaves de `d.*` no `montarPayloadCadastro` — só estão chegando como `undefined`, virando defaults `false`/`""`. Ou seja, criar as colunas + alimentar o `dados` já fecha o gap.

## Princípios de segurança (não negociáveis)
- Toda coluna nova é **NULLABLE**, com DEFAULT compatível com o hardcode atual do worker.
- Worker continua mandando defaults atuais quando a coluna estiver NULL → comportamento idêntico ao de hoje para leads antigos.
- Cada PR pode ser revertido sozinho (DROP COLUMN aditivo, revert isolado do worker, desligar steps do fluxo).
- **Nada do fluxo D entra antes do schema e do worker já saberem ler as novas colunas.**

---

## PR 1 — Migração aditiva em `customers`

Sem mexer em coluna existente. Tudo nullable, defaults batendo com o atual do worker:

```sql
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS orgao_expedidor TEXT,
  ADD COLUMN IF NOT EXISTS fornecedora TEXT,
  ADD COLUMN IF NOT EXISTS contaunica BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS possui_placas BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS transferir_titularidade BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS logindistribuidora TEXT,
  ADD COLUMN IF NOT EXISTS senhadistribuidora TEXT,   -- cifrar via worker antes de gravar
  ADD COLUMN IF NOT EXISTS pj_jsonb JSONB,
  ADD COLUMN IF NOT EXISTS procurador_jsonb JSONB,
  ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS data_nascimento_iso DATE;   -- espelho seguro, sem tocar TEXT
```

Backfill best-effort, dentro da mesma migração:

- `data_nascimento_iso` ← cast de `data_nascimento` quando bater `YYYY-MM-DD` ou `DD/MM/YYYY` (regex, ignora o resto).
- `fornecedora` ← último `portal2_audit_traces.result->>'fornecedora'` por `customer_id` quando existir.
- `pj_jsonb`, `procurador_jsonb` ← `portal2_audit_traces.input_summary` filtrado por presença de `cnpj` / `testemunha_*`.

Sem RLS nova (herda de `customers`). Sem GRANT novo (mesma tabela).

**Validação pós-deploy:** `SELECT count(*) FROM customers` antes/depois → mesmo número; cadastros existentes seguem funcionando sem mudança no worker.

## PR 2 — Worker passa a popular `dados.*` a partir do `customer`

Arquivo: `worker-portal-2/portal2-api-client.mjs`.

O `montarPayloadCadastro` **já lê** `d.possuiPlacas`, `d.contaUnica`, `d.transferirTitularidade`, `d.loginDistribuidora`, `d.fornecedora`, etc. O que falta é o **chamador** (em `submit-customer`/jobs do BullMQ) passar essas chaves a partir das novas colunas:

```js
dados = {
  ...dadosAtuais,
  orgaoexpedidor: customer.orgao_expedidor ?? '',
  fornecedora: customer.fornecedora ?? null,            // null → resolve via /bonus/rules como hoje
  contaUnica: customer.contaunica ?? false,
  possuiPlacas: customer.possui_placas ?? false,
  transferirTitularidade: customer.transferir_titularidade ?? false,
  loginDistribuidora: customer.logindistribuidora ?? '',
  senhaDistribuidora: decryptIfPresent(customer.senhadistribuidora) ?? '',
};
```

Após `resolveBonus()` retornar fornecedora, **persistir** em `customers.fornecedora` via UPDATE best-effort (try/catch, não bloqueia cadastro).

Após `acceptTerms(idcliente)` resolver sem throw, gravar `terms_accepted_at = now()` (UPDATE best-effort).

PJ / Procurador: se `customer.pj_jsonb` presente, expandir suas chaves em `dados`; se não, comportamento atual (worker não envia esses campos).

**Cifra de `senhadistribuidora`:** usar `pgcrypto` no banco (`pgp_sym_encrypt`/`pgp_sym_decrypt`) com chave em env do worker. Se chave ausente → não grava senha (campo fica NULL, worker manda `""`, idêntico ao hoje).

## PR 3 — Coleta opcional no Fluxo D

Editar steps do fluxo D em `supabase/functions/_shared/engine/*` + `bot_flow_steps`. **Todas opcionais**, com botão “pular / não sei” → mantém default atual:

1. Conta única ou múltiplas instalações? → `contaunica`
2. Já tem placas solares? → `possui_placas`
3. Conta está no seu nome ou precisa transferir? → `transferir_titularidade`
4. (Opt-in) “Quer leitura automática da fatura? Me passe login do site da distribuidora.” → `logindistribuidora` + `senhadistribuidora` (cifrada).
5. Órgão emissor do documento (ex: SSP/SP)? → `orgao_expedidor` (anexado à pergunta existente do RG).

`supabase/functions/_shared/portalValidation.ts`: **nenhum** desses campos entra como `missing`/`invalid` — não bloqueia `finalize-capture`, igual hoje.

## PR 4 — Padronização + observabilidade

- Worker aceita alias `customer.distribuidora || customer.concessionaria` (gap #8). Sem mudança de schema.
- `portal2_audit_traces.input_summary` passa a registrar `source` de cada campo (`customers.fornecedora` vs `bonus.rules`) para diagnóstico.
- Painel `/admin → Saúde do Portal`: contadores de cadastros com `possui_placas=true`, `transferir_titularidade=true`, `pj_jsonb≠null` — confirma que a coleta nova chega ao portal.

---

## Itens explicitamente fora de escopo (anotados, não mexer agora)

- Migrar `data_nascimento` TEXT → DATE de verdade. O espelho `data_nascimento_iso` cobre relatórios; mudar a coluna autoritativa exige varredura grande no frontend → risco alto, ganho baixo.
- Renomear `address_street`/`address_city`/... para nomes canônicos do portal. Apenas “nome divergente”, worker já traduz. Mexer quebra telas.
- Migrar `distribuidora` ↔ `concessionaria` para coluna única. PR 4 resolve via alias no worker, sem migração.

## Ordem de execução e gates

| Passo | Gate antes de seguir |
|------|----------------------|
| PR 1 (migração) | `SELECT count(*) FROM customers` igual antes/depois. Cadastro do dia segue normal. |
| PR 2 (worker) | Subir só com `PORTAL2_AI_AUDIT_LIMIT=10`. Cadastrar 1 lead real de consultor de teste. Verificar `portal2_audit_traces` mostrando os novos campos com `source`. |
| PR 3 (fluxo D) | Liberar para 1 consultor por 24h. Conferir taxa de erro do worker (≤ baseline atual). |
| PR 4 (alias + painel) | Junto ou logo depois do PR 3. |

## Reversão de cada PR

| PR | Como reverter |
|----|---------------|
| 1 | `ALTER TABLE customers DROP COLUMN ...` (sem FK, sem dependência). |
| 2 | Revert do `portal2-api-client.mjs` + arquivo do job. Defaults voltam aos hardcodes. |
| 3 | `UPDATE bot_flow_steps SET active=false WHERE id IN (...)`. |
| 4 | Revert do alias + remover linhas de log. |

## Posso seguir?

Confirma que eu posso **abrir o PR 1 agora** (apenas migração aditiva, sem nenhuma mudança de comportamento)? Os outros entram em sequência com sua aprovação a cada passo.

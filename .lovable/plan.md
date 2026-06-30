## Vai funcionar? Sim. O que muda na prática:

### PR 1 — Banco (já aplicado)
Adicionei 10 colunas em `customers` que faltavam para refletir 100% do formulário do Portal iGreen:
`orgao_expedidor`, `fornecedora`, `contaunica`, `possui_placas`, `transferir_titularidade`, `logindistribuidora`, `senhadistribuidora`, `pj_jsonb`, `procurador_jsonb`, `terms_accepted_at` + espelho `data_nascimento_iso`.

**Impacto:** zero risco. Todas nullable, defaults idênticos ao hardcode que o worker já usava. Cadastros antigos continuam exatamente iguais.

### PR 2 — Worker (já aplicado)
- `portal2-api-client.mjs`: `cadastrarCliente` agora **devolve** `fornecedora`, `concessionaria` e `termsAccepted` (antes era silencioso). `montarPayloadCadastro` lê os novos campos quando existirem.
- `server.mjs`: o `SELECT` traz as novas colunas e repassa para o portal. Quando NULL, usa o mesmo default de antes.
- Após cadastro com sucesso, grava `fornecedora` resolvida e `terms_accepted_at` em `customers` → evita re-resolver `/bonus/rules` em retentativas e dá rastro de aceite.

**Impacto:** cadastros saem idênticos aos de hoje quando os campos novos estão vazios; quando vierem preenchidos, vão para o portal corretamente.

### PR 3 — Pulado a seu pedido
Não vamos adicionar perguntas extras no Fluxo D. Os campos novos ficam opcionais e só são usados se forem preenchidos por outro caminho (UI manual, OCR, etc.).

### PR 4 — Observabilidade (já aplicado)
Nova página `/admin/portal-monitor` mostrando:
- KPIs de 7 dias (sucesso / humano / erros / tempo médio)
- Últimas 100 execuções do worker com `job_id`, status, duração e erro
- Cada linha exibe a tradução **Distribuidora** (UI) → **Concessionária** (Portal) → **Fornecedora** (bônus), padronizando a nomenclatura confusa.

---

## O que isso resolve no caso da Gislaine e similares

1. **Anexos garantidos** (do passo anterior): worker faz retry 5× com backoff e verifica via `verifyUpload`. Se falhar de vez, limpa `portal2_idcliente` e manda para `needs_human` em vez de marcar como pronto sem documento.
2. **OTP automatizado** (do passo anterior): código digitado no WhatsApp é injetado no portal; link de facial sai automático.
3. **Fornecedora persistida** (PR 2): em retentativa o worker não re-resolve bônus, evitando divergência de fornecedora entre tentativas.
4. **Visibilidade** (PR 4): você consegue ver em tempo real qual lead travou, com qual erro e qual distribuidora/fornecedora foi enviada.

---

## Como validar agora

1. Abra `/admin/portal-monitor` → veja se as 2 últimas execuções (que já existem na base) aparecem como "Sucesso".
2. Próximo cadastro real: confirme na listagem que ele apareceu com a distribuidora correta e que `customers.fornecedora` e `customers.terms_accepted_at` ficaram preenchidos.
3. Em caso de falha de upload, o lead vai aparecer como **Humano** (não mais como sucesso falso).

Sem mais alterações nesta etapa — quer que eu confirme algum lead específico no monitor?

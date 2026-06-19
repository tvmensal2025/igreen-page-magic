## Diagnóstico

### 1) Nome do lead virou "Apagão"
Lead `5514991089592` (id `b9bd51c8…`) hoje está com:
- `name = "Apagão"`
- `name_source = "freeform_multi"`
- `name_ask_sent_at = NULL` (o bot **nunca pediu o nome**)
- `capture_mode = "auto"`

Por que aconteceu? O `extractNome` (`supabase/functions/_shared/captureExtractors.ts`) tem regra fraca demais: **qualquer mensagem com 1–3 palavras só-letras vira candidato a nome**. "Apagão" passa em todos os filtros (não é palavrão, não está na stopword, tem >2 letras, só letras). E `buildMultiFieldPatch` sobrescreve o nome quando o source anterior não está na lista "forte" — o nome antigo provavelmente veio do `whatsapp_profile` (fraco), foi sobrescrito por "Apagão" e marcado como `freeform_multi`, que agora trava o nome errado no lugar.

Pior ainda: a extração roda em **toda mensagem inbound**, mesmo sem o bot ter perguntado o nome.

### 2) Palavras-chave
- `referral_partners` ativos: **`Silvia`** (cli 137238) e **`CELIO`** (sem cli).
- Tabela `campaign_match_log` está **vazia (0 linhas)**.
- Motivo: o registro no `campaign_match_log` só existe no `evolution-webhook` (linha 942). O `whapi-webhook` (que é o canal usado no projeto agora) **roda o `matchKeyword` mas nunca grava no log de auditoria** — então hoje é impossível medir se está funcionando em produção.
- O matcher em si (`_shared/keyword-matcher.ts`) está correto: exact-substring + Levenshtein ≤1 para keywords ≥5 chars, normalização NFD + lowercase + sem pontuação.

---

## Plano

### Parte A — Corrigir extração de nome (`captureExtractors.ts` + `multi-field-extractor.ts`)

1. **Expandir `STOPWORDS_NOME`** com substantivos do domínio que o cliente fala no dia-a-dia e que viravam "nome":
   `apagao, apagão, energia, luz, conta, fatura, boleto, kwh, distribuidora, enel, cemig, cpfl, equatorial, coelba, light, eletropaulo, neoenergia, desconto, economia, pagamento, valor, preco, preço, dinheiro, indicacao, indicação, propaganda, anuncio, anúncio, instagram, facebook, whatsapp, site, google, ajuda, problema, duvida, dúvida, simular, simulacao, simulação, cancelar, sair, parar`.

2. **Endurecer `extractNome`**:
   - **Resposta crua de 1 palavra única**: só aceita se `customer.name_ask_sent_at IS NOT NULL` (vai ser passado por parâmetro). Hoje qualquer palavra avulsa vira nome — passa a exigir que o bot tenha perguntado o nome primeiro, OU que venha após gatilho explícito ("sou X", "me chamo X", "meu nome é X", "aqui é X").
   - Manter 2–3 palavras como aceitável sem gatilho (combinação rara de coincidir com substantivo comum).
   - Rejeitar quando a palavra única for ≥ 5 letras e estiver dentro de Levenshtein ≤1 de qualquer item da blacklist de domínio (pega "apagao", "apagão", "energía", erros de digitação).

3. **`buildMultiFieldPatch`**: remover `freeform_multi` da lista `strongNameSources` e, em vez disso, exigir que upgrades para `name` vindos de freeform só sejam aplicados quando:
   - source anterior é `null` / `whatsapp_profile` / vazio, **E**
   - `name_ask_sent_at IS NOT NULL` **OU** o nome veio com gatilho estruturado.
   - Sempre que sobrescrever, gravar `console.log` estruturado `{customer_id, old_name, new_name, source_before, source_after, message_sample}` para auditoria.

4. **Propagar `name_ask_sent_at` e `name_source` para o extractor**: hoje `extractNome(text)` só recebe o texto. Adicionar segundo parâmetro `{nameAskSentAt?: string|null, currentSource?: string|null}` (default `null`/`null` para não quebrar testes). Chamadas em `multi-field-extractor.ts` e nos webhooks passam os valores do `customer`.

5. **Corrigir o lead afetado** via tool `supabase--insert`: setar `name = NULL`, `name_source = NULL` no customer `b9bd51c8…` para que o próximo pedido de nome funcione limpo.

6. **Teste unitário** em `supabase/functions/_shared/captureExtractors.test.ts` (criar se não existir) cobrindo: "apagão", "apagao", "energia", "conta", "luz", "sim", "ok" → todos `null`. "Sou João" → "João". "João" sozinho sem `name_ask_sent_at` → `null`. "João" sozinho com `name_ask_sent_at` setado → "João". "Maria Silva" → "Maria Silva".

### Parte B — Validar e instrumentar palavras-chave (sem alterar a lógica do matcher)

1. **Adicionar log de auditoria no `whapi-webhook`** igual ao `evolution-webhook`: depois do `match = matchKeyword(...)`, gravar em `campaign_match_log` `{customer_id, campaign_id: null, method: "keyword", similarity: match.score, message_sample}`. Best-effort, fail-open. **Esse é o único bloco realmente faltando no whapi-webhook.** Sem isso é impossível auditar.

2. **Relatório de validação** (output só no chat, sem mudar código):
   - Listar parceiros ativos e suas keywords.
   - Rodar 12 casos sintéticos contra `matchKeyword` localmente (`bun test` ou script `node`): "silvia me indicou", "vim da silvia", "celio falou de vcs", "celíó", "silvinha", "olá", "preciso de ajuda", "celiio" (typo), "CELIO", "a Silvia mandou", "silv" (curto demais), "sIlVia". Mostro tabela esperado-vs-real.
   - Confirmar que após o deploy o `campaign_match_log` começa a registrar (snapshot 1 min depois).

3. **Não mexer** em `keyword-matcher.ts` agora — está coberto pelos casos esperados.

---

## Arquivos afetados

- `supabase/functions/_shared/captureExtractors.ts` — stopwords + `extractNome` assina nova
- `supabase/functions/_shared/multi-field-extractor.ts` — política de sobrescrita + log
- `supabase/functions/_shared/captureExtractors.test.ts` — novos testes (criar)
- `supabase/functions/whapi-webhook/index.ts` — adicionar insert em `campaign_match_log`
- `supabase/functions/evolution-webhook/index.ts` — passar `name_ask_sent_at`/`name_source` para o multi-extractor
- 1 `supabase--insert` para zerar `name`/`name_source` do lead afetado

## Resultado esperado

- Nenhuma palavra única (especialmente do domínio "energia") vira nome sem o bot ter perguntado.
- Nome só é sobrescrito quando o source anterior é fraco **E** houve pedido explícito.
- A partir do próximo inbound em qualquer canal, `campaign_match_log` registra todos os matches do whapi → você consegue medir taxa de acerto em produção.
- Relatório imediato mostrando que "Silvia" e "CELIO" disparam corretamente nos casos esperados.

## Fora do escopo (avisar)

- Não vou inflar o matcher com sinônimos manuais ("a silvinha", "seu celio"). Se quiser, depois adicionamos como variantes na própria coluna `keywords` do parceiro.
- Não vou trocar o canal Whapi/Evolution nem alterar o cache do PWA (já fechado na rodada anterior).

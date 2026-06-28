# 🔍 Auditoria pós-remix — Plano de execução

Vou rodar a auditoria **somente leitura** (nenhum arquivo do projeto será alterado) e entregar o relatório consolidado em `/mnt/documents/remix-audit.md`.

## O que será executado (em paralelo sempre que possível)

### Passo 1 — Inventário do código

- `ls supabase/functions/ | grep -v _shared | wc -l` (esperado 153)
- `ls supabase/migrations/ | wc -l` (esperado ≥ 596)
- Ler `src/integrations/supabase/client.ts` e `.env` e confirmar se o REF é o do projeto novo ou ainda `zlzasfhcxcznaprrragl` (origem).
  > ⚠️ Já posso adiantar pelo contexto: hoje o client.ts e `supabase/config.toml` ainda apontam para `zlzasfhcxcznaprrragl`. Isso vai ser destacado como ❌ no relatório se o REF do projeto remixado for diferente.

### Passo 2 — Segredos

- Rodar `fetch_secrets` e cruzar com a **lista canônica** que você forneceu (críticos + WhatsApp + IA + Meta/TikTok + Portal + Solar + Stripe + MinIO + Flags/TURN + auto-injetados).
- Ignorar a lista "NÃO cadastrar".
- Produzir um bloco `Ação: add_secret([...])` exato com os que faltarem.

### Passo 3 — Banco

Via `supabase--read_query`, rodar as 7 queries do seu script (tabelas, RPCs, crons, extensions, realtime, consultants/instances/roles, bots pausados) + `supabase--linter` e listar só os achados críticos (RLS off, policies permissivas, search_path mutable).

### Passo 4 — Storage

Query em `storage.buckets` para conferir presença de: `media, audio, documents, tts, ad-images, ad-videos, comprovantes, voice-clips`. Vou avisar explicitamente que **objetos não são copiados** no remix.

### Passo 5 — Edge Functions

Contar funções no FS, listar quais nunca foram deployadas no projeto novo (best-effort via logs), e recomendar `supabase--deploy_edge_functions` em lotes se necessário.

### Passo 6 — Webhooks externos

Montar a lista pronta com a URL exata `https://<NOVO_REF>.supabase.co/functions/v1/...` para os 7 webhooks (Whapi, Evolution, Meta Lead Ads, TikTok, Stripe, FB OAuth, Portal Worker 2). Para isso preciso do REF do projeto novo (ver pergunta abaixo).

### Passo 7 — Testes E2E

Listar os 10 testes como checklist manual (não rodo automaticamente nesta auditoria — exigem instâncias reais e dinheiro de teste Stripe/Meta).

## Entrega final

Arquivo único `/mnt/documents/remix-audit.md` com:

1. Resumo executivo (1 parágrafo: pronto OU X bloqueios)
2. Tabela ✅/⚠️/❌ por item dos passos 1–6
3. Bloco `add_secret([...])` pronto pra colar
4. Lista de webhooks com URL final do projeto novo
5. Próximos passos priorizados

## ❓ Antes de executar, preciso confirmar uma coisa

O `client.ts`, o `.env` e o `config.toml` **ainda apontam para `zlzasfhcxcznaprrragl**` (o projeto de origem). Tudo que o agente Lovable conseguir consultar agora (segredos, banco, storage, edge functions) vai ser **do projeto antigo**, não do remix novo. Para auditar o destino correto preciso de uma destas duas coisas:

- **Opção A:** Você cola aqui o **REF do Supabase do projeto remixado** (algo como `abcd1234...supabase.co`) e a **anon key** dele. Eu atualizo `client.ts` / `.env` / `config.toml` (no modo build) e aí a auditoria roda contra o destino certo.
- **Opção B:** Você confirma que **quer auditar o projeto atual mesmo** (`zlzasfhcxcznaprrragl`) — nesse caso eu já rodo sem mudar nada.

Qual das duas? PROJETO ATUAL
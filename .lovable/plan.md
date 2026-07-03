# Auditoria de completude do sync iGreen (caso Matias)

## O que já sabemos (checado agora no banco)

- **Matias Geraldo Muniz** existe em `customers`, mas foi criado via **lead do WhatsApp** (`customer_origin=whatsapp_lead`), não pelo sync do portal. Ele **nunca teve** `portal2_idcliente`, `situacao_igreen` nem `last_enriched_at`.
- Rafael (`0c2711ad…`) tem no banco: **562** clientes marcados `igreen_sync` + 49 leads de WhatsApp.
- O último `sync_all` (03/07 09:44) trouxe **apenas 159 clientes** do portal, com **100 erros de upsert** e só 59 atualizados. Ou seja: o banco tem histórico de 562, mas o portal hoje devolve 159 — 400+ "desapareceram" da fonte, e ainda por cima 100 dos 159 falharam.
- A rota que o worker usa é `GET /crm/green`, que devolve **um Kanban**. Só entram no resultado os cards das colunas retornadas — se o portal esconde colunas tipo `cancelado`, `inativo`, `pendente`, esses clientes ficam invisíveis para o sync.

Conclusão preliminar: não temos como afirmar "Matias não é cliente" nem "só faltou ele" enquanto (a) não abrirmos o Kanban inteiro e (b) não entendermos os 100 erros. É isso que este plano resolve.

## Passos

### 1. Descobrir se Matias está no portal iGreen do Rafael

Adicionar no worker o endpoint `**POST /debug-customer-scan**` que:

- loga na sessão do Rafael
- chama `GET /crm/green`
- devolve: total de colunas, nome/id de cada coluna, contagem de cards por coluna, e um `matches[]` filtrando por `name`/`cpf` recebidos no body
- **não persiste nada**, é só leitura

Rodar `curl` procurando `matias`, `mathias`, e também alguns nomes dos 400 "sumidos" para saber se `/crm/green` está mesmo devolvendo tudo ou está capado.

### 2. Testar rotas alternativas de listagem

Se Matias não aparecer no Kanban, testar via `/probe-customer-detail` (já existe) os endpoints candidatos que a SPA usa para listagens paralelas:

- `/clientes-green?page=1&perPage=500&status=todos`
- `/clientes-green/summary`
- `/customer-map/{consultorId}` (rota antiga documentada em `docs/igreen-sync-worker.md`)
- filtro por status: `cancelado`, `inativo`, `pendente`, `analise`

O objetivo é confirmar qual endpoint devolve a **carteira completa** (não só o Kanban ativo).

### 3. Ler os 100 erros do último sync

Puxar os logs da edge `sync-igreen-customers` da run `221d563d…` (03/07 09:44) e agrupar as mensagens de erro. Hipóteses a validar:

- upsert por CPF colidindo com registros já existentes
- clientes sem telefone/CPF caindo em constraint
- conflito de `consultant_id` (cliente pertencia a outro consultor e mudou)

### 4. Relatório de reconciliação

Com os dados dos passos 1–3, produzir uma tabela mostrando, para o Rafael:

- total no portal (por endpoint testado)
- total no banco por `customer_origin`
- diff: quem está no portal e não no banco, e vice-versa
- causa provável de cada diff (erro de upsert, coluna oculta, mudou de consultor, é lead de WhatsApp puro)

### 5. Correção

Depois do relatório, escolher entre:

- **A.** Trocar `fetchCustomers` para usar o endpoint que devolve a carteira **completa** (não o Kanban).
- **B.** Iterar todas as colunas + status ocultos do Kanban.
- **C.** Corrigir o upsert da edge para não perder os 100 que falham.

Provavelmente as três, mas priorizamos pela causa real que os dados mostrarem.

## Detalhes técnicos

- Arquivos tocados nesta fase: `worker-igreen-sync/server.mjs` (só adicionar `/debug-customer-scan`; leitura pura, sem efeitos).
- Sem migration nesta fase.
- Requer redeploy do worker no Easypanel após o passo 1.
- Depois de rodar o passo 1, eu volto com o print do que apareceu e propomos a correção no mesmo chat — não vamos alterar o pipeline de escrita antes de entender o dado.

## Pergunta antes de começar

Quer que eu prossiga por essa ordem (worker read-only → diagnóstico → correção), ou você prefere abrir o F12 no portal do Rafael, clicar em "Meus clientes", e me mandar o print da aba **Network** filtrada por `xhr`? O F12 pula direto pro passo 2 e economiza 1 deploy.  
  
precido da carteira completa
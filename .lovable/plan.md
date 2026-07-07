
## O que descobri (auditoria)

### 1) Bug: clientes não validados estão recebendo mensagem
O cron **pos-venda-auto-progress** (roda a cada hora, `:15`) manda mensagem para qualquer cliente cujo `pos_venda_stage` seja `aprovado` ou `reprovado` — independente de quem colocou ele nessa coluna.

Existem 2 caminhos que colocam o cliente em `reprovado`/`aprovado`:

- **Caminho consultor (correto):** você clica em "Aprovar" / "Reprovar" no popup Validar novos clientes ou no CustomerEditDialog → grava `pos_venda_manual = true`.
- **Caminho automático (o vazamento):** função `compute_pos_venda_stage()` marca `reprovado` sozinha quando o `andamento_igreen` do portal contém "reprov" ou "cancel", ou quando `status = 'rejected'`. Isso grava `pos_venda_manual = false` e o cron dispara igualzinho.

**Estado real da sua carteira agora (Rafael, 665 clientes iGreen):**
```
espera     + manual=true   → 539  (backfill antigo, seguro)
espera     + manual=false  →  71  (novos, aguardando validação — ok)
reprovado  + manual=false  → 107  ← ESTES vão receber "houve pendência" sem você validar
```
O log já mostra 17 tentativas para esse grupo — só não saíram porque faltou canal. Assim que o WhatsApp reconecta, todos os 107 recebem a mensagem sozinhos.

### 2) Por que não ficou claro o "clique para configurar"
No último passo o clique abre um diálogo que só explica a origem e leva pra tela de config; não deixa editar ali. Para item de pós-venda faltou o editor da mensagem dentro do próprio diálogo.

### 3) Coisas de agendamento fora da Central
Hoje a Central mostra: Agenda manual, Pós-venda, Reaquecimento, Campanhas em massa, iGreen, Histórico. Ficaram de fora:

- **Fila de validação pendente** (`pos_venda_pending_stage`) — é o "Validar novos clientes" do kanban.
- **FAQ nudge** (cron `faq-reengagement-nudge-5min`, cutuca lead que sumiu 20min após FAQ).
- **Rotinas & Tarefas** da carteira (arquivo `RotinasPanel.tsx`, aparece só em Produtos).
- **admin-send-material** (envio manual pelo super admin).
- **Reactivation-cron** e **reactivation-send** (rotina antiga, coexiste com o painel novo de Reaquecimento).

## O que vou fazer

### Passo 1 — Trancar o envio até você validar (crítico)
No cron `pos-venda-auto-progress`:
- Só enviar mensagem de `aprovado`/`reprovado` quando `pos_venda_manual = true`.
- Para os clientes auto-classificados (`manual = false`), mover para `pos_venda_stage = 'espera'` e gravar o palpite em `pos_venda_pending_stage`, para o popup "Validar novos clientes" mostrar.

Ajuste único no banco (retroativo):
- Regularizar os 107 já em `reprovado + manual=false`: voltar para `espera`, gravar `pos_venda_pending_stage = 'reprovado'`. Ninguém recebe mensagem até você abrir "Validar novos clientes" e clicar Aprovar.
- Nada é apagado; só a coluna muda.

Nada muda para quem já foi aprovado/reprovado por você (manual=true).

### Passo 2 — Clique de fato edita a mensagem
No diálogo aberto pelo clique num item de pós-venda da Central de Agendamentos:
- Buscar o `kanban_stages` da coluna correspondente (ex.: `pv_reprovado`) do consultor.
- Renderizar inline o mesmo editor multi-mensagens usado em Autoprogressão (`StageAutoMessageConfig`), com textos/mídias já preenchidos e botão Salvar.
- Manter também o atalho "Abrir Autoprogressão" para quem quiser ver todas as colunas.

Para item de Agenda manual o editor inline já existe.

### Passo 3 — Centralizar o que ficou de fora
Na aba "Visão geral" da Central de Agendamentos:
- Novo card **Validação pendente**: mostra `X clientes aguardando você validar — nenhuma mensagem sai até aprovar`. Botão abre o popup "Validar novos clientes".
- Novo card **Cutucada pós-FAQ**: mostra `X leads na fila` (query em `customers` com FAQ pendente). Botão leva ao histórico.
- Novo card **Rotinas & Tarefas**: contador de tarefas pendentes do dia. Botão leva à aba Produtos → Rotinas.
- Marcar `reactivation-cron` (antigo) como legado no card Reaquecimento, para você saber qual sistema está no ar.

Nenhum desses cards cria nova automação; só torna visível o que já roda.

## Detalhes técnicos (opcional para você)

- Migração SQL: `UPDATE customers SET pos_venda_stage='espera', pos_venda_pending_stage='reprovado' WHERE customer_origin='igreen_sync' AND pos_venda_stage='reprovado' AND pos_venda_manual=false;`
- Edge function `pos-venda-auto-progress/index.ts`: adicionar `.eq("pos_venda_manual", true)` nas queries dos passos 1 e 2 (aprovado / reprovado); passo 3 (esteira 30/60/90/120) continua igual, pois só age em quem já foi aprovado por você.
- `compute_pos_venda_stage()`: passar a devolver `'espera'` no lugar de `'aprovado'/'reprovado'` quando `manual=false`, e o dispatcher que atualiza a linha grava o palpite em `pos_venda_pending_stage`.
- Central de Agendamentos (`AgendamentosHub.tsx`): novos cards e wrapper que carrega `kanban_stages` sob demanda para o editor inline.

## Fora de escopo

- Reescrever o painel novo de Reaquecimento.
- Mexer no worker `worker-igreen-sync` (o bug é 100% no cron/edge).
- Deletar clientes.

## Como valido

- Após migração: 0 linhas em `reprovado + manual=false`.
- Rodar o cron manualmente e conferir que `customer_auto_message_log` não recebe nova linha `pv_reprovado` para clientes com `manual=false`.
- Abrir "Validar novos clientes" e ver os 107 aparecerem na fila.
- Clicar num item da Central e conseguir alterar o texto ali mesmo.

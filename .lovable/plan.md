# Plano detalhado — Carteira protegida + Central de Agendamentos clara

## Parte A — Por que clientes da carteira recebem mensagem da IA

Auditei os 6 motores automáticos que mandam mensagem sozinhos. Só 3 respeitam a regra "carteira iGreen nunca é lead". Os outros 3 estão furando:


| Motor                        | Filtra carteira? | Cron          | O que faz                     |
| ---------------------------- | ---------------- | ------------- | ----------------------------- |
| `process-followups`          | ✅ Sim            | a cada 5 min  | Follow-up do bot              |
| `bot-followup-checker`       | ✅ Sim            | a cada 30 min | Esfriar leads sem resposta    |
| `reactivation-cron`          | ✅ Sim            | a cada 1 h    | Reaquecimento                 |
| `**bot-stuck-recovery**`     | ❌ **NÃO**        | a cada 5 min  | IA "resgate" para lead parado |
| `**faq-reengagement-nudge**` | ❌ **NÃO**        | a cada 5 min  | Nudge depois de FAQ           |
| `**bot-loop-watchdog**`      | ❌ **NÃO**        | a cada 15 min | Quebra loop do bot            |


Estes 3 últimos varrem `customers` sem checar `customer_origin`, então pegam clientes da carteira (`igreen_sync`) e mandam IA falar com eles.

**Correção (sem dúvida, posso fazer já):**

1. Criar `supabase/functions/_shared/origin-guard.ts` com um único helper `LEAD_ORIGIN_FILTER` (texto PostgREST) e `isLeadEligible(origin)`.
2. Aplicar nos 3 motores furados + trocar as cópias soltas dos outros 3 pelo helper compartilhado.
3. Adicionar teste unitário no `_shared/__tests__`.

## Parte B — Crons duplicados e órfãos (achados ao vivo em `cron.job`)


| #   | Cron                                                                                       | Situação                                                                                                             | Recomendação                                      |
| --- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| 1   | `ai-followup-cron-15min`                                                                   | Bate em `/functions/v1/ai-followup-cron` mas **a função não existe no repo**. Está dando 404 há tempos.              | **Remover** (é cron fantasma)                     |
| 2   | `instance-health-cron` (jobid 43) **vs** `instance-health-cron-10min` (jobid 37)           | Mesmo endpoint, mesma cadência `*/10`. Roda em paralelo.                                                             | **Remover** o `instance-health-cron` (sem sufixo) |
| 3   | `cleanup-webhook-dedup` (jobid 7) **vs** `cleanup-webhook-dedupe` (jobid 29)               | A tabela real chama `webhook_message_dedup` (sem "e"). O cron `cleanup-webhook-dedupe` deleta de tabela inexistente. | **Remover** o `cleanup-webhook-dedupe` (jobid 29) |
| 4   | `facebook-creative-rotator-12h` (00h e 12h) **vs** `facebook-creative-rotator-daily` (08h) | Ambos chamam `/facebook-creative-rotator`. Resultado: o rotator roda 3× por dia (00h, 08h, 12h).                     | **Decidir comigo** (ver pergunta 1)               |


Os 4 itens viram **uma única migração SQL** com `cron.unschedule(...)`.

## Parte C — Central de Agendamentos confusa (UI)

Hoje a tela mistura linguagem técnica com nome de tabela e de cron, e tem 6 abas com sobreposição.

### Renomear o que o consultor vê


| Hoje (confuso)                                                                     | Vira (claro em PT)                                                             |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| "Fila com data fixa" / "scheduled_messages"                                        | **Agenda manual**                                                              |
| "Pós-venda automático" + nome do cron                                              | **Pós-venda automático** (sem cron exposto)                                    |
| "Conversão & reaquecimento" + "Follow-up bot" (são dois cards de coisas parecidas) | Um único: **Reaquecimento de leads**                                           |
| "Disparo PRO"                                                                      | **Campanhas em massa**                                                         |
| "CRM — ao mover coluna"                                                            | Sai da Central (é envio imediato, não agendamento). Vira nota dentro do Kanban |
| "Resgate IA (bot-stuck-recovery · 5 min)" no rodapé                                | **IA de resgate** com selo Ligado/Desligado                                    |
| "Pronto / atrasado"                                                                | **Vai sair agora**                                                             |
| "Em andamento"                                                                     | **Enviando**                                                                   |
| "Falhou"                                                                           | **Erro — clique para ver**                                                     |
| "send-scheduled-messages · 5 min" (rodapé técnico)                                 | escondido em tooltip "Detalhes" só para admin                                  |


### Reduzir 6 abas para 5

`Visão geral` · `Agenda manual` · `Pós-venda` · `Reaquecimento de leads` · `Campanhas em massa` · `Histórico`

(A aba "Conversão" some — vira parte de "Reaquecimento de leads".)

### Aviso fixo no topo

> "Clientes da carteira iGreen nunca recebem reaquecimento, resgate ou nudge automático. Só leads do WhatsApp e cadastros manuais."

### Limpeza de código

- Apagar `src/components/whatsapp/SchedulePanel.tsx` (é só um re-export deprecated do `AgendamentosHub`) e ajustar o import lazy no `WhatsAppTab`.
- O hook `useAgendamentosHub` continua igual; só os rótulos/abas mudam.

## Parte D — Perguntas que preciso te confirmar

**Pergunta 1 — Rotator do Facebook**
O `facebook-creative-rotator` está agendado em **2 crons ao mesmo tempo**:

- `facebook-creative-rotator-12h` → roda às 00:00 e 12:00
- `facebook-creative-rotator-daily` → roda às 08:00

Total: 3 rotações por dia, do mesmo endpoint. Qual destes você quer manter?

- **(a)** Manter só o de 12 em 12 horas (00h e 12h) — 2 rotações/dia
- **(b)** Manter só o diário (1× às 08h) — 1 rotação/dia
- **(c)** Trocar tudo por **1 rotação a cada 6 horas** (00h, 06h, 12h, 18h)
- **(d)** Deixar como está (3 por dia)  
B DIARIO ( MAS TEM QUE ESTAR NA CENTRAL PARA CONFIGURAR E AJUSTAR )

**Pergunta 2 — Mensagens automáticas ao mover card no Kanban**
Hoje a Central de Agendamentos lista o item "CRM — ao mover coluna" junto com os agendados, mas ele não é agendado: dispara na hora que o consultor arrasta um card. Isso confunde a contagem ("X envios programados" mistura coisas que vão sair sozinhas com coisas que dependem da ação do consultor).

- **(a)** Tirar da Central e deixar só dentro do Kanban (mais limpo, mas o consultor precisa lembrar de checar lá)
- **(b)** Manter na Central, mas em uma seção separada chamada **"Dispara na hora (sem fila)"**, sem contar no total de agendados (  oque dispara na hora nao foi agendado mas entra no historico o que foi aprovado recebeu e oque vai receber daqui 30 dias entra no agendado)

**Pergunta 3 — Quem dispara a IA de resgate (`bot-stuck-recovery`)**
Esse cron usa IA para "resgatar" lead parado em algum passo do bot. Quero confirmar o escopo da correção da Parte A:

- **(a)** Ignorar **qualquer cliente** com `customer_origin = 'igreen_sync'` ou `'igreen_extension'` (carteira do portal e extensão Chrome) — recomendado, é a regra que você descreveu
- **(b)** Ignorar só `igreen_sync` (deixa a extensão dentro)  
opacao a cliente nunca entra em nada, apenas se eu ou o consultor clicar em aprovado, mas sempre se o consultor clicar em aprovado por qlee ja ser cliente ai innicia 30 60 90 120 dias ou rerpovado, mas nao foi autoamatico e sim o consultor que clicou

**Pergunta 4 — Texto do aviso fixo no topo da Central**
Posso usar exatamente este texto?

> "Clientes da carteira iGreen nunca recebem reaquecimento, resgate ou nudge automático. Só leads do WhatsApp e cadastros manuais."

Se preferir outro tom, escreve aqui que coloco igual.

---

Depois das suas respostas eu emendo o plano final e começo a implementar. Se quiser, posso **já adiantar a Parte A (tampar o vazamento da IA na carteira)** enquanto você pensa nas perguntas — é a parte mais urgente.  
  
pode implantar tudo de acordo com as respostas, faca a e depois analiase faca o b analise assim nao da erro
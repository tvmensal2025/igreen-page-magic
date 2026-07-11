# Atendimento em Lote na Captação + Fluxo Automático

## O que muda pra você

Na tela **Captação** vai ter um botão único **"Abrir atendimento para todos"** que:

1. Seleciona todos os leads do período que **ainda não têm atendimento aberto** (ignora quem já tem `welcome_sent_at`, quem já é cliente, quem não tem telefone).
2. Abre o modal atual `**OpenAttendanceBatchDialog**` já com todo mundo pré-marcado.
3. Deixa você escolher **como enviar** — agora com 4 opções (hoje só tem 3):
  - Texto (template ou escrito na hora)
  - Áudio de template
  - **Gravar áudio na hora** (novo — mesmo gravador do chat)
  - **Enviar arquivo do computador** (novo — imagem/PDF/áudio soltos, sem precisar virar template)
4. Marca **"fechar atendimento automaticamente após X minutos"** (opcional, default desligado).

O sistema faz na fila: `start-customer-attendance` (só se ainda não iniciado) → áudio/arquivo → texto → intervalo 5s → próximo lead.

## Proteções (nunca abre em cima de atendimento ativo)

- Filtro na seleção: só entra lead com `welcome_sent_at IS NULL` **E** sem `outcome` **E** sem `igreen_code`.
- Pill visual "Já iniciado" continua bloqueando envio duplicado (edge `start-customer-attendance` já devolve `skipped: already_sent`).
- Toggle universal `automation_toggles.start_customer_attendance` continua valendo — se estiver OFF, o botão avisa e não dispara.

## Auto-fechar atendimento (opcional)

Se marcar "fechar em X min":

- Ao terminar o disparo de cada lead, agenda um registro em `scheduled_messages` do tipo `close_attendance` com `send_at = now() + X min`.
- Nova edge `close-attendance-scheduled` (chamada pelo cron `send-scheduled-messages` que já existe) executa `end-customer-attendance` para cada agendamento vencido — respeitando o toggle `end_customer_attendance`.
- Se o cliente responder no meio, o gatilho `trg_cadence_on_inbound` cancela o auto-fechamento (adiciona coluna `cancelled_at` em `scheduled_messages`).

## Auditoria dos agendamentos (Central de Agendamentos)

Vou verificar em `/admin/agendamentos-central` que estes jobs existem e estão listados (mesmo desligados por enquanto):


| Job                                 | Cron                    | Toggle                    | Status esperado |
| ----------------------------------- | ----------------------- | ------------------------- | --------------- |
| `cadence-tick`                      | */5 min                 | `cadence_engine_enabled`  | ✅ já existe     |
| `send-scheduled-messages`           | */1 min                 | —                         | verificar       |
| `close-attendance-scheduled` (novo) | roda dentro do anterior | `end_customer_attendance` | criar           |
| `reactivation-cron`                 | horário                 | `reactivation_enabled`    | ✅               |
| `process-followups`                 | */10 min                | `followups_enabled`       | ✅               |
| `facebook-retarget-sync`            | 3x/dia                  | `retarget_enabled`        | ✅               |
| `bulk-scheduler`                    | */5 min                 | `bulk_enabled`            | ✅               |
| `pos-venda-auto-progress`           | horário                 | `pos_venda_enabled`       | ✅               |


Se algum estiver faltando na UI, adiciono na lista de `admin-cron-status`.

## Arquivos que vou mexer

- `src/components/captacao/CaptureLeadList.tsx` — botão "Abrir para todos do período" + contador "N prontos / M já iniciados".
- `src/components/captacao/OpenAttendanceBatchDialog.tsx` — abas Gravar/Arquivo + toggle auto-fechar.
- `src/components/captacao/runAttendanceBatch.ts` — aceita `recordedAudioBlob`, `uploadedFile`, `autoCloseAfterMin` e agenda o fechamento.
- **Nova edge** `supabase/functions/close-attendance-scheduled/index.ts` — consome fila.
- **Migration**: coluna `scheduled_messages.kind` (se ainda não tiver `close_attendance`) + `cancelled_at`.
- `src/pages/AdminAgendamentosCentral.tsx` — inclui o novo job na lista.

## Riscos e como evitar

- **Duplo envio**: já protegido pelo `already_sent` + filtro na UI.
- **Auto-fechar cliente que respondeu**: cancelado pelo trigger de inbound + verificação na edge antes de fechar.
- **Upload de arquivo pesado**: limite 16 MB (padrão Whapi/Evolution), aviso no dialog.
- **Automação global OFF**: nada dispara — só faz o `start-customer-attendance` que já é "ação manual do consultor" (fica fora do kill-switch de mensagens automáticas, conforme padrão atual).

Confirma que posso implementar tudo isso num commit só? SIM, MAS ANALISE O CODIGO PARA NAO DUPLICAR E OCORRER ALGUM ERRO

&nbsp;
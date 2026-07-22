## Diagnóstico — por que "continua falhando"

Auditei o lead `8295edbe...` (número `5534997081920`) e a resposta é: **o sistema já não está mais discando esse número. O que aparece como "Ligação falhou" no painel são dois registros distintos, e só o primeiro chegou de fato na Velip.**

Timeline real do lead em `outbound_effects`:


| Estágio          | Canal    | Status           | Detalhe                                                          |
| ---------------- | -------- | ---------------- | ---------------------------------------------------------------- |
| A_NUDGE          | whatsapp | sent             | 21/07 15:40                                                      |
| A_SMS            | sms      | sent             | 21/07 17:40                                                      |
| **A_CALL**       | voice    | **failed_final** | Velip devolveu `IK` (número inexistente)                         |
| **A_CALL_RETRY** | voice    | **failed_final** | `error_code = velip_reproved:IK` — **bloqueado antes de discar** |
| COLD_1           | whatsapp | sent             | 21/07 20:50                                                      |
| SMS_1            | sms      | sent             | 21/07 22:55                                                      |


O guard em `cadence-tick/index.ts:600-615` já busca IK/EK/CK/BK anteriores por (consultant_id, telefone) e devolve `permanent: true` — foi exatamente o que aconteceu no A_CALL_RETRY. **Não gastou saldo Velip, não repetiu a ligação.**

`voice_call_logs` confirma: só existe **1** registro para esse número (21/07 14:05 UTC), não vários.

## Os próximos vão passar?

Sim. Nas últimas 24h úteis: **166 ligações OK, 221 sem-atendimento, 12 IK/EK (~3%)**. O motor está saudável. Só 6 leads no total têm número marcado como inválido pela Velip — todos já protegidos pelo mesmo guard.

## O que ainda pode melhorar (opcional, curto)

1. **Rótulo enganoso no painel.** O A_CALL_RETRY aparece como "Ligação falhou" idêntico ao A_CALL, mas ele nunca discou. Trocar o texto para "Número inválido — suprimido (IK)" quando `error_code` começa com `velip_reproved:` no componente do Hub de Agendamentos / detalhe do lead.
2. **Backfill do `voice_dnc_list`.** Hoje o auto-DNC no `voice-dialer-webhook` só grava quando existe `campaign_id` (linha 439). Ligações do motor de cadência não têm campanha, então o DNC fica vazio e o guard do cadence-tick é a única defesa. Adicionar upsert em `voice_dnc_list` também no fluxo cadence-tick quando a Velip devolve IK/EK/CK/BK. Cria segunda camada e serve o painel de "números inválidos".
3. **Relatório "Leads com número inválido".** Aba simples em `/admin/agendamentos` (ou dentro do detalhe do lead) listando os 6 leads com `phone_whatsapp` marcado como IK/EK/CK/BK, com botão "Corrigir telefone" e "Marcar não perturbar".

### Arquivos que seriam tocados

- `src/components/admin/AgendamentosHub.tsx` — badge/rótulo do card quando `error_code` começa com `velip_reproved:`.
- `supabase/functions/cadence-tick/index.ts` (~linha 640, após capturar `velip_status`) — upsert em `voice_dnc_list` para códigos permanentes.
- Novo componente `src/components/admin/InvalidPhonesPanel.tsx` (opcional) e ponto de entrada no Hub.

Nenhum item bloqueia a operação — o motor já está tratando IK corretamente hoje.

## Pergunta

Quer que eu implemente os 3 itens acima, só o (1)+(2), ou nada — dado que o comportamento já está correto e é só uma questão de UX? OS 3

&nbsp;
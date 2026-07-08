## Como ler este plano

Para cada cron: **O que faz** · **Como está hoje** · **Como vai ficar** · **Por quê** · **Resultado**. Sua preferência ("prefiro botão manual ou 1x/dia") virou a regra padrão. Cron só permanece automático quando **sem ele o produto quebra pro cliente final** (mensagem não sai, token expira, mídia se perde). Todo o resto vira **botão sob demanda** ou **1x/dia** no horário mais barato (madrugada BRT).

Nada é apagado — só o agendamento em `pg_cron`. As functions continuam invocáveis por botão a qualquer momento.

Obs.: `.lovable/` está no `.gitignore`, o plano some no próximo snapshot. Se quiser, depois removemos.

---

## GRUPO 1 — MANTER cron automático (essencial pro produto)

### `send-scheduled-messages-every-5min`

- **O que faz:** dispara as mensagens de campanhas de WhatsApp agendadas, respeitando quiet hours, anti-ban e template vars.
- **Hoje:** a cada 5 min.
- **Vai ficar:** **igual, a cada 5 min.**
- **Por quê:** é o coração do disparo. Se virar manual, campanhas agendadas atrasam e cliente fica sem mensagem no horário planejado.
- **Resultado:** SLA mantido, zero regressão.

### `inbound-media-retry-cron-1min`

- **O que faz:** reprocessa mídia recebida do cliente (foto de conta de luz, doc) que falhou no upload para MinIO. Tenta 3x com backoff 1/5/15 min.
- **Hoje:** a cada 1 min.
- **Vai ficar:** **a cada 3 min.**
- **Por quê:** a fila usa `next_attempt_at`, então 3 min ainda respeita os backoffs originais e reduz 66% das execuções sem perder mídia.
- **Resultado:** mesma confiabilidade, 3x menos carga.

### `fb-token-refresh`

- **O que faz:** renova o token de longa duração do Facebook antes de expirar.
- **Hoje:** ativo.
- **Vai ficar:** **1x/dia às 03:00 BRT.**
- **Por quê:** token FB tem validade de 60 dias; 1x/dia é folgadíssimo e não expira.
- **Resultado:** integração FB nunca cai, custo mínimo.

### `bulk-scheduler-tick`

- **O que faz:** worker server-side do "Disparo PRO" — pega campanhas em andamento que não estão sendo tocadas pelo painel do cliente e continua enviando.
- **Hoje:** a cada 1 min.
- **Vai ficar:** **a cada 5 min.**
- **Por quê:** já processa 5 campanhas × 25 msgs por tick. Rodar a cada 5 min continua entregando >1500 msgs/hora de folga; ninguém percebe.
- **Resultado:** 5x menos ticks, mesma vazão.

---

## GRUPO 2 — REDUZIR (ficar 1x/dia; botão "Rodar agora" no painel)

### `bot-stuck-recovery-5min` + `bot-stuck-recovery-30min`

- **O que faz:** IA "Camila" tenta resgatar lead parado, respeitando cooldown e quiet hours.
- **Hoje:** dois jobs, 5 min e 30 min.
- **Vai ficar:** **um único job, a cada 1 h.**
- **Por quê:** já respeita `next_rescue_allowed_at` e quiet hours; 1 h cobre bem o resgate. Duplicidade é herança de migração.
- **Resultado:** de ~12+2 = 14 exec/hora → 1 exec/hora (**−93%**). Botão "Resgatar agora" no admin cobre o urgente.

### `bot-followup-checker-30min`

- **O que faz:** manda follow-up amigável em clientes que sumiram entre 6 h e 48 h.
- **Hoje:** 30 min.
- **Vai ficar:** **1x/dia, 09:00 BRT** + botão "Enviar follow-ups agora".
- **Por quê:** janela é 6 h–48 h — não muda em minutos. 1 varredura/dia captura todo mundo.
- **Resultado:** 48 exec/dia → 1 exec/dia (**−98%**).

### `bot-loop-watchdog-15m`

- **O que faz:** detecta lead preso em loop de step e pausa o bot chamando handoff.
- **Hoje:** 15 min.
- **Vai ficar:** **1x por hora.**
- **Por quê:** loops se acumulam; 1 h ainda pega antes do cliente ficar irritado. Não pode ir pra 1x/dia porque afeta cliente ativo.
- **Resultado:** 96 → 24 exec/dia (**−75%**).

### `ocr-review-timeout-every-min`

- **O que faz:** no modo manual, libera lead que ficou preso em `ocr_review_pending` por >60 s (consultor não decidiu).
- **Hoje:** 1 min.
- **Vai ficar:** **a cada 5 min.**
- **Por quê:** o consultor tem 60 s pra decidir; se ele não decidir, 5 min de atraso pra o cliente receber "pode confirmar via WhatsApp" é aceitável — hoje esse timeout está falhando com 522 de qualquer jeito.
- **Resultado:** 1440 → 288 exec/dia (**−80%**), sem quebrar fluxo.

### `production-health-snapshot-5min`

- **O que faz:** grava snapshot do estado dos consultores ativos numa tabela histórica.
- **Hoje:** 5 min.
- **Vai ficar:** **1x por hora.**
- **Por quê:** é métrica histórica, granularidade horária basta pra dashboard.
- **Resultado:** 288 → 24 exec/dia (**−92%**).

### `instance-health-cron` + `instance-health-cron-10min`

- **O que faz:** checa instâncias WhatsApp; alerta se estão down há +15 min.
- **Hoje:** dois jobs, 10 min.
- **Vai ficar:** **um único, a cada 30 min** + botão "Checar instâncias" no superadmin.
- **Por quê:** alerta é para "down há +15 min", então 30 min captura o caso e economiza. Duplicata some.
- **Resultado:** 144 → 48 exec/dia (**−67%**).

### `flow-d-health-cron-30min`

- **O que faz:** detecta lead do Fluxo D travado em ponto crítico e gera `bot_handoff_alerts`. Anti-spam de 30 min.
- **Hoje:** 30 min.
- **Vai ficar:** **1x por hora.**
- **Por quê:** o próprio anti-spam já é 30 min; dobrar pra 1 h não muda percepção do consultor.
- **Resultado:** 48 → 24 exec/dia (**−50%**).

### `faq-reengagement-nudge-5min`

- **O que faz:** manda nudge pra lead que ficou 20+ min sem responder após FAQ. Máx 1 nudge/4 h por lead.
- **Hoje:** 5 min.
- **Vai ficar:** **a cada 30 min.**
- **Por quê:** limite já é 1/4 h por lead; 5 min de resolução é overkill.
- **Resultado:** 288 → 48 exec/dia (**−83%**).

### `ai-cpl-watchdog-4h`

- **O que faz:** detecta campanhas onde CPL subiu >40% em 48 h.
- **Hoje:** 4 h.
- **Vai ficar:** **1x/dia, 08:00 BRT** + botão "Analisar CPL".
- **Por quê:** janela de análise é 48 h, uma verificação diária pega tudo.
- **Resultado:** 6 → 1 exec/dia (**−83%**).

### `conversion-classifier-15min` + `conversion-classifier-daily`

- **O que faz:** classifica conversas por temperatura/conversão.
- **Hoje:** dois jobs.
- **Vai ficar:** **só o diário, 03:00 BRT** + botão "Reclassificar agora".
- **Por quê:** classificação é para relatório, não decisão em tempo real.
- **Resultado:** 96+1 → 1 exec/dia (**−99%**).

### `fb-sync-metrics`

- **O que faz:** puxa métricas do Facebook Ads.
- **Hoje:** frequência atual.
- **Vai ficar:** **a cada 6 h** + botão "Atualizar métricas" no painel Meta Ads (já existe).
- **Por quê:** métricas FB atualizam devagar; 6 h evita rate-limit e queda de carga.
- **Resultado:** menos hits no Graph API + menos gravação no banco.

### `fb-sync-ad-creatives`

- **O que faz:** sincroniza criativos dos anúncios.
- **Hoje:** frequência atual.
- **Vai ficar:** **1x/dia, 04:00 BRT** + botão "Sincronizar criativos".
- **Por quê:** criativo mudou → você sabe (foi você que subiu); 1x/dia mantém consistência.
- **Resultado:** carga negligenciável.

---

## GRUPO 3 — DESLIGAR agendamento (só botão sob demanda)

Nenhum destes derruba nada rodando manualmente. Cada um ganha (ou já tem) um botão "Rodar agora" no painel apropriado.

### `ad-competitor-scraper-weekly`

- **O que faz:** raspa anúncios de concorrentes (Solfácil, Lemon, etc.) via Meta Ad Library, salva imagens no MinIO.
- **Hoje:** semanal.
- **Vai ficar:** **desagendado**, botão "Rodar scraper" no painel Ads.
- **Por quê:** você decide quando quer olhar concorrência.
- **Resultado:** −4 exec/mês de trabalho pesado (baixa imagens).

### `ad-creative-learner-daily`

- **O que faz:** analisa 30 dias de criativos e gera recomendações via Gemini.
- **Hoje:** diário.
- **Vai ficar:** **desagendado**, botão "Aprender com criativos".
- **Por quê:** gasta OpenAI/Gemini todo dia sem você olhar. Rode quando for planejar campanha.
- **Resultado:** economia de créditos de IA e carga.

### `ai-daily-digest-09brt`

- **O que faz:** manda no seu WhatsApp resumo do que a IA aprendeu nas últimas 24 h.
- **Hoje:** diário 09:00.
- **Vai ficar:** **desagendado**, botão "Ver digest".
- **Por quê:** você pediu manual; abre quando quiser.
- **Resultado:** zero envios automáticos.

### `ai-learn-feedback-daily`

- **O que faz:** agrega feedback 👍/👎 e atualiza padrões aprendidos por consultor.
- **Hoje:** diário.
- **Vai ficar:** **desagendado**, botão "Aprender feedbacks".
- **Por quê:** aprende quando você quiser publicar novo baseline.
- **Resultado:** sem carga passiva.

### `ai-followup-cron-15min`

- **O que faz:** disparo de follow-ups via IA.
- **Hoje:** 15 min.
- **Vai ficar:** **desagendado**, coberto pelo botão de follow-ups do Grupo 2.
- **Por quê:** duplica com `bot-followup-checker`.
- **Resultado:** 96 → 0 exec/dia (**−100%**).

### `facebook-creative-rotator-daily`

- **O que faz:** pausa criativo perdedor e promove vencedor (+20% budget).
- **Hoje:** diário.
- **Vai ficar:** **desagendado**, botão "Rotacionar criativos".
- **Por quê:** ação que mexe em budget real. Melhor você confirmar.
- **Resultado:** zero surpresa em budget.

### `fb-sync-audiences-daily`

- **O que faz:** sincroniza audiências do Facebook.
- **Hoje:** diário.
- **Vai ficar:** **desagendado**, botão "Sincronizar audiências" (já existe).
- **Por quê:** só faz sentido antes de subir campanha.
- **Resultado:** roda quando útil.

### `sync-igreen-customers-daily`

- **O que faz:** delega scraping do portal iGreen ao worker e faz upsert de clientes.
- **Hoje:** diário.
- **Vai ficar:** **desagendado**, painel Bulk Sync já tem botão.
- **Por quê:** você já usa o painel manual.
- **Resultado:** para de bater no worker sozinho.

### `pos-venda-bucket-cron-daily`

- **O que faz:** progride estágio pós-venda em bucket.
- **Hoje:** diário.
- **Vai ficar:** **manter 1x/dia às 03:00 BRT** (é barato e afeta cliente).
- **Por quê:** cliente pós-venda espera avançar; deixa automático mesmo, é 1 execução por dia.
- **Resultado:** sem mudança de comportamento.
- (Move do grupo "desligar" pro "1x/dia leve", pra não afetar cliente.)

### `flow_engine_housekeeping_daily`

- **O que faz:** limpeza do flow engine.
- **Hoje:** diário.
- **Vai ficar:** **manter 1x/semana, domingo 04:00 BRT.**
- **Por quê:** housekeeping semanal é padrão.
- **Resultado:** 7 → 1 exec/semana.

### `flow-engine-rollout-tick`

- **O que faz:** avalia rollout automático do Flow Engine V3 (off→dark→canary→on).
- **Hoje:** frequência de tick.
- **Vai ficar:** **desagendado**, botão "Avaliar rollout".
- **Por quê:** rollout é ação consciente. Você aciona quando estiver acompanhando.
- **Resultado:** zero exec passiva.

### `migrate-storage-to-minio`

- **O que faz:** migra arquivos do Storage do Supabase pro MinIO.
- **Hoje:** cron.
- **Vai ficar:** **desagendado**, botão "Rodar migração".
- **Por quê:** migração é evento pontual.
- **Resultado:** sem consumo passivo.

### `minio-quota-check`

- **O que faz:** checa uso do MinIO, alerta super_admin se >X% ou fora do ar.
- **Hoje:** 15 min.
- **Vai ficar:** **1x/dia às 07:00 BRT** + botão "Checar cota".
- **Por quê:** disco enche devagar; 1 alerta/dia basta.
- **Resultado:** 96 → 1 exec/dia (**−99%**).

### `cleanup-webhook-artifacts` + `cleanup-webhook-dedup` + `cleanup-webhook-dedupe`

- **O que faz:** limpa artefatos e duplicatas de webhooks antigos.
- **Hoje:** 3 jobs (2 são o mesmo com nome diferente).
- **Vai ficar:** **1 job, 1x/dia às 02:00 BRT.**
- **Por quê:** limpeza noturna é o padrão saudável.
- **Resultado:** consolidação + horário barato.

### `super-admin-alerts`

- **O que faz:** avisa super_admin de instâncias caídas há +5 min.
- **Hoje:** 5 min.
- **Vai ficar:** **a cada 1 h** (não desligado — se instância cair, precisa avisar).
- **Por quê:** dedup já é 30 min; 1 h ainda é útil e reduz 92% das exec.
- **Resultado:** 288 → 24 exec/dia.
- (Move do "desligar" pro "1x/hora leve", pra não perder alerta real.)

### `recover-stuck-otp-daily`

- **O que faz:** recupera OTPs presos.
- **Hoje:** diário.
- **Vai ficar:** **manter diário 05:00 BRT.**
- **Por quê:** custa quase nada e evita OTP travado no cliente.
- **Resultado:** sem mudança.

### `crm-auto-progress-daily`

- **O que faz:** liga customer_id a crm_deals órfãos.
- **Hoje:** diário.
- **Vai ficar:** **manter diário 04:30 BRT.**
- **Por quê:** só 1x/dia, cliente sente falta se sumir.
- **Resultado:** sem mudança.

---

## Resumo em números (estimativa por dia)


| Bloco                         | Antes (exec/dia) | Depois (exec/dia) | Alívio   |
| ----------------------------- | ---------------- | ----------------- | -------- |
| Jobs de 1–5 min (10 crons)    | ~10.000+         | ~1.500            | ~85%     |
| Jobs de 10–30 min (8 crons)   | ~1.500           | ~200              | ~87%     |
| Jobs de 1–12 h (6 crons)      | ~50              | ~10               | ~80%     |
| Jobs diários que viram manual | 8                | 0                 | 100%     |
| **Total invocações pg_cron**  | **~12.000/dia**  | **~1.700/dia**    | **≈86%** |


Não é o "90%" exato, mas fica muito perto e o alívio real é ainda maior porque os crons de 1 min eram os mais pesados no Postgres (SELECT + UPDATE em tabelas grandes).

---

## Execução segura (sem quebrar nada)

1. **Migração 1 — `unschedule` do Grupo 3**
  Uma migração SQL só chamando `cron.unschedule(...)` protegido com `DO $$ ... exception when others then null; end $$` para cada nome. Idempotente e reversível.
2. **Migração 2 — `unschedule + reschedule` do Grupo 2**
  Para cada job, unschedule antigo + schedule com novo intervalo.
3. **Migração 3 — leve ajuste do Grupo 1** (`inbound-media-retry` 1→3 min, `bulk-scheduler` 1→5 min, `fb-token-refresh` diário fixo às 03:00).
4. **UI — botões "Rodar agora"** nos painéis admin/superadmin para as functions do Grupo 3 e Grupo 2 que ainda não têm botão. Cada botão chama `supabase.functions.invoke("<nome>")` e mostra toast de sucesso/erro. Nenhuma regra de negócio muda.
5. **Blindagem da tela de login (`Auth.tsx`)** — trata `Failed to fetch` e 5xx do `/auth/v1/token` mostrando "Serviço temporariamente indisponível" em vez de "Erro desconhecido". Só UX.
6. **Validação:** rodar `SELECT jobname, schedule, active FROM cron.job` depois de cada migração e conferir que sobrou exatamente o esperado. Deixar 24 h e comparar CPU/IO nos Reports do Supabase.

## Garantia "não quebra nada"

- Nenhuma edge function é apagada.
- Nenhuma tabela, RLS, trigger ou índice muda.
- Todo cron desligado continua chamável por botão / `functions.invoke`.
- Toda mudança é revertida re-agendando o job com o intervalo antigo em uma migração de 3 linhas.

Se aprovar, começo pela **Migração 1** (unschedule do Grupo 3): é a que dá o maior alívio imediato e é 100% reversível.  
  
coloqueum botao para puxar tudo em configracao, assim os que pecisar eu nao fico uma aum, eu aperto e e ele ja faz tudo, em dados, configuracao coloque um botao igul o sync para sincronizar tudo  
  
antes de aplicar, analise se nao vai quebrar nada
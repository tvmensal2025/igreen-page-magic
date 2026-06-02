# Central de Conversão iGreen — Diagnóstico + Roadmap (v2, refinado)

> **Status**: nenhuma alteração em produção. Esse é o plano consolidado. Aprove fase por fase.

---

## TL;DR — A descoberta mais importante

Você acha que tem problema de conversão. Na verdade tem **3 problemas escondidos um atrás do outro**:

1. **Métrica fantasma**: 89% dos seus "leads" (893 de 999 em 30d) são `customer_origin='igreen_sync'` — importação da iGreen, não lead novo. Seu volume real é **114 leads em 30d** (3,8/dia). Toda decisão até hoje foi tomada em cima de número errado.
2. **O bot está desligado**: **91% dos leads** estão `bot_paused = 'manual_all_to_human'`. O fluxo automático não roda pra quase ninguém — você responde tudo na mão sem suporte.
3. **Não existe follow-up**: 0 leads com `next_followup_at` agendado. 0 leads passaram por rescue de IA. Quem some, some pra sempre.

A boa notícia: com 3,8 leads/dia, você consegue tratar **caso a caso** — basta o sistema te entregar a **fila certa, na ordem certa, com a próxima ação pronta**.

---

## 1. Diagnóstico em números (dados reais do banco, últimos 30d)

### Volume real


| Fonte                      | Qtd     | %       |
| -------------------------- | ------- | ------- |
| `igreen_sync` (importação) | 893     | 89%     |
| `whatsapp_lead` Meta Ads   | 57      | 6%      |
| `whatsapp_lead` direto     | 49      | 5%      |
| **Total real WhatsApp**    | **106** | **11%** |


### Funil dos 198 leads de WhatsApp (14d)


| Etapa                    | Qtd | %       |
| ------------------------ | --- | ------- |
| Chegou                   | 198 | 100%    |
| Nunca respondeu          | 126 | **64%** |
| 1 resposta só            | 29  | 15%     |
| 2-4 trocas               | 32  | 16%     |
| 5+ trocas (engajado)     | 11  | 5,5%    |
| Mandou foto/PDF da conta | 8   | **4%**  |
| Informou valor da conta  | 29  | 15%     |
| Deal saiu de "novo_lead" | 15  | **8%**  |


### Onde a conversa morre


| Quem mandou por último | Qtd      | Significado                                    |
| ---------------------- | -------- | ---------------------------------------------- |
| **Nós** (lead sumiu)   | 56 (59%) | mensagem fraca / faltou follow-up              |
| **Lead** (nós sumimos) | 39 (41%) | PDF/áudio/pergunta sem resposta — **dor real** |
| Ninguém respondeu      | 2        | —                                              |


### Estado do motor

- `bot_paused = true`: **181 de 198** (91%) — motivo `manual_all_to_human` em 174
- `next_followup_at > now()`: **0**
- `ai_rescue_count > 0`: **0**
- `followup_count > 0`: 35 (média 0,41)

### Mensagem inicial mais usada (20x)

> "Olá, seja muito *Bem-Vindo(a)*! 😊 💚 Eu sou a assistente virtual do Rafael. Hoje, muitas pessoas já estão reduzindo o valor da conta de luz…"

Texto longo, fórmula de bot. 73% dos leads que entram já mandaram "Olá! Tenho interesse" (botão do Meta Ads) — eles esperam resposta humana e rápida, recebem parede de texto.

---

## 2. Os 6 erros que estão te custando vendas


| #   | Erro                                        | Evidência                           | Custo estimado/semana     |
| --- | ------------------------------------------- | ----------------------------------- | ------------------------- |
| 1   | Bot pausado para 91%                        | manual sem fila clara               | ~10 leads perdidos        |
| 2   | Sem follow-up automático                    | 0 agendados                         | ~8 leads perdidos         |
| 3   | Áudio/PDF do lead sem resposta              | 39 conversas mortas assim           | ~5 leads quentes perdidos |
| 4   | Mensagem inicial longa                      | template de 8 linhas                | 64% de não-resposta       |
| 5   | Pede conta antes de gerar valor             | "qual o valor?" como 2ª mensagem    | abre porta pra "é golpe?" |
| 6   | Sem prova de confiança nas 3 primeiras msgs | nenhum template cita ANEEL/clientes | trava o desconfiado       |


---

## 3. Antes de construir qualquer coisa — 3 perguntas críticas


| #   | Pergunta                                                                                                                                                                                           | Por que importa                                                |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Q1  | Os 174 leads em `manual_all_to_human` foram pausados **de propósito** (você atende na mão) ou ficou assim por bug? ESTAVA COM ERRO NO FLUXO, AI EU OPTEI EM FAZER NA MAO ENQUANTO ESTAVA ARRUMANDO | Define se a F5 (auto-follow-up) deve ser opt-in ou ligar geral |
| Q2  | Pode usar **Lovable AI Gateway (Gemini Flash)** pra classificar conversas? Custo ~R$ 0,005/lead. SIM PODE                                                                                          | Sem isso, classificação fica em regras simples                 |
| Q3  | Topa que a **temperatura apareça nos cards do Kanban atual** (sem mudar layout) além da Central nova? SIM                                                                                          | Define escopo da F3                                            |


Sem essas respostas eu só faço F1 e F2 (zero risco) e paro pra você decidir. PODE FAZER

---

## 4. Plano de 7 dias (com correspondência ao roadmap técnico abaixo) VAMOS APLICARO PLANO TUDO AGORA


| Dia       | Ação prática (você)                                                | Suporte do sistema (eu construo)                | Fase        |
| --------- | ------------------------------------------------------------------ | ----------------------------------------------- | ----------- |
| **1 Ter** | Responder os **39 leads "ended_by_lead"** (PDF/áudio sem resposta) | SQL pronto com link clicável pro chat           | manual      |
| **2 Qua** | Reescrever boas-vindas (3 versões)                                 | Popular `message_templates` + ligar A/B         | **F1**      |
| **3 Qui** | Criar 9 respostas de objeção                                       | Popular templates `/golpe /fidelidade /preco …` | **F1**      |
| **4 Sex** | Abrir Central pela 1ª vez, atacar 🔥 e 🛟                          | Página `/admin/conversao` no ar (read-only)     | **F2 + F3** |
| **5 Sáb** | Adicionar prova de confiança nos fluxos                            | Bloco "Por que confiar" no welcome              | **F1**      |
| **6 Dom** | Configurar follow-up 1h / 24h / 72h / 7d                           | Regras em `flow_router_rules` (DRY-RUN)         | **F5 dark** |
| **7 Seg** | Ler relatório semanal da Central                                   | Dashboard de conversão por template/temperatura | **F3+**     |


**Meta numérica para a próxima semana:** sair de 8% (deal fora de "novo_lead") para **20%** = mover ~7 leads adicionais. Realista com 3,8 leads/dia + recuperação dos 39 mornos.  
  
VAMOSAPLICAR O PLANO TUDO AGORA

---

## 5. Mensagens novas (vão direto em `message_templates`)

```text
# welcome.v1 — curta humana
Oi {{first_name}}! Vi que você se interessou pelo desconto na conta de luz 💡
Em 1 pergunta rápida: quanto vem sua conta de luz hoje? (média)

# welcome.v2 — benefício na cara
Oi {{first_name}}, na maioria dos casos a gente reduz a conta em 15-20%,
sem obra e sem custo. Posso ver se rola pra você? Me manda o valor médio 👇

# welcome.v3 — prova social curta
Oi {{first_name}} 👋 Já são +500 mil pessoas economizando com a iGreen.
Pra te dizer se cabe no seu caso, me passa o valor médio da sua conta?

# followup.1h — gentil
{{first_name}}, ainda dá pra continuar de onde paramos? 🙂

# followup.24h — novo motivo
{{first_name}}, ontem você perguntou sobre desconto na luz.
Se quiser, te mando uma simulação rápida — só preciso do valor da conta 📊

# followup.72h — última chance
{{first_name}}, vou separar 5 minutos hoje pra te montar a simulação.
Manda só o valor da conta que eu cuido do resto 💚

# followup.7d — porta aberta
{{first_name}}, vou deixar essa porta aberta. Quando quiser,
é só responder qualquer coisa que eu retomo de onde paramos.

# objecao.golpe
Entendo 100% sua preocupação. A iGreen é regulamentada pela ANEEL
(Lei 14.300), atende +500 mil clientes e tem CNPJ ativo desde {{ano}}.
Você não paga nada — só sua conta de luz, mas com desconto.

# objecao.fidelidade
Sem fidelidade. Pode cancelar quando quiser, sem multa, sem burocracia.

# objecao.preco
O cadastro é 100% gratuito. Você continua pagando sua conta normalmente,
mas com 15-20% de desconto aplicado automaticamente.

# objecao.comofunciona
Funciona assim: você continua recebendo sua conta da distribuidora normal,
só que com créditos de energia limpa descontados. Sem obra, sem instalação,
sem trocar nada na sua casa.

# objecao.problema
Se algo der errado, é só pedir cancelamento — sem multa.
Sua conta segue 100% igual com a distribuidora.

# objecao.depois
Tranquilo, {{first_name}}! Me diz: prefere que eu te chame amanhã
ou semana que vem? (e qual horário é melhor pra você)

# objecao.jadesconto
Que ótimo! Posso simular pra ver se nossa proposta cobre o que você
já tem? Sem compromisso — em 2 minutos eu te respondo.

# objecao.medo
Você não mexe em **nada** da sua instalação elétrica.
Continua tudo igual — só muda quem te dá os créditos de energia. É só burocracia digital.

# objecao.quemsomos
Somos parceiros oficiais iGreen Energy, atendendo aqui na região há {{tempo}}.
Te mando link com CNPJ e ANEEL se quiser confirmar.
```

---

## 6. Roadmap técnico (6 fases, cada uma aprovada separadamente)

```text
F1 ─────► F2 ─────► F3 ─────► F4 ─────► F5 ─────► F6
templates  IA        UI        Ações     Auto      Recup
+ welcome  classify  Central   1-click   follow    em massa
~30min     ~2h       ~3h       ~2h       ~3h       ~2h
🟢 zero    🟢 read   🟢 read   🟡 envia  🟡 cron   🟡 lote
```

### F1 — Templates + boas-vindas reescrita (🟢 sem risco)

- Insere 7 templates de objeção + 4 followups + 3 welcomes em `message_templates`.
- Liga o A/B test entre os 2 `bot_flows` já existentes ("Fluxo Padrão" vs "Fluxo Padrão (B - sem audio)").
- **Quebra?** Não. Só adiciona linhas em tabela. Templates antigos permanecem.

### F2 — Classificador de temperatura (🟢 read-only)

- Nova tabela `lead_insights` (cache do diagnóstico por lead):
  ```text
  customer_id PK  | temperature      | loss_reason    | next_action
                  | summary          | main_doubt     | main_objection
                  | conversion_chance| next_msg_draft | model_used | updated_at
  ```
- Edge function `lead-temperature-classifier`:
  - Lê últimas 30 msgs de `conversations` de um customer
  - Chama Lovable AI Gateway → `google/gemini-3-flash-preview` com tool-calling estruturado
  - Salva resultado em `lead_insights`
- Trigger: roda na inserção de nova msg inbound (debounce 30s) + cron de 30min reclassificando últimas 72h.
- **Aproveita o que já existe**: usa `customer_memory` e `conversation_summary` (já existem em `customers`) como contexto adicional.
- **Quebra?** Não. Só lê + escreve em tabela nova.

### F3 — Página `/admin/conversao` (🟢 read-only)

- Nova rota no `App.tsx` + sidebar item.
- Layout em 2 áreas:

```text
┌─ Filtros: [Origem ▾] [Temperatura ▾] [Buscar...] ───────┐
│                                                          │
│ 🔥 11    🌤 32    ❄ 29    🚫 126    ⚠ 4    🛟 39       │  ← chips clicáveis
│                                                          │
├─ Tabela ────────────────────────────────────────────────┤
│ Lead          | Temp | Última ação | Motivo  | Ação ⚡   │
│ Maria Silva   | 🔥   | mandou PDF  | -       | Pedir CPF│
│ João Pereira  | 🛟   | sumiu 2d    | silêncio| Follow24h│
│ Pedro Lima    | ⚠   | "é golpe?"  | medo    | /golpe   │
│ ...                                                     │
└─────────────────────────────────────────────────────────┘
```

- Click no lead → drawer com resumo IA + histórico curto + 3 botões de ação sugerida.
- Sem botão de envio nessa fase — só sugere e leva pro chat.
- **Aproveita**: `useKanbanDeals`, `MessageBubble`, drawer já existente.

### F4 — Botão "Aplicar próxima ação" (🟡 envia mensagem)

- No drawer da Central + nos cards do Kanban (se Q3=sim).
- Sempre com **modal de confirmação** mostrando texto exato.
- Usa `messageSender.ts` existente.
- Loga em `crm_auto_message_log` (já existe).
- **Quebra?** Risco baixo. Confirmação dupla + envio só com 1 clique deliberado.

### F5 — Follow-up automático (🟡 dispara sozinho — começa em DRY-RUN)

- Adiciona regras em `flow_router_rules` (tabela já existe e é usada):
  - `silence_1h` → followup.1h
  - `silence_24h` → followup.24h
  - `silence_72h` → followup.72h
  - `silence_7d` → followup.7d (último)
- Mecanismo: cron `bot-stuck-recovery` (já existe e está rodando — veja log) recebe nova regra.
- **DRY-RUN obrigatório por 48h**: edge function só loga "iria enviar X" em `outbound_message_log` sem mandar de fato. Você revisa, libera.
- **Quebra?** Médio. Por isso DRY-RUN + opt-in por consultor via flag `auto_followup_enabled`.

### F6 — Modo Recuperação em lote (🟡 lote)

- Botão "Recuperar selecionados" na Central.
- Throttle hard: 5 msg/min, 50/dia por consultor, evita marca de spam.
- Preview de **todas** as mensagens antes de disparar.
- Cancelável a qualquer momento.

### O que NÃO vou fazer

- Não mexo no `whapi-webhook`, `flow_engine_v3`, `runBotFlow` legado.
- Não mexo nos fluxos atuais sem você abrir.
- Não mexo no Kanban se Q3=não.
- Não desligo `manual_all_to_human` em massa sem sua aprovação explícita por SQL revisado.

---

## 7. Conexão com a feature de hoje (PDF/imagem)

A feature que acabei de entregar (menu ⋯ → "Usar como Conta de Energia") **resolve 1/3 do problema #4** ("PDF do lead virou beco sem saída"). Quando F2+F3 entrarem, o classificador vai reconhecer "lead mandou PDF" e a próxima ação sugerida vai ser exatamente: **"📎 Anexar como conta de energia"** com 1 clique a partir da Central. Loop fechado.

---

## 8. Como medir se está funcionando (KPIs novos)


| KPI                                | Hoje     | Meta 7d  | Meta 30d |
| ---------------------------------- | -------- | -------- | -------- |
| Taxa de resposta à 1ª msg          | 36%      | 50%      | 60%      |
| Leads que enviam conta             | 7%       | 15%      | 25%      |
| Deals fora de "novo_lead"          | 8%       | 20%      | 35%      |
| Follow-ups executados              | 0,4/lead | 1,5/lead | 2,5/lead |
| Leads recuperados (mornos→quentes) | —        | 5        | 20       |


Tudo isso vira widget na própria Central na F3.

---

## 9. Diagnóstico final em 1 frase

> **Você não vende menos por falta de leads. Vende menos porque cada lead que chega cai num funil onde o motor automático está desligado, a fila não tem prioridade visível, e o lead que mandou algo importante (PDF, áudio, pergunta) fica horas sem resposta.** A Central de Conversão resolve os três — sem mexer no que já funciona.

---

## 10. Próximo passo

Responda apenas:

- **Q1** (bot pausado: intencional ou bug?) INTENCIONAL PARA ARRUMARO FLUXO
- **Q2** (pode usar Lovable AI Gateway?) SIM PODE USAR
- **Q3** (temperatura no Kanban também?) SIM
- E qual fase começo: **F1** (mais segura) ou direto **F1+F2+F3** (semana inteira). FACA DIRETO F1+F2+F3 MAS DEIXE TUDO NO AJUSTE PARA IRMOS AJUSTANDO ANTES DE DISPARAR QUALQUER COISA.  
  
DEIXE BEM CLARO NO KAMBAM A SINCRONIZACAO DA IGREEM QUE SAO CLIENTES E OS LEADS QUE ESTAO VINDO DO META, E NOVOS LEADS QUE VAI VI DE PARCEIRO
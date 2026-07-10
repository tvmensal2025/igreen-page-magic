# Velip — ampliação do módulo Ligação

Vamos deixar o módulo Velip integrado ao restante do CRM (clientes, captação e chat), com transparência total de saldo e gastos.

## 1. Base = seus clientes (não só listas manuais)

Em **Admin → Ligação → Nova ligação**, além das bases manuais e do upload livre, adicionar seletor **"Usar meus clientes"** com filtros:

- Status (ativo / em cadastro / perdido / etc.)
- Cidade / UF
- Tag / etapa do Kanban
- Origem (campanha, parceiro, captação)
- Faixa de valor da conta

Preview mostra quantos clientes casam com o filtro e permite salvar como base reutilizável em 1 clique.

## 2. Saldo Velip e consumo visível

Banner de saúde ganha:

- **Saldo atual** (via `GetAccountBalance` da Velip)
- **Gasto hoje / semana / mês** (soma `voice_call_logs.cost` + `voice_sms_log.cost`)
- **Custo médio por ligação atendida**
- Alerta amarelo quando saldo < gasto médio de 3 dias; vermelho quando < 1 dia

Painel (aba **Painel**) ganha gráfico de gasto diário 30 dias, separado por Ligação × TTS × SMS.

## 3. Botão "Agendar ligação" em 3 lugares

Novo componente `ScheduleCallButton` reaproveitável, que abre um dialog com:

- Data/hora
- Áudio gravado **ou** texto TTS **ou** template salvo
- BINA (opcional)
- Retry (nº tentativas, intervalo)

Locais:

- **Captação** → dentro do `CaptureSheet` e ação em lote na `CaptureLeadList` (mesmo padrão do "Iniciar atendimento")
- **Chat WhatsApp** → header do `ChatView`, ao lado de "Iniciar atendimento" / "Encerrar captação"
- **CRM/Cliente** → ficha do cliente

Cada agendamento vira uma campanha Velip de 1 alvo (mesma engine já existente), com `scheduled_at` respeitado pelo cron.

## 4. Outras funções que estão faltando (e entram nesta leva)

- **Rediscagem inteligente**: em ligações `NA` (não atendeu), oferecer disparar SMS automático de follow-up com link do WhatsApp
- **Do Not Call (DNC)**: tabela + bloqueio no `voice-dialer-enqueue` (cliente com opt-out nunca é discado)
- **Janela de horário permitido** por campanha (ex.: 9h–20h, sem fim de semana) — hoje só existe globalmente
- **Registro no histórico do cliente**: cada chamada aparece na timeline do cliente (status, duração, custo, DTMF, gravação se houver)
- **Consentimento LGPD**: exibir aviso de gravação quando `dispatch_kind = tts` (prefixo configurável)
- **Export CSV** do histórico já filtrado

## 5. Detalhes técnicos

- Nova edge `velip-account-balance` (GET → cache 60s) chamada pelo banner e pelo painel
- `voice-dialer-enqueue` aceita `source: "customers", filters: {...}` e resolve a base server-side (evita mandar 3k telefones no body)
- Nova tabela `voice_dnc` (`consultant_id`, `phone_e164`, `reason`, `created_at`) + índice único
- `voice_call_logs` já tem `cost` e `duration` — só precisamos de views agregadas por período
- `ScheduleCallButton` cria campanha `mode: "single"`, `scheduled_at` na coluna já existente de `voice_campaigns`
- Timeline do cliente lê `voice_call_logs` por `phone_e164` normalizado

## 6. Ordem de entrega

1. `velip-account-balance` + banner/painel com saldo e gasto
2. Filtro "meus clientes" no seletor de base
3. `ScheduleCallButton` + integração em Captação e Chat
4. DNC + janela por campanha + timeline no cliente
5. SMS automático em `NA` + export CSV

Depois disso o módulo Velip fica no mesmo nível dos SaaS de discador do mercado.

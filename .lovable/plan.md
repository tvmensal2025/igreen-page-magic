## Ajustes no card "Automações iGreen"

**Objetivo:** Remover o que confunde e o que não deve ser opcional. Só mexer em UI (arquivo do card) — nenhuma mudança de banco, backend ou sync.

### 1. Esconder o grupo "Captura de dados"
- Puxar boletos, devolutivas, telecom, seguros e cashback é **regra fixa** — o sync sempre traz tudo.
- Remover o grupo inteiro do card (não mostrar mais os 5 toggles travados).
- Continua salvando `true` no banco por padrão (já é o comportamento atual em `automationSettings.ts`), então nada muda no sync.

### 2. Reescrever textos em português claro (sem jargão)
Grupo **"Alertas e tarefas"** — trocar para linguagem do dia a dia:

| Antes | Depois (label • descrição) |
|---|---|
| Alerta de boleto vencendo | **Avisar quando um boleto do cliente estiver perto de vencer** • Aparece um aviso no seu painel para você agir. |
| Alerta de devolutivas | **Avisar quando um cliente for reprovado ou tiver pendência no cadastro** • Aparece no painel para você resolver. |
| Alerta de licenças expirando | **Avisar quando um consultor da sua rede estiver perto de perder a licença** • Ajuda você a reter sua rede. |
| Rotinas viram tarefas | **Criar tarefas automáticas todo dia (aniversariantes, clientes esfriando, quem sumiu)** • Aparecem na sua lista de tarefas. |

Grupo **"Automação no WhatsApp"** — remover jargão:

| Antes | Depois (label • descrição) |
|---|---|
| Lembrete de boleto por WhatsApp | **Enviar o boleto pro cliente antes de vencer, pelo WhatsApp** • O sistema manda a mensagem sozinho, sem você precisar fazer nada. |
| Mensagem de aniversário | **Parabenizar o cliente no dia do aniversário, pelo WhatsApp** • O sistema envia sozinho no dia. |
| Cross-sell no bot | **Oferecer Telefonia e Seguro Auto para clientes que só têm Energia** • Quando o cliente conversar com o bot, ele mesmo sugere os outros produtos. |

Também trocar o cabeçalho do grupo de "⚠️ Envia mensagens automáticas aos clientes. Ative com cuidado." para **"⚠️ Estas opções mandam mensagem sozinhas para o cliente. Ligue só se quiser que aconteça sem você precisar aprovar cada uma."**

E o texto introdutório do card passa a ser: **"Alertas já vêm ligados. As opções que enviam mensagem direto pro cliente ficam desligadas — ligue só as que você quer que rodem no automático."** (some a menção a "captura obrigatória", já que o grupo não aparece mais).

### 3. Fora do escopo
- Não alterar `automationSettings.ts` (defaults continuam `true` para as capturas).
- Não mexer no sync, nas edge functions, nem no banco.
- Não remover as chaves `capture_*` do tipo — só deixam de ser exibidas.

### Arquivo afetado
- `src/features/produtos/acompanhamento/AutomacaoIgreenCard.tsx` (única mudança).

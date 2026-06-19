# Plano: Cadastro Rápido automático ou qualquer outro fluxo + Pausa só após 5 dúvidas fora do fluxo

## O que a análise descobriu

A investigação no código mostrou **3 causas** do problema relatado:

1. **Trigger no banco força `capture_mode = 'manual'**` em todo cliente novo (migrações `20260521024948…` e `20260521015457…`). Isso faz o fluxo cair no ramo "consultor confirma a conta" mesmo quando deveria ser automático.
2. `**consultants.portal_kind` tem default `'digital'` (Portal 1)** — nenhuma migração coloca alguém em `'autoconexao'` (Portal 2), então todos os leads vão pro Portal 1.
3. O **engine v3** já corrige `capture_mode='auto'` na entrada, mas o **handler legado `bot-flow.ts` não** — então leads que caem no caminho legado continuam sofrendo o bug do trigger.

Sobre a pausa por dúvidas: hoje o sistema **já só conta perguntas off-topic** (mensagens que não batem com o formato esperado do step e têm intenção de pergunta). Mensagens normais do fluxo e edições **não contam**. O que precisa mudar é só o **threshold de 8 → 5**.

## O que será ajustado

### 1. Cadastro rápido = automático (sem confirmação do consultor)

- Criar migração que **remove** os triggers `set_default_capture_mode` e `customers_default_capture_mode` e altera o default da coluna `customers.capture_mode` para `'auto'`.
- Backfill: `UPDATE customers SET capture_mode = 'auto' WHERE capture_mode = 'manual' AND created_at > now() - interval '30 days'` (só leads recentes, pra não bagunçar histórico).
- Em `supabase/functions/evolution-webhook/handlers/bot-flow.ts` e `whapi-webhook/handlers/bot-flow.ts`: garantir que o trecho `processando_ocr_conta` sempre siga o ramo `auto` (envia botões de confirmação direto pro cliente no WhatsApp). O ramo `manual` fica no código mas só é acionado se explicitamente marcado pelo consultor.

### 2. Todos os botões de entrada vão pro Portal 2

- Criar migração que altera o default de `consultants.portal_kind` para `'autoconexao'` e faz `UPDATE consultants SET portal_kind = 'autoconexao'` em todos os consultores ativos.
- Portal 1 continua no código (`portal-worker.ts` mantém o branch `'digital'`), só não é mais o destino padrão.

### 3. Pausa por dúvidas: 8 → 5

- Em `evolution-webhook/handlers/bot-flow.ts` (linha ~1004) e `whapi-webhook/handlers/bot-flow.ts`: trocar `detourNext >= 8` por `detourNext >= 5`.
- O contador **já só incrementa** quando: (a) cliente está em step de cadastro, (b) mensagem tem intenção de pergunta, (c) bate com a FAQ do consultor (off-topic real). Mensagens do fluxo normal e edições continuam **não contando** — comportamento já correto, só confirmado.

### 4. Fluxo final do cadastro rápido (resultado esperado)

```text
cliente manda "quero cadastrar"
  → bot pede conta de energia
  → cliente envia foto/PDF
  → OCR roda → bot envia botões de confirmação direto pro cliente (SEM consultor)
  → cliente confirma → bot pede documento
  → cliente envia documento → bot confirma telefone
  → cliente confirma → bot confirma email
  → cliente confirma → dispara Portal 2
```

&nbsp;

## Detalhes técnicos

- **Arquivos de migração novos** (2): `drop_capture_mode_trigger.sql` e `default_portal_kind_autoconexao.sql`.
- **Arquivos editados**: `supabase/functions/evolution-webhook/handlers/bot-flow.ts`, `supabase/functions/whapi-webhook/handlers/bot-flow.ts` (apenas o número `8` → `5` no bloco midflow-qa; o ramo `manual` em `processando_ocr_conta` fica intacto pois com o trigger removido nunca mais será acionado por default).
- **Não mexer** em: Portal 1 worker, lógica de captura manual (caso futuro consultor queira ativar), engine v3 (já está correto).

## Observação sobre `.lovable/`

Seu `.gitignore` exclui o diretório `.lovable/`, onde este plano fica salvo (`.lovable/plan.md`). Como está ignorado, o plano não vai pro commit e some no próximo snapshot. Quer que eu remova essa entrada do `.gitignore` pra plans persistirem? (não bloqueia a execução)
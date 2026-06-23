## 1) Vai dar certo? O link de facial vai chegar?

**Sim, vai funcionar — mas o link da facial NÃO sai do nosso bot.** Como já está hoje:

1. Bot determinístico (Fluxo A) → coleta conta → OCR → SIM → documento → email → telefone → finalizar.
2. Worker `worker-portal-2` faz login no Portal iGreen, preenche o formulário, intercepta o **OTP** (SMS/WhatsApp) e devolve para o bot (`aguardando_otp` → `validando_otp`).
3. Depois do OTP validado, **o próprio Portal iGreen envia ao celular do cliente o link de selfie/biometria facial** (SMS/push do portal — fora do nosso fluxo). Nosso bot fica em `aguardando_facial` apenas monitorando.
4. Quando o portal confirma a facial, o worker avança para `aguardando_assinatura` → `cadastro_em_analise` → `complete`.  
O PORTALWORKER2 ABRE O LINK PARA DIGITAR O OTP ESSE MESMO LINK TEM QUE SER ENVIADO AO CLIENTE PELO NOSSO FLUXO PARA O CLIENTE SE NAO ELE FICA PERDIDO. 

**Pontos de atenção (riscos reais):**

- Se o número de celular preenchido no portal estiver errado, o link de facial não chega — por isso o passo `ask_phone_confirm` é crítico.
- Se o cliente abrir o link facial mas o portal não devolver status, ficamos travados em `aguardando_facial` (tem watchdog mas pode dar timeout).
- O fluxo determinístico já está com bypass total do Cérebro em cadastro (alteração da rodada anterior), então não há mais risco de IA "atravessar".

Veredito: **vai dar certo** desde que (a) número confirmado correto, (b) Portal 2 online, (c) cliente abra o SMS/link do portal. Nada novo a corrigir nesse ponto.

---

## 2) Ativar Fluxo A só por palavra-chave (sem mexer em parceiros)

**É possível, sim**, e a estrutura já existe parcialmente. Hoje a atribuição de variante (`A`/`B`/`C`/`D`/`E`) é feita por **round-robin** na RPC `assign_flow_variant`, baseada em `consultants.active_variants`. Ou seja: hoje o Fluxo A é decidido na **criação do lead**, sem olhar o conteúdo da mensagem.

O que o usuário quer: lead novo entra num fluxo "padrão" (ex.: Fluxo D ou welcome neutro). **Só quando ele digita uma palavra-chave específica** (ex.: "cadastro", "quero entrar", "energia"), o sistema **muda o lead para o Fluxo A** e começa o cadastro determinístico.

### Por que isso NÃO conflita com palavras-chave de parceiro

São tabelas e fluxos independentes:


| Função                          | Tabela                                                                        | O que faz                                                                                                      |
| ------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Parceiro (atribuição comercial) | `referral_partners.keywords`                                                  | Marca `customers.referral_partner_id`. Usado só para CLI no link de cadastro. **Não muda variante nem fluxo.** |
| Switch de fluxo (PJ/Licenciada) | `flow_router_rules.trigger_keywords`                                          | Detecta intenção forte e troca `flow_key`. Já implementado em `detectFlowSwitch`.                              |
| **Novo: ativar Fluxo A**        | `flow_router_rules` com `target_flow_key='fluxo_a_cadastro'` (ou nova tabela) | Vai mudar `customers.flow_variant` para `'A'` e setar `conversation_step='aguardando_conta'`.                  |


Os três rodam em ordem e leem campos diferentes — não há interferência. Inclusive a busca de parceiro continua acontecendo no mesmo turno (vide `evolution-webhook/index.ts:962`).

---

## Plano de implementação

### Etapa 1 — Mudar comportamento padrão de atribuição

- Hoje `assign_flow_variant` faz round-robin. Vamos manter a RPC, **mas atualizar `active_variants` dos consultores** para o que o usuário escolher como padrão (ex.: só `['D']`). Assim leads novos entram em D, não em A.
- (Decisão necessária: qual variante padrão para leads novos? D? B? welcome neutro?)

### Etapa 2 — Tabela de gatilhos de Fluxo A por palavra-chave

Opções:

- **(a) Reutilizar `flow_router_rules**` criando regra com `target_flow_key='fluxo_a_cadastro'` e palavras-chave (`["cadastro","quero cadastrar","quero entrar","energia"]`). Adicionar handler em `detectFlowSwitch` que, quando alvo for `fluxo_a_cadastro`, dispara mudança de variante.
- **(b) Nova coluna `consultants.fluxo_a_keywords text[]**` (mais simples, scoped por consultor).

Recomendo **(a)** — já existe UI/cache/ordem por prioridade, e mantém a porta aberta para outros fluxos.

### Etapa 3 — Handler no webhook

Em `evolution-webhook/index.ts` e `whapi-webhook/index.ts`, no bloco onde mensagem textual é processada (antes do roteamento de engine):

1. Se `customer.flow_variant !== 'A'` **E** `customer.conversation_step` não está em `CADASTRO_STEPS` (não interrompe quem já está no meio de algo) **E** `detectFlowSwitch` retornar `fluxo_a_cadastro`:
  - Atualizar `customers`: `flow_variant='A'`, `conversation_step='aguardando_conta'`, limpar estado de cadastro antigo.
  - Disparar mensagem inicial do Fluxo A ("Perfeito! 🙌 📸 Me envia agora uma *foto da sua conta de luz*…").
2. **Não tocar** no bloco de `referral_partners` (linhas ~962) — continua rodando em paralelo no mesmo turno; se a palavra-chave de parceiro casar, marca `referral_partner_id`; se a de Fluxo A casar, ativa cadastro. Ambos podem acontecer juntos.

### Etapa 4 — UI admin (opcional nesta rodada)

- Tela simples em `/admin/fluxos` (ou nova) para listar/editar keywords do Fluxo A — escreve em `flow_router_rules`.
- Se preferir, na primeira versão deixamos hardcoded no banco via migration e a UI fica para depois.

### Etapa 5 — Testes manuais

- Lead novo sem palavra-chave → entra em D (não em A).
- Lead novo digita "quero me cadastrar" → vira A, recebe foto de conta.
- Lead novo digita "promo parceiro X" → marca `referral_partner_id`, **não** muda variante.
- Lead novo digita "cadastro pela parceira X" → marca parceiro **E** ativa A.
- Lead já em meio do cadastro (CADASTRO_STEPS) digita palavra-chave → ignorado (não reinicia).

---

## Arquivos a editar

- `supabase/functions/_shared/flow-router.ts` — estender `detectFlowSwitch` para suportar `target_flow_key='fluxo_a_cadastro'` (ou criar `detectFluxoAActivation`).
- `supabase/functions/evolution-webhook/index.ts` e `supabase/functions/whapi-webhook/index.ts` — chamar o detector e mutar `customers.flow_variant` + step.
- Migration: inserir regras seed em `flow_router_rules` com `target_flow_key='fluxo_a_cadastro'` e keywords default; opcionalmente atualizar `consultants.active_variants` para `['D']` (ou outra default).

---

## Perguntas antes de eu construir

1. **Qual variante padrão** para lead novo sem palavra-chave? (D, B, ou um "welcome neutro"?)
2. **Quais palavras-chave** devem ativar o Fluxo A? Sugestão: `cadastro`, `quero cadastrar`, `quero me cadastrar`, `energia`, `começar cadastro`.
3. **Escopo**: regra global (todos os consultores) ou por consultor?
4. **UI agora ou depois?** Posso entregar só a lógica + seed agora e UI numa próxima rodada.
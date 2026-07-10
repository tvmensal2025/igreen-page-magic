## Objetivo

Garantir que a campanha publique sem erro e que a regra de CLI/ID iGreen fique blindada:

- `CLI / ID iGreen` = ID do consultor dono/ E CONSULTOR SUBSTITUINDO O DO CONSULTOR SE TIVER VAZIO FICA O DO DONO
- `ID consultor parceiro` = ID iGreen do parceiro quando ele É APENAS CLIENTE  TODOS CLIENTE TEM ID 
- Se existir os dois IDs, métricas/contagem devem considerar os dois sem misturar campanhas, rodízio ou clientes de terceiros.
- Se existir só parceiro, o cadastro continua pertencendo ao consultor dono, mas o ID parceiro entra como referência do parceiro.
- Nunca selecionar todos automaticamente no rodízio; só quem o consultor escolheu.

## Causa provável do erro de publicar campanha

O log colado (`myIgreenIds`, `wallet`, `scoped`) é do dashboard/analytics, não é o erro direto da Meta.

Nos logs recentes da Edge Function `facebook-create-campaign`, a campanha foi criada, mas surgiram três pontos perigosos:

1. Meta rejeitando ajuste de `spend_cap` em campanhas com `lifetime_budget`:
  - `subcode=2446474`
  - Mensagem: `Spend cap can't be added or updated when campaign has lifetime Budget`
  - Hoje isso roda no realinhamento das campanhas existentes e pode confundir a publicação.
2. Meta rejeitando limite baixo de gasto em campanhas antigas:
  - `subcode=1885058`
  - Mensagem: limite de gastos mínimo por cobranças pendentes.
  - Deve ser tratado como aviso de campanha antiga, não como falha da campanha nova.
3. Notificação via Evolution falhando:
  - `Cannot read properties of undefined (reading 'id')`
  - Isso não deve travar a publicação nem deixar o usuário achando que a campanha falhou.

## Plano de implementação

### 1. Corrigir realinhamento de verba para não tentar `spend_cap` em campanha com `lifetime_budget`

Na `facebook-create-campaign`:

- Buscar também `duration_days`, `lifetime_cap_cents` e/ou campos que indiquem campanha com orçamento vitalício nas campanhas existentes.
- No realinhamento, pular campanhas com `duration_days > 0` ou que já usam `lifetime_budget`.
- Manter realinhamento só para campanhas contínuas que usam `daily_budget + spend_cap`.
- Registrar isso como log informativo, não erro.

Resultado: campanha nova não fica presa por erro de cap de campanha antiga.

### 2. Melhorar resposta da publicação para diferenciar “criada mas em revisão” de “falhou”

No frontend (`usePublish` / serviço `facebookAds`):

- Quando a função retornar `ok: true` mas `activated=false`, mostrar mensagem clara:
  - “Campanha criada e enviada para revisão. Ativação automática pendente.”
- Não mostrar “falha” quando o erro for apenas realinhamento/ativação posterior.

Resultado: o consultor entende o estado real da campanha.

### 3. Blindar notificação para nunca derrubar publicação

Na rotina de notificação:

- Garantir payload compatível com Evolution/Whapi.
- Se notificação falhar, apenas logar e continuar.
- Não permitir que erro de aviso WhatsApp seja interpretado como erro de campanha.

Resultado: notificação de parceiro/consultor não bloqueia anúncio.

### 4. Aplicar a regra correta de CLI/ID iGreen no cadastro de parceiros

No formulário de parceiros:

- Renomear visualmente os campos para evitar confusão:
  - `Meu ID iGreen (consultor dono)`
  - `ID iGreen do parceiro (se ele também for consultor)`
- `Meu ID iGreen` deve vir da conta do consultor/logado ou do cadastro do consultor, e não deve ser confundido com cliente.
- `ID parceiro` deve ser opcional, mas quando preenchido indica consultor/licenciado parceiro.
- Validação: impedir salvar dois parceiros ativos duplicados com mesmo nome + mesmo ID parceiro.

Resultado: ninguém cadastra o parceiro invertido por engano.

### 5. Corrigir métricas/contagem para somar os IDs corretos sem misturar campanha

No hook de analytics/consulta de clientes:

- Montar o escopo de IDs assim:
  - Sempre incluir o ID iGreen do consultor dono.
  - Se o parceiro tiver `partner_igreen_id`, incluir também esse ID no cálculo daquele parceiro.
- A soma deve ser usada só para métricas/visão do parceiro, não para trocar o dono da campanha.
- Campanhas e rodízio continuam filtrados por `consultant_id` e `referral_partner_id`, para não misturar campanhas.

Resultado: se os dois IDs existem, soma corretamente; se só existe parceiro, usa dono + parceiro sem perder vínculo.

### 6. Revisar rodízio para garantir seleção explícita

No wizard de campanha:

- Confirmar que lista de participantes começa vazia.
- Publicar só com os participantes selecionados.
- Se for “só eu”, enviar apenas o consultor dono.
- Se for “um parceiro”, enviar apenas aquele parceiro.
- Se forem vários, criar rodízio na ordem exibida.

Resultado: nunca vai para todos por padrão.

### 7. Verificação final

Depois das mudanças:

- Testar criação do payload de campanha com:
  1. Só eu.
  2. Um parceiro.
  3. Vários parceiros.
- Verificar que o payload contém apenas os IDs selecionados.
- Verificar que `facebook-create-campaign` não tenta `spend_cap` em campanhas com `lifetime_budget`.
- Verificar que erro de notificação não quebra publicação.
- Verificar que o texto exibido ao usuário mostra o status real da campanha.

## Arquivos principais envolvidos

- `supabase/functions/facebook-create-campaign/index.ts`
- `supabase/functions/_shared/notify-consultant.ts`
- `src/services/facebookAds.ts`
- `src/components/admin/ads/campaign-wizard/hooks/usePublish.ts`
- `src/components/admin/parceiros/PartnerForm.tsx`
- `src/hooks/useAnalytics.ts`
- `src/services/referralPartners.ts`

## Observação

A pasta `.lovable/` está no `.gitignore`, então planos salvos ali podem se perder no próximo snapshot. Se quiser manter planos persistentes no projeto, é melhor remover essa entrada do `.gitignore` depois.
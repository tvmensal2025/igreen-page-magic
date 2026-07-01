## Diagnóstico dos logs

- **Tor não é o erro principal:** ele demora alguns segundos para baixar consenso e depois chega em `Bootstrapped 100%`. As mensagens `no usable consensus` e `no exit nodes` aparecem no aquecimento inicial.
- **Erro real 1 — login instável no portal iGreen:** às vezes o Cloudflare/portal não entrega a tela de login correta; por isso o worker fica esperando `input[type=email]` e dá `Timeout 30000ms`, ou o fallback retorna `Failed to fetch`.
- **Erro real 2 — cashback de seguros:** `/cashback/resumo?origem=SEGUROS` é inválido na API atual, que só aceita `GREEN` e `TELECOM`. Os endpoints alternativos de seguros também retornam `404`; isso não deve aparecer como falha crítica do sync.
- **O que já está pegando corretamente:** clientes, rede, boletos, telecom, seguros/apólices, devolutivas, métricas e enriquecimento de fichas. Nos logs: 159 clientes, 31 membros de rede, 21 boletos, 6 telecom, 5 seguros, 5 devolutivas e `66/66` fichas enriquecidas.
- **Risco atual:** uma falha de login/Cloudflare pode fazer o usuário achar que “não sincronizou nada”, mesmo quando parte dos dados já foi salva ou quando só o cashback de seguros falhou.

## Plano de correção

### 1. Tornar o login do worker mais resiliente
- Ajustar `worker-igreen-sync/server.mjs` para detectar quando a página carregada não é login real, mas bloqueio/erro do Cloudflare.
- Fazer retry controlado de login com novo contexto/browser antes de falhar.
- Aumentar a espera de login de forma inteligente: primeiro detectar `input email`, depois detectar mensagens de erro/WAF/HTML inesperado.
- Retornar erro estruturado: `igreen_waf_blocked`, `portal_login_timeout`, `network_fetch_failed`, em vez de erro genérico `500`.

### 2. Evitar concorrência que derruba o portal
- Criar uma trava por e-mail dentro do worker para impedir dois syncs simultâneos do mesmo consultor.
- Se chegar `/sync-customers` e `/sync-all` ao mesmo tempo, reaproveitar a execução em andamento ou retornar “sync já em andamento”.
- Isso corrige casos como os logs onde `/sync-customers` e `/sync-all` tentaram login ao mesmo tempo às 22:48.

### 3. Corrigir cashback/seguros para não gerar falso erro
- Remover a chamada inválida com `origem=SEGUROS` como rota principal.
- Manter cashback apenas para `GREEN` e `TELECOM`.
- Para seguros, salvar comissão/cashback somente se um endpoint vivo for descoberto pelo diagnóstico; se todos retornarem `404`, registrar como `not_available`, não como falha.
- Atualizar o diagnóstico para marcar esses endpoints como “indisponível na API iGreen atual”.

### 4. Melhorar persistência e resposta do sync
- Em `sync-igreen-customers`, devolver resumo separado por módulo:
  - clientes salvos
  - boletos salvos
  - telecom salvo
  - seguros salvo
  - devolutivas salvas
  - métricas salvas
  - cashback green/telecom salvo
  - seguros cashback indisponível, se for o caso
- Mesmo se um módulo falhar, salvar os outros normalmente e mostrar “sincronização parcial” em vez de erro geral.
- Preencher corretamente a tabela de histórico `igreen_sync_runs` para cada execução manual/background.

### 5. Ajustar a tela para mostrar exatamente o que foi sincronizado
- Na Carteira iGreen/Admin, trocar mensagens genéricas por status claro:
  - “Clientes iGreen atualizados”
  - “Boletos atualizados”
  - “Devolutivas atualizadas”
  - “Telecom atualizado”
  - “Seguros atualizado”
  - “Cashback de seguros não disponível na API atual”
- Não exibir erro vermelho quando o único problema for endpoint inexistente de seguros cashback.
- Adicionar contadores após sincronizar para confirmar visualmente o que entrou.

### 6. Validar com dados reais sem quebrar produção
- Testar primeiro a função `sync-igreen-customers` em modo `validate`.
- Depois testar `sync_all` com o consultor atual.
- Conferir no banco se os totais aumentaram/atualizaram em:
  - `customers` com `customer_origin = igreen_sync`
  - `igreen_customer_boletos`
  - `igreen_customer_devolutivas`
  - `igreen_telecom_customers`
  - `igreen_seguros_customers`
  - `igreen_consultant_metrics`
- Conferir logs do worker para garantir que 400/404 de seguros cashback não apareçam como falha crítica.

## Resultado esperado

- A sincronização não quebra por causa de cashback de seguros inexistente.
- Falhas reais do Cloudflare/login ficam claras e com retry.
- Sync simultâneo não trava o portal nem duplica login.
- O Admin mostra todos os dados capturados com contadores e status por módulo.
- O sistema continua salvando clientes, boletos, devolutivas, telecom, seguros, rede e métricas sem apagar o que já existe.
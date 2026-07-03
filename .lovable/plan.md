## Resposta direta

Não está certo continuar tentando do mesmo jeito por tanto tempo.

O problema não é o Matias isoladamente: o fluxo atual estava tentando buscar dados enriquecidos de muitos clientes antes de garantir a gravação básica. Quando a edge function estoura timeout, ela morre antes de persistir tudo. Por isso um cliente pode existir no portal iGreen e ainda assim não aparecer em “Meus clientes”.

O caminho certo agora é mudar a regra do sync: primeiro gravar todos os clientes básicos rapidamente, depois enriquecer em segundo plano.

## Plano de correção

### 1. Garantir que nenhum cliente falte
- O sync principal deve chamar o worker sem enriquecimento pesado.
- Persistir imediatamente todos os clientes retornados pelo portal.
- Rodar a marcação de clientes fora da carteira só depois da persistência básica.
- A tela “Meus clientes” passa a depender dessa base gravada, não do enriquecimento completo.

Resultado esperado: se o portal retornar 159 clientes, os 159 entram no banco antes de qualquer etapa lenta.

### 2. Deixar enriquecimento separado
- Endereço, CEP, PJ, procurador, assinatura e outros detalhes entram em fase posterior.
- Essa fase pode rodar em background, por lotes.
- Se ela falhar ou demorar, o cliente continua aparecendo normalmente na lista.

Resultado esperado: Matias aparece mesmo que o enriquecimento ainda não tenha terminado.

### 3. Paralelizar o worker
- Usar o endpoint `/enrich-batch` no worker.
- Buscar detalhes em janelas paralelas controladas, por exemplo 6 clientes por vez.
- Evitar loop serial com espera artificial entre clientes.

Resultado esperado: o enriquecimento deixa de levar vários minutos e passa a caber melhor no limite operacional.

### 4. Registrar exatamente quem falhou
- Salvar `failed_samples` no `counts` do run.
- Quando houver erro de upsert, registrar exemplos reais com código, nome e mensagem.
- Usar esses exemplos para corrigir constraint, dedupe, telefone, CPF ou trigger que esteja bloqueando gravação.

Resultado esperado: se 100 clientes falharem, vamos saber quais e por quê, sem depender de logs que expiram.

### 5. Limpar runs presos
- Marcar runs antigos em `running` como `failed` quando já passaram do tempo real de execução.
- Isso evita painel travado dizendo que ainda há sync em andamento.

### 6. Validação final
Depois do redeploy do worker e da edge function:

```text
1. Rodar sync do Rafael.
2. Confirmar total de clientes iGreen ativos do consultor.
3. Buscar Matias Brito / código 1578934 no banco.
4. Confirmar que os clientes fora da carteira foram marcados corretamente.
5. Rodar novo sync para confirmar idempotência.
6. Verificar se errors = 0 ou analisar failed_samples.
```

## Observação importante

O plano está salvo em `.lovable/plan.md`, mas a pasta `.lovable/` está no `.gitignore`. Se você quiser que esse plano persista no repositório, precisamos remover essa entrada do `.gitignore` depois.
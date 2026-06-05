## Objetivo

No `evolution-webhook`, hoje o bot espera **100% da duração** do áudio/vídeo antes de mandar o próximo passo (áudio de 50s = 50s parado). Isso é a principal causa da percepção de lentidão (ex.: 51s entre o "1" do cliente e a próxima resposta). Vamos cortar para cadência fixa curta, igual ao modo simulador.

## Mudança

**Arquivo:** `supabase/functions/evolution-webhook/handlers/bot-flow.ts` (linhas 85-98)

Substituir a função `sleepForMedia` para usar tempos fixos curtos, ignorando a duração real da mídia:

| Tipo | Antes | Depois |
|---|---|---|
| audio | duração real (até 120s) | **5s** |
| video | duração real (até 90s) | **3s** |
| image/text/outros | 1500ms | **1000ms** |
| testMode | 0s | 0s (mantém) |

Whapi **não é alterado** — mantém comportamento atual (espera duração real).

## Impacto esperado

- Áudio de 50s: cliente recebe próximo passo em ~5s em vez de 50s.
- Risco: cliente pode receber a próxima mensagem enquanto o áudio ainda toca. Aceito porque o WhatsApp empilha mensagens e o áudio continua disponível pra ouvir depois.
- Aplica em **todos** os passos do bot do Evolution (welcome, fluxo D, capture_conta, capture_documento, etc.) — `sleepForMedia` é chamada em 4 lugares e todas pegam o novo valor.

## Validação pós-deploy

1. Disparar um lead novo no Evolution e cronometrar tempo entre "áudio de boas-vindas" → "próxima mensagem". Esperado: ~5s.
2. Conferir nos logs de edge function que não há erro novo.
3. Confirmar que Whapi segue inalterado (comparar com lead no Whapi).

## Riscos / Observações

- Se o áudio for crítico pra entender o próximo passo (ex.: "ouça este áudio antes de responder"), a UX pode sofrer. Recomendo monitorar a taxa de resposta nos próximos leads.
- Reversão simples: trocar os 3 números (5000/3000/1000) de volta pra `duration*1000`.

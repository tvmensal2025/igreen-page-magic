# Simulação End-to-End — Prontidão para novos consultores

Objetivo: provar, com um lead real de teste, que o sistema entrega o fluxo completo sem intervenção manual. Se qualquer passo falhar, entro em build mode e corrijo antes de você repassar.

## Escopo da simulação

Vou usar Playwright no sandbox para dirigir:
1. O painel `/admin` autenticado (login já injetado).
2. O webhook público do Whapi/Evolution (via `curl` para as Edge Functions) simulando o WhatsApp do cliente.
3. O Portal iGreen (login e verificação do cadastro criado).

Número de teste: **5511999990001** (descartável, isolado do tráfego real). Se preferir outro, me diga antes de aprovar.

## Passos que serão validados

```text
[1] Lead entra          → Webhook recebe "oi" no Whapi
                          Espero: Fluxo D dispara boas-vindas + áudio
[2] Extração da conta   → Envio imagem-mock de conta de luz
                          Espero: OCR extrai kWh, cidade, distribuidora
[3] Documento           → Envio CNH frente + verso (imagens-mock)
                          Espero: worker anexa no Portal iGreen (retry OK)
[4] OTP                 → Simulo cliente digitando código no WhatsApp
                          Espero: worker digita OTP no Portal e envia link facial
[5] Painel admin        → Verifico Dashboard, Ranking, CRM, Captação
                          Espero: lead aparece nos 4 lugares em tempo real
[6] Pós-venda           → Marco status "aprovado" no CRM
                          Espero: disparo de imagem+áudio+texto via canal do consultor
```

## Verificações paralelas (sem simulação)

- Edge Functions críticas respondendo (evolution-webhook, whapi-webhook, lead-research, portal2-*, pos-venda-auto-progress, sync-igreen-customers).
- Workers externos: heartbeat do `worker-portal-2` e `worker-igreen-sync`.
- Quotas: Gemini bucket, custo de IA nas últimas 24h, `fatal_lock` das instâncias Evolution.
- Mídias por consultor: cada slot do Fluxo D com áudio + imagem + texto (paridade com Super Admin).
- Cloudflare/domínio `igreen.cloud` respondendo com SSL válido.

## Entregável

Ao final, você recebe um único relatório com:
- ✅ / ❌ por passo, com screenshot e trecho de log.
- Lista objetiva do que precisa ser corrigido antes de onboardar (se houver).
- Se tudo passar: green-light explícito para repassar a novos consultores + checklist curto que o consultor novo deve seguir no primeiro dia (conectar WhatsApp, importar carteira iGreen, testar 1 lead próprio).

## Duração estimada

15–25 minutos de execução. Nenhum dado de cliente real é tocado — tudo isolado no número de teste.

## Próximo passo

Aprove o plano para eu entrar em build mode e rodar a simulação. Se quiser trocar o número de teste ou pular algum passo (ex: pós-venda), me diga antes.

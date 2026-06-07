# Trocar visão IA do worker para OpenAI direto

## Objetivo
Substituir a chamada via Lovable AI Gateway (`LOVABLE_API_KEY` + Gemini) por chamada direta à **OpenAI Vision** usando sua própria `OPENAI_API_KEY`. Assim o worker no Easypanel não depende mais do segredo opaco do Lovable.

## O que muda

### 1. `worker-igreen-sync/server.mjs`
- Remover bloco que monta request para `https://ai.gateway.lovable.dev/...` com `LOVABLE_API_KEY`.
- Substituir por chamada à OpenAI:
  - Endpoint: `https://api.openai.com/v1/chat/completions`
  - Header: `Authorization: Bearer ${OPENAI_API_KEY}`
  - Modelo: `gpt-4o-mini` (visão, barato, ~US$0,0002 por screenshot)
  - Payload: mensagem `user` multimodal com `image_url` data-URL base64 + prompt curto em PT-BR descrevendo o que está na tela.
- Flag `ai_debug` em `/health` passa a refletir `!!process.env.OPENAI_API_KEY`.
- Manter o resto do pipeline (Tor + Playwright + 2captcha + `/last-debug` + `/last-screenshot`) intacto.

### 2. `worker-igreen-sync/README.md`
- Trocar tabela de envs: remover `LOVABLE_API_KEY`, adicionar `OPENAI_API_KEY` (obrigatória p/ debug visual; opcional se você não quiser visão).
- Atualizar nota de custos: ~US$0,0002/screenshot via gpt-4o-mini.

### 3. `worker-igreen-sync/Dockerfile`
- Nenhuma mudança (não tem env hardcoded lá).

### 4. Bump versão `mode`
- `/health` retorna `mode: "tor+playwright+2captcha-v11"` para confirmar deploy novo.

## O que você faz no Easypanel
1. Em `worker-igreen-sync` → Environment:
   - **Remover** `LOVABLE_API_KEY` (não usado mais).
   - **Adicionar** `OPENAI_API_KEY=sk-...` (sua chave).
2. Rebuild do serviço.
3. Validar:
   - `GET /health` → `mode: "tor+playwright+2captcha-v11"`, `ai_debug: true`.
   - Clicar "Sincronizar" no admin.
   - `GET /last-debug` → deve mostrar descrições da OpenAI tipo `"Formulário de login do iGreen visível, captcha ainda não resolvido"`.
   - `GET /last-screenshot` → PNG do último passo (mesma coisa de antes).

## O que NÃO muda
- Edge functions do Lovable continuam usando `LOVABLE_API_KEY` normalmente (nada quebra dentro do projeto).
- Pipeline de login (Tor/2captcha) intocado.
- Cache de 30min por consultor intocado.

## Observação
A chave OpenAI fica **só no Easypanel**, nunca no código nem no Lovable. Se vazar, você rotaciona no painel da OpenAI sem mexer no Lovable.

Confirma que posso prosseguir?

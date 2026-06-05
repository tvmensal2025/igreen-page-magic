
# Migrar OCR para Lovable AI Gateway

## Objetivo
Trocar as chamadas diretas a `generativelanguage.googleapis.com` (Gemini key própria, hoje com créditos zerados) por chamadas ao **Lovable AI Gateway** (`https://ai.gateway.lovable.dev/v1/chat/completions`) usando `LOVABLE_API_KEY`. Mesmo modelo (`google/gemini-2.5-flash`), mesma qualidade, billing centralizado.

## Escopo (somente `supabase/functions/_shared/ocr.ts`)
Todas as 6 chamadas Gemini dentro de `ocr.ts`:

1. `ocrContaEnergia` (linha ~145) — OCR de conta de energia
2. `ocrDocumento` (linha ~385) — OCR de RG/CNH frente+verso
3. Helper `extractTextFromImage` (linha ~511) — fallback de texto
4. Helper `gemFocado` (linha ~549) — usado por:
   - `ocrRgFocado`
   - `ocrCpfFocado`
   - `ocrNomeFocado`
   - `ocrNascimentoFocado`

Nada fora de `ocr.ts` muda. Callers continuam passando `geminiApiKey` — vamos manter a assinatura, mas internamente preferir `LOVABLE_API_KEY` (env), com fallback para a key recebida se a env não existir.

## Mudanças técnicas

### 1. Novo helper interno `callLovableVision`
Centraliza a chamada ao gateway no formato OpenAI:

```ts
async function callLovableVision(opts: {
  prompt: string;
  image: { mime: string; b64: string };
  maxTokens?: number;
  responseJson?: boolean;
}): Promise<{ ok: boolean; status: number; text: string; raw: any }> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY") ?? "";
  const body: any = {
    model: "google/gemini-2.5-flash",
    messages: [{
      role: "user",
      content: [
        { type: "text", text: opts.prompt },
        { type: "image_url", image_url: { url: `data:${opts.image.mime};base64,${opts.image.b64}` } },
      ],
    }],
    temperature: 0,
    max_tokens: opts.maxTokens ?? 4096,
  };
  if (opts.responseJson) body.response_format = { type: "json_object" };

  const res = await withRetry(
    () => fetchWithTimeout("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      timeout: TIMEOUT_GEMINI,
    }),
    { maxAttempts: 2, retryOn: (e) => /429|500|502|503|timeout|abort/.test(String(e)) },
  );

  const raw = await res.json().catch(() => ({}));
  const text = raw?.choices?.[0]?.message?.content ?? "";
  return { ok: res.ok, status: res.status, text, raw };
}
```

### 2. Substituir as 6 chamadas
Cada uma deixa de montar `contents/parts/inline_data` e passa a chamar `callLovableVision`. Tratamento de erro mantém a mesma forma (`{ sucesso, erro }`), mas mensagens 402/429 do gateway são propagadas — quando aparecerem, indicam créditos do workspace, não do Google.

### 3. Variável `geminiApiKey` nas assinaturas
**Mantida** para não tocar nos callers (`bot-flow.ts`, `whapi-webhook`, etc.). O parâmetro vira ignorado quando `LOVABLE_API_KEY` está presente (que é sempre, no Lovable Cloud). Pequeno comentário no topo de cada função explicando.

### 4. Garantir secret
Validar que `LOVABLE_API_KEY` existe via `fetch_secrets`. Se faltar, criar com `lovable_api_key--create` (não precisa pedir ao usuário).

## O que NÃO muda
- Nenhuma alteração no `evolution-webhook/handlers/bot-flow.ts`.
- Nenhuma alteração no fluxo do `whapi-webhook`.
- Nenhuma alteração nos prompts (mesma extração, mesmo JSON de saída).
- Variável de ambiente `GEMINI_API_KEY` permanece configurada (não removo) — vira fallback inerte.

## Validação pós-deploy
1. Deploy de `evolution-webhook` e `whapi-webhook` (importam `_shared/ocr.ts`).
2. Enviar uma conta de luz real pelo WhatsApp e checar logs:
   - Esperado: `🔍 OCR Conta - Imagem OK ...` seguido de status 200 e `sucesso: true`.
   - Se aparecer 402: créditos do workspace Lovable esgotados (avisar usuário).
3. Repetir com PDF e com foto de RG.

## Risco
**Baixo.** Mudança isolada em 1 arquivo, mantém assinaturas públicas, mesmo modelo subjacente. Rollback = reverter `ocr.ts`. Tempo estimado: ~15 min de edição + deploy.
</content>
</invoke>
## Diagnóstico do caso 5511971254913

Sequência real nos logs:

```text
19:33:55  cliente envia "conta-completa-22.pdf"  (conta de energia)
19:34:13  Gemini OCR doc: nome="" cpf="" confiança=0
19:34:28  bot responde: "✅ Frente recebida! Agora envie o VERSO do RG"  ← BUG
19:35:14  cliente envia "CNH-e.pdf-16.pdf" (CNH real) como "verso"
19:35:29  OCR pega só o nome BRUNO MANOEL DOS SANTOS, sem CPF → trava em ask_cpf
```

Causa raiz: o classificador `detectDocumentTypeDetailed` (`supabase/functions/_shared/detect-doc-type.ts`) só retorna `cnh | rg_novo | rg_antigo`. Quando o cliente manda uma **conta de energia, screenshot, selfie ou qualquer outro arquivo**, ele é forçado em `rg_antigo` com confiança baixa, e o handler `aguardando_doc_auto` (`bot-flow.ts` em whapi-webhook e evolution-webhook) salva como frente do RG e segue para `aguardando_doc_verso`.

## Correção (cirúrgica, sem mexer no fluxo nem nas regras)

### 1) Extender o classificador com a opção `outro`

Em `supabase/functions/_shared/detect-doc-type.ts`:

- Trocar `DetectResult.tipo` para `DocumentTypeCanonical | "outro"`.
- Adicionar campo opcional `motivo?: string` (ex.: `"conta de energia"`, `"selfie"`).
- Atualizar `PROMPT_PASS1`, `PROMPT_PASS2` e `PROMPT_PASS3` para incluir explicitamente a regra:
  - "Se a imagem NÃO for RG/CIN/CNH (ex.: conta de luz, comprovante de residência, selfie, recibo, captura de tela, foto aleatória, página em branco) → responda `tipo: "outro"` e em `motivo` descreva curto (`"conta de energia"`, `"selfie"`, etc.). Confiança alta (≥0.85)."
- Ajustar `parseDetectJson` para aceitar `tipo === "outro"` sem normalizar para RG.
- Atualizar `normalizeDocumentType` para preservar `"outro"` (ou criar parser local no detector).
- Quando as três passadas falharem em decidir e a melhor estimativa tiver confiança < 0.30, retornar `tipo: "outro"` com `motivo: "não identificado"` em vez de cair em `rg_antigo`.

### 2) Rejeitar no handler `aguardando_doc_auto`

Em `supabase/functions/whapi-webhook/handlers/bot-flow.ts` (linhas ~3946-3966) e `supabase/functions/evolution-webhook/handlers/bot-flow.ts` (linhas ~3395-3410), **antes** do bloco que salva `document_front_url`:

```ts
if (detectedType === "outro" || (detectConfidence > 0 && detectConfidence < 0.30)) {
  const motivo = (det as any).motivo ? ` (parece *${(det as any).motivo}*)` : "";
  reply = `❌ Esse arquivo não parece ser um *RG* ou *CNH*${motivo}.\n\n` +
          `📸 Me envia uma foto/PDF da *frente do seu RG* ou da sua *CNH*.\n\nFormatos: JPG, PNG ou PDF.`;
  // NÃO atualiza document_front_url, NÃO avança conversation_step.
  // Permanece em "aguardando_doc_auto" para o cliente reenviar.
  break;
}
```

Nada mais é alterado: o fluxo, os steps, e a transição RG→verso continuam idênticos para documentos válidos.

### 3) Log de auditoria

Manter `console.log("🚫 [doc-auto] rejeitado tipo=outro motivo=...")` para o consultor enxergar a rejeição nos logs da edge function.

## Validação

1. Deploy de `whapi-webhook` e `evolution-webhook`.
2. Teste manual no número 5511971254913 (ou outro número de teste do Rafael) enviando a mesma `conta-completa-22.pdf` — esperado: bot responde "Esse arquivo não parece ser RG ou CNH (parece conta de energia)…" e permanece em `aguardando_doc_auto`.
3. Reenviar um RG/CNH válido — esperado: fluxo segue normal (OCR + pede verso se for RG, ou confirma se for CNH).
4. Regressão: enviar um RG real conhecido — `det.tipo` continua sendo `rg_antigo`/`rg_novo`/`cnh`, sem rejeição.

## Fora de escopo

- Não mexer no passo `aguardando_doc_verso` nem em `ask_tipo_documento` (legado).
- Não mudar o `bot_flow_steps` nem regras de transição na UI.
- Não tocar no OCR (`ocrDocumentoFrenteVerso`) — a rejeição acontece antes dele rodar.
- Não alterar o `document_type` canônico nem o portal worker.

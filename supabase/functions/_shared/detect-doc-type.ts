// Detecta automaticamente o tipo de documento (CNH / RG novo / RG antigo)
// a partir de uma imagem (base64 ou URL pública). Usa Gemini Vision.
//
// Estratégia profissional (3 passadas com modelos diferentes):
//   1. Pass1: gemini-2.5-flash com checklist visual completo + temperature=0.
//      Aceita direto se confiança >= 0.80.
//   2. Pass2: gemini-2.5-pro com prompt detalhado + raciocínio passo-a-passo.
//      Aceita se confiança >= 0.60.
//   3. Pass3 (último recurso): gemini-2.5-flash com regra de desempate
//      ("se viu QR grande + CPF impresso → rg_novo; se papel laminado vertical → rg_antigo;
//       se viu CATEGORIA/VALIDADE → cnh; se em dúvida → rg_antigo").
//
// O cliente NUNCA precisa escolher e NUNCA vê "RG Novo"/"RG Antigo" — o bot decide
// internamente apenas para saber se precisa pedir o verso.

import { normalizeDocumentType, type DocumentTypeCanonical } from "./document-type.ts";

interface DetectInput {
  base64?: string;
  mimeType?: string;
  imageUrl?: string;
  geminiApiKey: string | undefined;
}

export type DetectedDocType = DocumentTypeCanonical | "outro";

interface DetectResult {
  tipo: DetectedDocType;
  confianca: number; // 0..1
  source: "gemini_pass1" | "gemini_pass2" | "gemini_pass3" | "fallback";
  sinais?: string[];
  motivo?: string; // descrição curta quando tipo === "outro" (ex.: "conta de energia")
}

const CHECKLIST = `
CHECKLIST VISUAL — analise os sinais antes de decidir:

🚗 CNH (Carteira Nacional de Habilitação):
- Cabeçalho "CARTEIRA NACIONAL DE HABILITAÇÃO" ou "PERMISSÃO PARA DIRIGIR"
- Campo "CATEGORIA" / "CAT. HAB." (A, B, AB, AC, AD, AE, C, D, E)
- Campo "VALIDADE" (data) e/ou "1ª HABILITAÇÃO"
- Foto + assinatura + impressão digital na mesma face
- Layout horizontal, fundo cinza/azulado, faixa "REPÚBLICA FEDERATIVA DO BRASIL"
- Pode ter QR code lateral
- ⚠️ CNH NÃO tem verso útil — só uma face importa

🆕 RG NOVO / CIN (Carteira de Identidade Nacional):
- Cabeçalho "CARTEIRA DE IDENTIDADE NACIONAL" ou "CIN"
- Material policarbonato (parece cartão de banco, brilhante e rígido)
- Layout HORIZONTAL, moderno
- QR Code GRANDE (geralmente na face do verso)
- CPF impresso na face frontal
- Brasão colorido da República
- Cores vibrantes, impressão nítida tipo cartão

📜 RG ANTIGO (modelo tradicional):
- Cabeçalho "CARTEIRA DE IDENTIDADE" / "REGISTRO GERAL"
- Papel laminado em plástico (não é policarbonato), pode estar amarelado/manchado
- Layout VERTICAL (frente e verso separados em papel)
- Foto preto-e-branco ou colorida desbotada
- "SSP/UF" em destaque, sem QR code grande
- Aparência envelhecida, bordas onduladas
- NÃO tem CPF impresso na frente (ou tem em local discreto)

⚠️ A foto pode estar rotacionada (90°, 180°, 270°) ou ligeiramente torta — considere isso.
⚠️ Se enxergar QR code grande + CPF impresso na frente = é RG_NOVO, mesmo que pareça antigo.
⚠️ Se enxergar CATEGORIA + VALIDADE = é CNH, sem dúvida.

🚫 OUTRO (NÃO é documento de identidade):
- Conta de luz / energia / água / gás / telefone / internet (cabeçalho de concessionária, código de barras, valor a pagar)
- Comprovante de residência, boleto, recibo, nota fiscal
- Selfie, foto pessoal, paisagem, animal, print de tela / WhatsApp
- Página em branco, documento ilegível, foto totalmente borrada/escura
- Qualquer coisa que NÃO seja CNH, RG ou CIN
→ devolva tipo:"outro", confianca:0.9, e em "motivo" descreva curto (ex.: "conta de energia", "selfie", "boleto", "print de tela").
`;

const PROMPT_PASS1 = `Você é um especialista em documentos de identidade brasileiros.

${CHECKLIST}

Classifique a foto como UM destes quatro tipos: "cnh", "rg_novo", "rg_antigo" ou "outro".

Responda APENAS com JSON válido (sem markdown):
{"tipo":"cnh"|"rg_novo"|"rg_antigo"|"outro","confianca":0.0-1.0,"sinais":["sinal1","sinal2"],"motivo":"breve (obrigatório se tipo=outro)"}

Os "sinais" devem citar 2-4 evidências concretas que você viu na foto.`;

const PROMPT_PASS2 = `ANÁLISE DETALHADA de documento brasileiro. Pense passo-a-passo:

${CHECKLIST}

Etapas obrigatórias:
1) Identifique o cabeçalho visível.
2) Procure CATEGORIA/VALIDADE → se achar, é CNH.
3) Procure QR code GRANDE + CPF impresso → se achar, é RG_NOVO.
4) Avalie material (policarbonato brilhante vs papel laminado amarelado).
5) Se NÃO for nenhum dos três (ex.: conta, boleto, selfie, print) → "outro" com motivo curto.
6) Se ainda em dúvida entre os RGs/CNH, prefira o tipo cuja maioria dos sinais bate.

Responda APENAS JSON:
{"tipo":"cnh"|"rg_novo"|"rg_antigo"|"outro","confianca":0.0-1.0,"sinais":["..."],"motivo":"breve"}`;

const PROMPT_PASS3 = `Última análise. Use estas REGRAS DE DESEMPATE:

R1) Tem texto "CATEGORIA" ou "VALIDADE" ou "HABILITAÇÃO"? → cnh
R2) Tem QR code claramente grande E CPF impresso na frente? → rg_novo
R3) Tem cabeçalho "CARTEIRA DE IDENTIDADE NACIONAL" ou "CIN"? → rg_novo
R4) Aparência de papel laminado antigo, layout vertical, sem QR grande? → rg_antigo
R5) Conta de luz/água/telefone, boleto, comprovante, selfie, print, foto aleatória? → "outro" (motivo curto, confianca 0.9)
R6) Em qualquer outra dúvida entre RG/CNH → escolha o tipo mais provável mas devolva confianca: 0.3. NUNCA chute "rg_antigo" só por segurança.

${CHECKLIST}

Responda APENAS JSON:
{"tipo":"cnh"|"rg_novo"|"rg_antigo"|"outro","confianca":0.0-1.0,"sinais":["..."],"motivo":"breve se outro"}`;

async function fetchImagePart(input: DetectInput): Promise<any | null> {
  if (input.base64 && input.base64.length > 100) {
    return { inline_data: { mime_type: input.mimeType || "image/jpeg", data: input.base64 } };
  }
  if (input.imageUrl && /^https?:/.test(input.imageUrl)) {
    try {
      const r = await fetch(input.imageUrl);
      const buf = new Uint8Array(await r.arrayBuffer());
      let bin = ""; for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
      const b64 = btoa(bin);
      const ct = r.headers.get("content-type") || "image/jpeg";
      return { inline_data: { mime_type: ct, data: b64 } };
    } catch (e) {
      console.warn("[detectDocumentType] falha baixando imagem:", (e as Error).message);
      return null;
    }
  }
  return null;
}

function parseDetectJson(raw: string): { tipo: DetectedDocType; confianca: number; sinais?: string[]; motivo?: string } | null {
  try {
    const clean = raw.replace(/```json|```/gi, "").trim();
    const match = clean.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const obj = JSON.parse(match[0]);
    const rawTipo = String(obj?.tipo || "").trim().toLowerCase();
    const tipo: DetectedDocType = rawTipo === "outro"
      ? "outro"
      : normalizeDocumentType(obj?.tipo);
    const confianca = typeof obj?.confianca === "number"
      ? Math.max(0, Math.min(1, obj.confianca))
      : 0.5;
    const sinais = Array.isArray(obj?.sinais) ? obj.sinais.map((s: any) => String(s)).slice(0, 6) : undefined;
    const motivo = typeof obj?.motivo === "string" ? String(obj.motivo).trim().slice(0, 80) : undefined;
    return { tipo, confianca, sinais, motivo };
  } catch {
    return null;
  }
}

async function callGeminiDirect(prompt: string, imagePart: any, apiKey: string, model: string): Promise<{ text: string; status: number }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }, imagePart] }],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 2048,
            responseMimeType: "application/json",
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
        signal: ctrl.signal,
      },
    );
    if (!resp.ok) {
      console.warn(`[detectDocumentType] gemini ${model} status`, resp.status);
      return { text: "", status: resp.status };
    }
    const json: any = await resp.json();
    return { text: (json?.candidates?.[0]?.content?.parts?.[0]?.text || "").trim(), status: 200 };
  } catch (e) {
    console.warn(`[detectDocumentType] erro chamando gemini ${model}:`, (e as Error).message);
    return { text: "", status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

// Fallback via Lovable AI Gateway quando o Gemini direto retorna 429/5xx/timeout.
// O OCR principal (ocr.ts) já usa esse gateway com sucesso — o classificador
// estava sem essa rota e por isso travava todo o passo de documento quando a
// chave Gemini direta entrava em quota.
async function callGeminiViaLovable(prompt: string, imagePart: any, model: string): Promise<string> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY") || "";
  if (!apiKey) return "";
  const mime = imagePart?.inline_data?.mime_type || "image/jpeg";
  const b64 = imagePart?.inline_data?.data || "";
  if (!b64) return "";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  // Lovable Gateway aceita modelos no formato "google/<id>"
  const gwModel = model.startsWith("google/") ? model : `google/${model}`;
  try {
    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: gwModel,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } },
          ],
        }],
        temperature: 0,
        max_tokens: 2048,
        response_format: { type: "json_object" },
      }),
      signal: ctrl.signal,
    });
    if (!resp.ok) {
      console.warn(`[detectDocumentType] lovable-gateway ${gwModel} status`, resp.status);
      return "";
    }
    const json: any = await resp.json();
    return String(json?.choices?.[0]?.message?.content || "").trim();
  } catch (e) {
    console.warn(`[detectDocumentType] erro lovable-gateway ${gwModel}:`, (e as Error).message);
    return "";
  } finally {
    clearTimeout(timer);
  }
}

async function callGemini(prompt: string, imagePart: any, apiKey: string, model: string): Promise<string> {
  // Se não temos chave Gemini, vai direto para o Lovable Gateway.
  if (!apiKey || apiKey === "__no_gemini__") {
    const gw = await callGeminiViaLovable(prompt, imagePart, model);
    if (gw) console.log(`[detectDocumentType] ✅ Lovable Gateway (sem chave Gemini)`);
    return gw;
  }
  const direct = await callGeminiDirect(prompt, imagePart, apiKey, model);
  if (direct.text) return direct.text;
  // Fallback p/ Lovable Gateway em qualquer falha (429, 5xx, timeout, resposta vazia).
  const gw = await callGeminiViaLovable(prompt, imagePart, model);
  if (gw) {
    console.log(`[detectDocumentType] ✅ fallback Lovable Gateway respondeu (direct status=${direct.status})`);
    return gw;
  }
  return "";
}

/** Versão estruturada que retorna tipo + confiança + origem da decisão. */
export async function detectDocumentTypeDetailed(input: DetectInput): Promise<DetectResult> {
  const hasGemini = !!input.geminiApiKey;
  const hasLovable = !!Deno.env.get("LOVABLE_API_KEY");
  if (!hasGemini && !hasLovable) {
    // Sem provedor: assume documento válido (rg_antigo) para o OCR seguir, em vez de rejeitar.
    return { tipo: "rg_antigo", confianca: 0, source: "fallback", motivo: "classificador indisponível" };
  }
  const imagePart = await fetchImagePart(input);
  if (!imagePart) {
    return { tipo: "rg_antigo", confianca: 0, source: "fallback", motivo: "imagem não disponível" };
  }
  // callGemini cai automaticamente para Lovable Gateway quando o direto falha.
  const apiKey = input.geminiApiKey || "__no_gemini__";

  // ── Pass 1: gemini-2.5-flash + checklist ──
  const raw1 = await callGemini(PROMPT_PASS1, imagePart, apiKey, "gemini-2.5-flash");
  const parsed1 = parseDetectJson(raw1);
  if (parsed1 && parsed1.confianca >= 0.80) {
    console.log(`🤖 [detectDoc] pass1 confiante: ${parsed1.tipo} (${parsed1.confianca.toFixed(2)}) motivo=${parsed1.motivo || "-"} sinais=${JSON.stringify(parsed1.sinais)}`);
    return { tipo: parsed1.tipo, confianca: parsed1.confianca, source: "gemini_pass1", sinais: parsed1.sinais, motivo: parsed1.motivo };
  }
  if (!parsed1) console.warn(`[detectDoc] pass1 raw vazio/inválido: "${raw1.substring(0, 300)}"`);

  // ── Pass 2: gemini-2.5-pro ──
  console.log(`🤖 [detectDoc] pass1 ambíguo (${parsed1 ? parsed1.confianca.toFixed(2) : "no-parse"}) — pass2 com 2.5-pro`);
  const raw2 = await callGemini(PROMPT_PASS2, imagePart, apiKey, "gemini-2.5-pro");
  const parsed2 = parseDetectJson(raw2);
  if (parsed2 && parsed2.confianca >= 0.60) {
    console.log(`🤖 [detectDoc] pass2 decidiu: ${parsed2.tipo} (${parsed2.confianca.toFixed(2)}) motivo=${parsed2.motivo || "-"} sinais=${JSON.stringify(parsed2.sinais)}`);
    return { tipo: parsed2.tipo, confianca: parsed2.confianca, source: "gemini_pass2", sinais: parsed2.sinais, motivo: parsed2.motivo };
  }
  if (!parsed2) console.warn(`[detectDoc] pass2 raw vazio/inválido: "${raw2.substring(0, 300)}"`);

  // ── Pass 3: desempate ──
  console.log(`🤖 [detectDoc] pass2 ambíguo — pass3 desempate`);
  const raw3 = await callGemini(PROMPT_PASS3, imagePart, apiKey, "gemini-2.5-flash");
  const parsed3 = parseDetectJson(raw3);
  if (parsed3) {
    console.log(`🤖 [detectDoc] pass3 decidiu: ${parsed3.tipo} (${parsed3.confianca.toFixed(2)}) motivo=${parsed3.motivo || "-"} sinais=${JSON.stringify(parsed3.sinais)}`);
    return { tipo: parsed3.tipo, confianca: parsed3.confianca, source: "gemini_pass3", sinais: parsed3.sinais, motivo: parsed3.motivo };
  }
  console.warn(`[detectDoc] pass3 raw vazio/inválido: "${raw3.substring(0, 300)}"`);

  // Último recurso: melhor estimativa válida.
  const best = parsed2 || parsed1;
  if (best) {
    console.log(`🤖 [detectDoc] usando melhor estimativa: ${best.tipo} (${best.confianca.toFixed(2)})`);
    return { tipo: best.tipo, confianca: best.confianca, source: "gemini_pass2", sinais: best.sinais, motivo: best.motivo };
  }
  // 🛡️ FAIL-OPEN: as 3 passadas falharam por motivo TÉCNICO (429, timeout, parse).
  // NÃO rejeitar como "outro" — isso travava documentos válidos quando a IA
  // estava em quota. Em vez disso, assume rg_antigo (default histórico) e deixa
  // o OCR real decidir. Se for um arquivo errado, o OCR falha e o retry pede de novo.
  console.warn(`⚠️ [detectDoc] sem parse nas 3 passadas — FAIL-OPEN: assumindo rg_antigo para o OCR seguir`);
  return { tipo: "rg_antigo", confianca: 0, source: "fallback", motivo: "classificador indisponível (fail-open)" };
}

/** API compatível com o código antigo. Mapeia "outro" para "rg_antigo" (default histórico). */
export async function detectDocumentType(input: DetectInput): Promise<DocumentTypeCanonical> {
  const r = await detectDocumentTypeDetailed(input);
  return r.tipo === "outro" ? "rg_antigo" : r.tipo;
}

import { fetchWithTimeout, withRetry, TIMEOUT_FETCH_IMAGE, TIMEOUT_GEMINI } from "./utils.ts";
import { normalizarRG, validarDataNascimento, validarNomeOCR, validarCPFDigitos } from "./conversation-helpers.ts";
import { captureError } from "./sentry.ts";
import { isMockMode, mockBillOcr, mockDocOcr, shouldForceOcrFail, isTestMode } from "./test-mode.ts";
import { normalizeDistribuidora, isHoldingName } from "./distribuidoras.ts";

// ─── Lovable AI Gateway shim ────────────────────────────────────────
// Substitui chamadas diretas a generativelanguage.googleapis.com pelo
// Lovable AI Gateway (mesmo modelo google/gemini-2.5-flash, billing
// centralizado via LOVABLE_API_KEY). O retorno é moldado como o payload
// nativo do Gemini (`candidates[0].content.parts[0].text`) para que o
// código de parsing existente continue funcionando sem alteração.
type GeminiLikeResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<any>;
};

async function callGeminiViaLovable(
  prompt: string,
  img: { mime: string; b64: string },
  opts: { maxTokens?: number; responseJson?: boolean } = {},
): Promise<GeminiLikeResponse> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY") ?? "";
  if (!apiKey) {
    return {
      ok: false,
      status: 500,
      json: async () => ({ error: { message: "LOVABLE_API_KEY ausente" } }),
    };
  }
  const body: Record<string, unknown> = {
    model: "google/gemini-2.5-flash",
    messages: [{
      role: "user",
      content: [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: `data:${img.mime};base64,${img.b64}` } },
      ],
    }],
    temperature: 0,
    max_tokens: opts.maxTokens ?? 4096,
  };
  if (opts.responseJson) body.response_format = { type: "json_object" };

  const res = await fetchWithTimeout("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    timeout: TIMEOUT_GEMINI,
  });

  let raw: any = {};
  try { raw = await res.json(); } catch { /* ignore */ }
  const text = raw?.choices?.[0]?.message?.content ?? "";
  const finishReason = raw?.choices?.[0]?.finish_reason ?? null;
  const errorMsg = raw?.error?.message ?? (res.ok ? undefined : `HTTP ${res.status}`);
  const shaped = res.ok
    ? { candidates: [{ content: { parts: [{ text }] }, finishReason }] }
    : { error: { message: errorMsg } };

  return {
    ok: res.ok,
    status: res.status,
    json: async () => shaped,
  };
}


// ─── Baixar imagem (Evolution API ou URL direta) ────────────────────
export async function baixarImagem(
  url: string | null,
  base64FromEvolution?: string,
  mediaMessage?: any
): Promise<{ b64: string; mime: string } | null> {
  // Tentativa 1: Base64 já fornecido pela Evolution API
  if (base64FromEvolution) {
    try {
      console.log("📥 Usando base64 da Evolution API");
      const mime = mediaMessage?.mimetype || "image/jpeg";
      console.log(`📥 Imagem Evolution: b64 len: ${base64FromEvolution.length}, tipo: ${mime}`);
      
      // Verificar se é PDF
      if (mime === "application/pdf" || mime.includes("pdf")) {
        console.log("📄 Detectado PDF - Gemini suporta PDF diretamente");
        // Gemini suporta PDF diretamente, não precisa converter
        return { b64: base64FromEvolution, mime: "application/pdf" };
      }
      
      return { b64: base64FromEvolution, mime };
    } catch (e: any) {
      console.error("⚠️ Erro ao processar base64 Evolution:", e.message);
    }
  }

  // Tentativa 2: URL direta (se disponível)
  if (url) {
    try {
      console.log("📥 Baixando imagem via URL direta:", url.substring(0, 100));
      
      // Verificar se é data URL (data:mime;base64,...)
      if (url.startsWith("data:")) {
        console.log("📥 Detectado data URL");
        const match = url.match(/^data:([^;]+);base64,(.+)$/);
        if (match) {
          const mime = match[1];
          const b64 = match[2];
          console.log(`📥 Data URL: tipo: ${mime}, b64 len: ${b64.length}`);
          
          // Se for PDF, retornar diretamente
          if (mime === "application/pdf" || mime.includes("pdf")) {
            console.log("📄 Data URL é PDF - usando diretamente");
            return { b64, mime: "application/pdf" };
          }
          
          return { b64, mime };
        }
      }
      
      const imgRes = await fetchWithTimeout(url, { timeout: TIMEOUT_FETCH_IMAGE });
      if (imgRes.ok) {
        const buf = await imgRes.arrayBuffer();
        const u8 = new Uint8Array(buf);
        const mime = imgRes.headers.get("content-type") || "image/jpeg";
        console.log(`📥 Imagem baixada: ${u8.length} bytes, tipo: ${mime}`);
        
        if (u8.length < 1000) {
          console.warn("⚠️ Imagem muito pequena (<1KB), pode ser preview ou erro");
        }
        
        // Se for PDF, verificar tamanho
        if (mime === "application/pdf" || mime.includes("pdf")) {
          const sizeMB = u8.length / (1024 * 1024);
          console.log(`📄 PDF baixado: ${sizeMB.toFixed(2)} MB`);
          
          if (sizeMB > 20) {
            console.warn(`⚠️ PDF muito grande (${sizeMB.toFixed(2)} MB), pode falhar no Gemini`);
          }
        }
        
        let bin = "";
        for (let i = 0; i < u8.length; i += 8192) {
          bin += String.fromCharCode(...u8.subarray(i, Math.min(i + 8192, u8.length)));
        }
        return { b64: btoa(bin), mime };
      }
      console.error("⚠️ URL direta falhou:", imgRes.status);
    } catch (e: any) {
      console.error("⚠️ Erro URL direta:", e.message);
    }
  }

  console.error("❌ Não conseguiu baixar imagem. url:", url, "base64:", !!base64FromEvolution);
  return null;
}

// ─── OCR Conta de Energia via Gemini 2.5 Flash ──────────────────────────
export async function ocrContaEnergia(
  imagemUrl: string | null,
  geminiApiKey: string,
  base64FromEvolution?: string,
  mediaMessage?: any
): Promise<{ sucesso: boolean; dados?: any; erro?: string }> {
  try {
    // 🧪 Cenário do bot-e2e-runner: força fail para validar caminho de retry.
    // Gated por `isTestMode()` — produção nunca passa por aqui.
    if (isTestMode() && shouldForceOcrFail()) {
      console.log("🧪 [ocrContaEnergia] forceOcrFail=true → simulando falha");
      return { sucesso: false, erro: "test_force_ocr_fail" };
    }
    // 🧪 Sandbox tradicional (mock mode): a imagem de teste é um PNG 1x1 fake,
    // o Gemini não tem o que extrair. Retorna payload determinístico para o
    // happy_path conseguir avançar. Só ativa em isMockMode() (sandbox phone
    // 5500000... SEM x-bot-real-services) — produção e "Modo Real" usam Gemini.
    if (isMockMode()) {
      console.log("🧪 [ocrContaEnergia] mockMode → retornando OCR mock da conta");
      return mockBillOcr();
    }
    // OCR roda de verdade (Gemini) em produção e no Modo Real do simulador.
    if (!geminiApiKey) return { sucesso: false, erro: "GEMINI_API_KEY não configurada" };

    const img = await baixarImagem(imagemUrl, base64FromEvolution, mediaMessage);
    if (!img) return { sucesso: false, erro: "Não conseguiu baixar imagem da conta" };
    console.log(`🔍 OCR Conta - Imagem OK: ${img.mime}, b64 len: ${img.b64.length}`);

    const prompt = `Você é um especialista em extrair dados de contas de energia elétrica brasileiras.
ANALISE ESTA IMAGEM DE CONTA DE ENERGIA e extraia os dados do CLIENTE (não da distribuidora).
IMPORTANTE: NÃO extraia CPF - o CPF será obtido do documento de identidade separadamente.

Extraia:
1. NOME do TITULAR CONTRATANTE (geralmente no topo da fatura, perto de "Cliente"/"Titular"/"Razão Social"). NÃO confunda com nomes em histórico, segunda via, ou anúncios. Se houver mais de um nome impresso, use o que estiver no bloco principal de identificação do cliente.
2. ENDEREÇO DE INSTALAÇÃO — procure o bloco **"ENDEREÇO DE INSTALAÇÃO" / "UNIDADE CONSUMIDORA" / "LOCAL DE FORNECIMENTO" / "ENDEREÇO DO IMÓVEL"**. NÃO use o endereço de correspondência, da agência, do PAGADOR, da loja ou da própria distribuidora. O endereço de instalação fica próximo do "Nº da Instalação" / "Seu Código" / "Código do Cliente". Devolva apenas a rua/avenida (com prefixo R., RUA, AV., AVENIDA, AL., ALAMEDA, TV., TRAVESSA, ROD., ESTRADA, PRAÇA), SEM número.
3. NÚMERO do endereço de instalação
4. BAIRRO do endereço de instalação
5. CEP do endereço de instalação — 8 dígitos no formato XXXXX-XXX. Fica junto/abaixo do endereço de instalação ou da cidade/UF da instalação. NÃO use CEP da agência/distribuidora/correspondência. Devolva sempre os 8 dígitos quando visível na fatura.
6. CIDADE do endereço de instalação
7. ESTADO (sigla UF, ex: SP, MG, RJ) do endereço de instalação
8. DISTRIBUIDORA (nome REGIONAL da concessionária — NUNCA o grupo holding. Use: CPFL PIRATININGA, CPFL PAULISTA, CPFL SANTA CRUZ, RGE, ENEL SP, ENEL RJ, EDP SP, EDP ES, LIGHT, CEMIG, COPEL, CELESC, COELBA, CELPE, COSERN, COELCE, EQUATORIAL GO/PA/MA/PI/AL, CEB, ENERGISA <UF>, AMAZONAS ENERGIA, RORAIMA ENERGIA, ELEKTRO etc. NÃO escreva apenas "CPFL ENERGIA", "ENEL", "EDP", "ENERGISA" ou "EQUATORIAL" sozinhos)
9. NÚMERO DA INSTALAÇÃO (campo "Seu Código" na CPFL, "Nº do Cliente" na Enel, geralmente 7-12 dígitos)
10. VALOR TOTAL A PAGAR (em reais)
11. CONSUMO MÉDIO em kWh — procure por "Consumo medido (kWh)", "Consumo do mês (kWh)", "Média kWh", "Histórico de Consumo - Média", "Consumo Faturado kWh". Quando houver histórico mensal, calcule a média dos últimos 12 meses. Se só houver o consumo do mês atual, devolva esse valor. Retorne APENAS o número inteiro em kWh (sem unidade).

⚠️ VALIDAÇÃO OBRIGATÓRIA do consumo (R$/kWh): a tarifa B1 residencial no Brasil é de R$ 0,80 a R$ 1,50 por kWh. Antes de devolver, calcule valorConta ÷ consumoMedio. Se cair FORA da faixa [0.70 .. 1.60], você escolheu o campo errado — procure outro número no histórico ou na tabela de faturamento.
NÃO use: demanda contratada (kW), consumo de fase isolada (Fase A/B/C), consumo de mês específico fora da média, energia injetada/compensada, ou qualquer valor em kW (sem o "h"). Use SEMPRE a média kWh dos últimos 12 meses ou o consumo total faturado do mês.

Retorne APENAS JSON válido:
{"nome":"","endereco":"","numero":"","bairro":"","cep":"","cidade":"","estado":"","distribuidora":"","numeroInstalacao":"","valorConta":"","consumoMedio":""}

Se não encontrar um campo, use "". NÃO invente dados.`;

    console.log("🔍 OCR Conta - Chamando Lovable AI Gateway (google/gemini-2.5-flash)...");
    const gemRes = await withRetry(
      () => callGeminiViaLovable(prompt, img, { maxTokens: 4096, responseJson: true }),
      {
        maxAttempts: 2,
        retryOn: (e) => {
          const msg = String(e);
          return msg.includes("429") || msg.includes("500") || msg.includes("timeout") || msg.includes("abort");
        },
      }
    );


    const gemData = await gemRes.json();
    console.log("🔍 OCR Conta - Gemini status:", gemRes.status);
    if (!gemRes.ok) {
      console.error("❌ Gemini erro:", JSON.stringify(gemData).substring(0, 500));
      return { sucesso: false, erro: `Gemini ${gemRes.status}: ${gemData?.error?.message || "erro"}` };
    }

    if (!gemData.candidates?.length) {
      console.error("❌ Gemini sem candidates:", JSON.stringify(gemData).substring(0, 500));
      return { sucesso: false, erro: "Gemini sem candidates (imagem ilegível?)" };
    }

    const text = gemData.candidates[0]?.content?.parts?.[0]?.text || "";
    const finishReason = gemData.candidates[0]?.finishReason;
    console.log("🔍 OCR Conta - resposta:", text.substring(0, 300), "| finishReason:", finishReason, "| len:", text.length);
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      console.error("❌ OCR Conta - JSON incompleto (finishReason=" + finishReason + "). Resposta full:", text.substring(0, 1500));
      return { sucesso: false, erro: `Não extraiu JSON (finish=${finishReason || "?"})` };
    }

    const dados = JSON.parse(match[0]);

    // Anti-confusão street↔nome: se "endereco" não tem prefixo de logradouro e parece nome
    // de pessoa (≤3 tokens, só letras), descarta — evita poluir ViaCEP reverso.
    if (dados.endereco) {
      const end = String(dados.endereco).trim();
      const hasLogPrefix = /^(R\.?|RUA|AV\.?|AVENIDA|AL\.?|ALAMEDA|TV\.?|TRAVESSA|ROD\.?|RODOVIA|EST\.?|ESTRADA|PRA[CÇ]A|PR\.?|LARGO|VIA|VL\.?|VIELA|PASSAGEM|PSG\.?)\b/i.test(end);
      const tokens = end.split(/\s+/).filter(Boolean);
      const onlyLettersTokens = tokens.every((t: string) => /^[A-Za-zÀ-ÖØ-öø-ÿ.'-]+$/.test(t));
      if (!hasLogPrefix && tokens.length <= 3 && onlyLettersTokens) {
        console.warn(`⚠️ [ocr] endereco "${end}" parece NOME, não logradouro — descartando`);
        dados.endereco = "";
        // Sem logradouro confiável, cidade/bairro também ficam suspeitos pro lookup
        // mas mantemos pra exibição ao usuário; só limpamos pra não tentar ViaCEP reverso.
        dados._endereco_descartado = true;
      }
    }

    if (dados.cep) { const c = dados.cep.replace(/\D/g, ""); dados.cep = c.length === 8 ? c : ""; }

    // Segunda passada focada em CEP quando a primeira falhou
    if (!dados.cep) {
      try {
        console.log("🔍 [ocr] CEP não veio no 1º pass — tentando 2ª passada focada");
        const cepPrompt = `Encontre apenas o CEP do ENDEREÇO DE INSTALAÇÃO (UNIDADE CONSUMIDORA / LOCAL DE FORNECIMENTO) desta conta de luz brasileira. Ignore CEP de agência, distribuidora ou correspondência. Responda APENAS JSON: {"cep":"XXXXXXXX"} (8 dígitos, sem hífen) ou {"cep":""} se não encontrar.`;
        const cepRes = await callGeminiViaLovable(cepPrompt, img, { maxTokens: 128, responseJson: true });
        if (cepRes.ok) {
          const cepData = await cepRes.json();
          const cepText = cepData?.candidates?.[0]?.content?.parts?.[0]?.text || "";
          const cepMatch = cepText.match(/\{[\s\S]*\}/);
          if (cepMatch) {
            const parsed = JSON.parse(cepMatch[0]);
            const c = String(parsed?.cep || "").replace(/\D/g, "");
            if (c.length === 8) {
              dados.cep = c;
              console.log(`✅ [ocr] CEP recuperado no 2º pass: ${c}`);
            }
          }
        }
      } catch (e: any) {
        console.warn(`⚠️ [ocr] 2ª passada CEP falhou: ${e?.message}`);
      }
    }

    if (dados.numeroInstalacao) { const n = dados.numeroInstalacao.replace(/\D/g, ""); dados.numeroInstalacao = (n.length >= 7 && n.length <= 12) ? n : ""; }
    if (dados.valorConta) {
      // Parse robusto BR/US: "1.688,15" → 1688.15 ; "1688.15" → 1688.15 ; "1688" → 1688
      let raw = String(dados.valorConta).replace(/[^\d.,]/g, "");
      if (raw.includes(",")) {
        // Formato BR: "." é milhar, "," é decimal
        raw = raw.replace(/\./g, "").replace(",", ".");
      } else if ((raw.match(/\./g) || []).length > 1) {
        // Múltiplos pontos sem vírgula = todos são milhar (ex: "1.688.150")
        raw = raw.replace(/\./g, "");
      }
      const v = parseFloat(raw);
      dados.valorConta = (!isNaN(v) && v > 0) ? v.toFixed(2) : "";
    }
    // Consumo médio em kWh — só dígitos, aceita faixa 50..5000.
    if (dados.consumoMedio) {
      const raw = String(dados.consumoMedio).replace(/[^\d]/g, "");
      const n = parseInt(raw, 10);
      dados.consumoMedio = (!isNaN(n) && n >= 50 && n <= 5000) ? String(n) : "";
    }
    // Sanity-check secundário: R$/kWh tem que ficar em [0.70 .. 1.60] (B1 BR).
    // Se o Gemini extraiu um número fora dessa faixa (ex.: pegou demanda em kW
    // ou consumo isolado de uma fase), descarta o OCR e estima pelo valor.
    {
      const valor = parseFloat(String(dados.valorConta || "0"));
      const consumo = parseInt(String(dados.consumoMedio || "0"), 10);
      if (valor >= 30 && consumo >= 50) {
        const ratio = valor / consumo;
        if (ratio < 0.70 || ratio > 1.60) {
          const fallback = Math.max(100, Math.min(2000, Math.round(valor / 1.10)));
          console.warn(`[ocr][sanity] rejeitado consumo=${consumo} kWh valor=R$${valor} ratio=${ratio.toFixed(2)} → fallback=${fallback} kWh`);
          dados.consumoMedio = String(fallback);
          dados.consumo_rejeitado_motivo = `ratio=${ratio.toFixed(2)} fora de [0.70..1.60]`;
          dados.consumo_original_ocr = consumo;
        }
      }
    }


    // Normaliza distribuidora — resolve holdings (CPFL ENERGIA → CPFL PIRATININGA via cidade)
    if (dados.distribuidora) {
      const original = String(dados.distribuidora);
      const normalized = normalizeDistribuidora(original, dados.estado, dados.cidade);
      if (normalized && normalized !== original) {
        console.log(`🔧 OCR distribuidora normalizada: "${original}" → "${normalized}" (uf=${dados.estado} cidade=${dados.cidade})`);
      } else if (!normalized && isHoldingName(original)) {
        console.warn(`⚠️ OCR distribuidora holding sem cidade conhecida: "${original}" (uf=${dados.estado} cidade=${dados.cidade}) — exigirá correção manual`);
      }
      dados.distribuidora = normalized;
      dados.distribuidora_needs_review = !normalized;
    }

    // Score de confiança: % de campos críticos preenchidos.
    const criticos = [dados.nome, dados.endereco, dados.cidade, dados.estado, dados.distribuidora, dados.valorConta];
    const preenchidos = criticos.filter((v: any) => v && String(v).trim().length > 0).length;
    dados.confianca = Math.round((preenchidos / criticos.length) * 100);

    console.log(`✅ OCR Conta OK (confiança ${dados.confianca}%):`, JSON.stringify(dados).substring(0, 400));
    return { sucesso: true, dados };
  } catch (e: any) {
    console.error("❌ OCR Conta erro:", e.message || e);
    captureError(e, { tags: { module: "ocr", phase: "conta" } });
    return { sucesso: false, erro: e.message || String(e) };
  }
}

// ─── OCR Documento de Identidade via Gemini 2.5 Flash ───────────────────
// Prompts específicos para RG e CNH (frente e verso) para extração correta
export function buildPromptDocumento(tipo: string, isVerso = false): string {
  const isCNH = /cnh/i.test(tipo);
  if (isVerso && !isCNH) {
    return `Você é um especialista em extrair dados do VERSO do REGISTRO GERAL (RG) brasileiro.
ESTA IMAGEM É DO VERSO (COSTAS) DO RG (RG antigo OU CIN/RG novo).

🎯 PRIORIDADE MÁXIMA — PROCURE O CPF PRIMEIRO:
O CPF normalmente aparece no TOPO do verso do RG antigo, em uma faixa/cabeçalho à direita,
muitas vezes ACIMA ou ao LADO de "DATA DE NASCIMENTO". Procure também próximo às palavras
"CPF" ou "Cadastro de Pessoa Física" em QUALQUER região (topo, meio, rodapé, laterais).
São 11 dígitos no formato 123.456.789-00. Devolva sempre APENAS os 11 dígitos.

CAMPOS QUE COSTUMAM APARECER NO VERSO:
- NÚMERO DO RG (Registro Geral): no RG antigo aparece no VERSO rotulado como "REGISTRO GERAL" (frequentemente em VERMELHO), no formato XX.XXX.XXX-X (ex.: 60.070.001-X). Retorne APENAS os dígitos, INCLUINDO o dígito verificador final mesmo quando for letra X (use 'X' literal no fim se aparecer, ex.: "60070001X"). Tamanho típico 7 a 12 caracteres.
- CPF: 11 dígitos, rotulado "CPF" (FREQUENTEMENTE NO TOPO/CABEÇALHO do verso do RG antigo, formato 123.456.789-00). NUNCA confunda com Registro Civil, NIS/PIS/PASEP, Título de Eleitor, CNS, CNH, CTPS.
- NOME COMPLETO: se estiver legível.
- DATA DE NASCIMENTO: DD/MM/AAAA.
- FILIAÇÃO: Nome do Pai e Nome da Mãe (podem estar abreviados).

⚠️ NÃO confunda o "REGISTRO GERAL" do verso com o número de série/controle que aparece na lateral da FRENTE (esse é apenas um número de controle do documento, NÃO é o RG).

⚠️ ATENÇÃO CRÍTICA — CPF:
- O CPF é o campo MAIS IMPORTANTE deste documento. Examine TODA a imagem, COMEÇANDO PELO TOPO (cabeçalho), depois laterais, depois rodapé e áreas próximas a filiação.
- Aceite formatos com pontuação (123.456.789-00) ou sem (12345678900). Sempre devolva APENAS os 11 dígitos.
- NÃO confunda com: nº do RG, título eleitoral, PIS/NIS, CNS (cartão SUS, 15 dígitos), CNH, naturalização, certidão de nascimento.
- Se o CPF estiver borrado, cortado, ilegível ou parcialmente visível, retorne "". NUNCA chute.

REGRAS:
- Extraia SOMENTE o que estiver ESCRITO e LEGÍVEL. NUNCA invente.
- CPF: exatamente 11 dígitos (sem pontos/traços).
- RG: dígitos do "Registro Geral"; remova pontos, traços e espaços. PRESERVE o 'X' final se houver (dígito verificador). 7 a 12 caracteres.
- Data: estritamente DD/MM/AAAA. Se não encontrar, use "".

Retorne APENAS um JSON válido, sem markdown e sem texto antes ou depois:
{"nome":"","rg":"","cpf":"","dataNascimento":"","nomePai":"","nomeMae":""}`;
  }
  if (isCNH) {
    return `Você é um especialista em extrair dados da CARTEIRA NACIONAL DE HABILITAÇÃO (CNH) brasileira.
ANALISE ESTA IMAGEM DA FRENTE da CNH.

Na CNH (frente) os campos estão em posições padrão:
- NOME: nome do titular em destaque (geralmente no topo, em maiúsculas).
- CPF: exatamente 11 dígitos (campo "CPF" ou ao lado do número do documento).
- DATA DE NASCIMENTO: DD/MM/AAAA — fica perto do nome do titular, normalmente rotulada como "DATA NASCIMENTO" ou "NASCIMENTO".
- RG / IDENTIDADE: número do documento de identidade (pode aparecer como "Identidade" ou "RG"); retorne APENAS os dígitos (7 a 12 números).

⚠️ ATENÇÃO CRÍTICA — DATA DE NASCIMENTO:
A CNH tem VÁRIAS datas. Você DEVE extrair APENAS a data rotulada como "NASCIMENTO" / "DATA NASCIMENTO" / "DATA DE NASC.".
NUNCA confunda com:
  ❌ "DATA EMISSÃO" / "DATA DE EMISSÃO" / "EMITIDO EM"
  ❌ "VALIDADE" / "VÁLIDA ATÉ" / "VENCIMENTO"
  ❌ "1ª HABILITAÇÃO" / "PRIMEIRA HABILITAÇÃO" / "DATA 1ª HAB"
  ❌ Datas no verso ou no canto da página
Regra de plausibilidade: a data de nascimento DEVE ser anterior à data atual e o titular deve ter entre 18 e 100 anos (ano entre 1920 e ${new Date().getFullYear() - 17}).
Se houver QUALQUER dúvida sobre qual data é o nascimento, retorne "" em dataNascimento e marque dataNascimentoConfianca como "baixa".

Adicione um campo extra "dataNascimentoConfianca" com valor "alta" (rótulo "Nascimento" claramente visível ao lado), "media" (inferida pela posição perto do nome) ou "baixa" (sem rótulo claro ou ambígua).

REGRAS OBRIGATÓRIAS:
- Extraia APENAS o que está ESCRITO e LEGÍVEL. NUNCA invente ou adivinhe.
- Se um campo estiver ilegível, borrado ou cortado, use "" para esse campo.
- CPF: exatamente 11 dígitos numéricos (sem pontos, traços ou espaços).
- RG: apenas números (entre 7 e 12 dígitos); remova pontos, traços e qualquer letra.
- Data: estritamente DD/MM/AAAA.

Retorne APENAS este JSON, sem markdown e sem texto antes ou depois:
{"nome":"","rg":"","cpf":"","dataNascimento":"","dataNascimentoConfianca":"","nomePai":"","nomeMae":""}`;
  }
  // RG FRENTE (novo ou antigo)
  return `Você é um especialista em extrair dados da FRENTE do REGISTRO GERAL (RG) brasileiro.
ANALISE ESTA IMAGEM DA FRENTE do RG (pode ser RG antigo OU CIN/RG novo em policarbonato).

🎯 PRIORIDADE MÁXIMA — PROCURE O CPF PRIMEIRO:
No RG NOVO/CIN o CPF QUASE SEMPRE aparece na FRENTE, frequentemente no TOPO/CABEÇALHO
(faixa superior) ou logo abaixo do nome, rotulado "CPF". Procure também laterais e rodapé.
São 11 dígitos (formato 123.456.789-00). Devolva sempre APENAS os 11 dígitos.

Na frente do RG brasileiro:
- NOME COMPLETO: nome do titular (campo "Nome", "Nome do Titular" ou no topo).
- RG (Registro Geral):
  • RG NOVO/CIN (policarbonato): número rotulado claramente como "RG" ou "Registro Geral", formato XX.XXX.XXX-X. Retorne os dígitos.
  • RG ANTIGO (cartão verde papel): na FRENTE geralmente NÃO aparece o número do Registro Geral — o número da lateral (próximo a "VÁLIDO" ou abaixo da foto, ex.: 59684750, 8284-2) é apenas um nº de SÉRIE/CONTROLE, NÃO É o RG. NESSE CASO, retorne "" no campo rg e o sistema buscará o RG no verso.
  • Preserve o 'X' final (dígito verificador) se houver. 7 a 12 caracteres.
- CPF: 11 dígitos. No RG novo/CIN o CPF QUASE SEMPRE aparece impresso na FRENTE (geralmente no TOPO), rotulado como "CPF". No RG antigo, geralmente fica no VERSO — mas SE estiver visível na frente (cabeçalho/rodapé), capture.
- DATA DE NASCIMENTO: DD/MM/AAAA (campo "Nascimento", "Data de Nasc." ou "Nascimento").
- NOME DO PAI e NOME DA MÃE: se aparecerem na frente.

⚠️ ATENÇÃO CRÍTICA — CPF:
- Examine TODA a imagem, COMEÇANDO PELO TOPO/CABEÇALHO, depois laterais, depois rodapé.
- Aceite formato pontuado (123.456.789-00) ou sem pontuação (12345678900); devolva sempre APENAS os 11 dígitos.
- NÃO confunda CPF com: nº do RG, título de eleitor, PIS/NIS, cartão SUS (CNS, 15 dígitos), CNH, nº de inscrição.
- Se o CPF estiver borrado, cortado, ilegível ou ausente, retorne "". NUNCA chute.

REGRAS OBRIGATÓRIAS:
- Extraia SOMENTE o que está ESCRITO e LEGÍVEL. NUNCA invente.
- CPF: exatamente 11 dígitos (sem pontos/traços).
- RG: apenas números (7 a 12 dígitos); remova pontos, traços e espaços.
- Data: estritamente DD/MM/AAAA.

Retorne APENAS este JSON, sem markdown e sem texto antes ou depois:
{"nome":"","rg":"","cpf":"","dataNascimento":"","nomePai":"","nomeMae":""}`;
}

export async function ocrDocumento(imagemUrl: string | null, geminiApiKey: string, tipo: string = "RG", whapiToken?: string, mediaId?: string, isVerso = false): Promise<{ sucesso: boolean; dados?: any; erro?: string }> {
  try {
    // 🧪 Cenário bot-e2e-runner: força fail (gated em testMode).
    if (isTestMode() && shouldForceOcrFail()) {
      console.log("🧪 [ocrDocumento] forceOcrFail=true → simulando falha");
      return { sucesso: false, erro: "test_force_ocr_fail" };
    }
    // 🧪 Sandbox tradicional (mock mode): PNG 1x1 fake → payload determinístico.
    if (isMockMode()) {
      console.log("🧪 [ocrDocumento] mockMode → retornando OCR mock do documento");
      return mockDocOcr();
    }
    if (!geminiApiKey) return { sucesso: false, erro: "GEMINI_API_KEY não configurada" };

    const img = await baixarImagem(imagemUrl, whapiToken, mediaId);
    if (!img) return { sucesso: false, erro: "Não conseguiu baixar imagem do documento" };
    console.log(`🔍 OCR Doc - Imagem OK: ${img.mime}, tipo: ${tipo}, lado: ${isVerso ? "verso" : "frente"}`);

    const prompt = buildPromptDocumento(tipo, isVerso);

    console.log("🔍 OCR Doc - Chamando Lovable AI Gateway (google/gemini-2.5-flash)...");
    const gemRes = await withRetry(
      () => callGeminiViaLovable(prompt, img, { maxTokens: 4096, responseJson: true }),
      {
        maxAttempts: 2,
        retryOn: (e) => {
          const msg = String(e);
          return msg.includes("429") || msg.includes("500") || msg.includes("timeout") || msg.includes("abort");
        },
      }
    );


    const gemData = await gemRes.json();
    console.log("🔍 OCR Doc - Gemini status:", gemRes.status);
    if (!gemRes.ok) {
      console.error("❌ Gemini erro:", JSON.stringify(gemData).substring(0, 500));
      return { sucesso: false, erro: `Gemini ${gemRes.status}: ${gemData?.error?.message || "erro"}` };
    }

    if (!gemData.candidates?.length) {
      console.error("❌ Gemini sem candidates:", JSON.stringify(gemData).substring(0, 500));
      return { sucesso: false, erro: "Gemini sem candidates (imagem ilegível?)" };
    }

    const text = gemData.candidates[0]?.content?.parts?.[0]?.text || "";
    const finishReason = gemData.candidates[0]?.finishReason;
    console.log("🔍 OCR Doc - resposta:", text.substring(0, 350), "| finishReason:", finishReason, "| len:", text.length);
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      console.error("❌ OCR Doc - JSON incompleto (finishReason=" + finishReason + "). Resposta full:", text.substring(0, 1500));
      return { sucesso: false, erro: `Não extraiu JSON (finish=${finishReason || "?"})` };
    }

    const dados = JSON.parse(match[0]);
    const cpfLimpo = dados.cpf ? dados.cpf.replace(/\D/g, "") : "";
    dados.cpf = cpfLimpo.length === 11 && validarCPFDigitos(cpfLimpo) ? cpfLimpo : "";
    if (dados.rg) {
      const rgDig = dados.rg.replace(/\D/g, "");
      dados.rg = normalizarRG(dados.rg) || (rgDig.length >= 7 && rgDig.length <= 12 ? rgDig : "");
    }
    if (dados.dataNascimento) {
      const validada = validarDataNascimento(dados.dataNascimento);
      // Validação de plausibilidade extra: ano entre 1920 e (hoje - 17 anos)
      if (validada) {
        const m = validada.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        if (m) {
          const year = parseInt(m[3], 10);
          const maxYear = new Date().getFullYear() - 17;
          if (year < 1920 || year > maxYear) {
            console.warn(`⚠️ Data nasc fora do plausível (${year}): descartando`);
            dados.dataNascimento = "";
            dados.dataNascimentoConfianca = "baixa";
          } else {
            dados.dataNascimento = validada;
          }
        } else {
          dados.dataNascimento = validada;
        }
      } else {
        dados.dataNascimento = "";
      }
    }
    // Para CNH, se confiança não veio do modelo, marcar como "media" por padrão
    const isCNH = /cnh/i.test(tipo);
    if (isCNH && dados.dataNascimento && !dados.dataNascimentoConfianca) {
      dados.dataNascimentoConfianca = "media";
    }
    if (dados.nome) dados.nome = validarNomeOCR(dados.nome);

    // Score de confiança: campos críticos do documento (nome, cpf, rg, nascimento)
    const criticos = [dados.nome, dados.cpf, dados.rg, dados.dataNascimento];
    const preenchidos = criticos.filter((v: any) => v && String(v).trim().length > 0).length;
    dados.confianca = Math.round((preenchidos / criticos.length) * 100);

    console.log(`✅ OCR Doc OK (confiança ${dados.confianca}%):`, JSON.stringify(dados).substring(0, 400));
    return { sucesso: true, dados };
  } catch (e: any) {
    console.error("❌ OCR Doc erro:", e.message || e);
    captureError(e, { tags: { module: "ocr", phase: "documento" } });
    return { sucesso: false, erro: e.message || String(e) };
  }
}

/**
 * OCR focado APENAS em CPF — usado como segunda passada quando o OCR principal
 * extraiu nome/RG/nascimento mas não conseguiu o CPF. Procura agressivamente
 * em todas as áreas (topo, laterais, rodapé) e valida dígitos verificadores.
 */
export async function ocrCpfFocado(
  imagemUrl: string | null,
  geminiApiKey: string,
  base64?: string,
  mediaMessage?: any,
): Promise<string> {
  try {
    if (!geminiApiKey) return "";
    const img = await baixarImagem(imagemUrl, base64, mediaMessage);
    if (!img) return "";

    const prompt = `Sua ÚNICA tarefa é encontrar o CPF brasileiro nesta imagem de documento de identidade.

ONDE PROCURAR (nesta ordem):
1) TOPO/CABEÇALHO do documento — RG antigo costuma trazer o CPF na faixa superior do verso, e RG novo/CIN costuma trazer na faixa superior da frente.
2) Próximo às palavras "CPF", "C.P.F.", "Cadastro de Pessoa Física".
3) Laterais (direita e esquerda) e áreas próximas à foto.
4) Rodapé do documento.
5) Áreas próximas a "DATA DE NASCIMENTO", "NATURALIDADE" ou "FILIAÇÃO".

REGRAS:
- CPF tem EXATAMENTE 11 dígitos, podendo aparecer como "123.456.789-00" ou "12345678900".
- NÃO retorne: nº do RG, Título de Eleitor, PIS/NIS/PASEP, CNS (cartão SUS, 15 dígitos), CNH, nº de inscrição, naturalização.
- Se o CPF estiver borrado, cortado, ilegível ou ausente, retorne "" (string vazia). NUNCA chute.

Retorne APENAS este JSON, sem markdown:
{"cpf":""}`;

    const gemRes = await callGeminiViaLovable(prompt, img, { maxTokens: 256, responseJson: true });

    if (!gemRes.ok) return "";
    const gemData = await gemRes.json();
    const text = gemData?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return "";
    const obj = JSON.parse(m[0]);
    const cpfLimpo = String(obj?.cpf || "").replace(/\D/g, "");
    if (cpfLimpo.length === 11 && validarCPFDigitos(cpfLimpo)) {
      console.log(`✅ [ocrCpfFocado] CPF recuperado na segunda passada: ${cpfLimpo.substring(0,3)}***`);
      return cpfLimpo;
    }
    return "";
  } catch (e: any) {
    console.warn("⚠️ ocrCpfFocado falhou:", e?.message || e);
    return "";
  }
}

// ─────────────────────────────────────────────────────────────────────
// Passadas focadas: RG, NOME e NASCIMENTO (mesmo padrão de ocrCpfFocado)
// Usadas quando o OCR principal não conseguiu extrair o campo, garantindo
// que RG antigo, RG novo/CIN, CNH antiga e CNH nova nunca falhem em silêncio.
// ─────────────────────────────────────────────────────────────────────

async function gemFocado(prompt: string, img: { mime: string; b64: string }, geminiApiKey: string, maxTokens = 256): Promise<any | null> {
  try {
    const res = await callGeminiViaLovable(prompt, img, { maxTokens, responseJson: true });

    if (!res.ok) return null;
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const m = text.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  } catch (_) {
    return null;
  }
}

export async function ocrRgFocado(
  imagemUrl: string | null, geminiApiKey: string, base64?: string, mediaMessage?: any, lado: "frente" | "verso" = "verso",
): Promise<string> {
  try {
    if (!geminiApiKey) return "";
    const img = await baixarImagem(imagemUrl, base64, mediaMessage);
    if (!img) return "";
    const prompt = `Sua ÚNICA tarefa é encontrar o número do *REGISTRO GERAL (RG)* nesta imagem de documento brasileiro.

CONTEXTO: a imagem é do *${lado.toUpperCase()}* do documento.

ONDE PROCURAR:
- RG ANTIGO (cartão verde de papel): o número do REGISTRO GERAL fica no VERSO, geralmente impresso em VERMELHO, rotulado "REGISTRO GERAL" — formato XX.XXX.XXX-X (ex.: 60.070.001-X).
- RG NOVO / CIN (policarbonato): o número fica na FRENTE, rotulado "RG" ou "Registro Geral".
- CNH: campo "RG" ou "Identidade".

REGRAS:
- Tamanho típico: 7 a 12 caracteres.
- Preserve o dígito verificador final, mesmo se for letra X (use 'X' literal).
- Retorne APENAS dígitos + (opcionalmente) 'X' no final. Remova pontos, traços e espaços.
- NÃO confunda com: nº de série/controle da lateral da FRENTE do RG antigo, CPF, título de eleitor, CNS (15 dígitos), PIS/NIS, CNH.
- Se não encontrar com certeza, retorne "" (string vazia). NUNCA chute.

Retorne APENAS este JSON, sem markdown:
{"rg":""}`;
    const obj = await gemFocado(prompt, img, geminiApiKey);
    const rgRaw = String(obj?.rg || "").trim();
    if (!rgRaw) return "";
    const rgNorm = normalizarRG(rgRaw);
    if (rgNorm) {
      console.log(`✅ [ocrRgFocado:${lado}] RG recuperado: ${rgNorm}`);
      return rgNorm;
    }
    const limpo = rgRaw.replace(/[^\dXx]/g, "").toUpperCase();
    if (limpo.length >= 7 && limpo.length <= 12) {
      console.log(`✅ [ocrRgFocado:${lado}] RG (raw) recuperado: ${limpo}`);
      return limpo;
    }
    return "";
  } catch (e: any) {
    console.warn("⚠️ ocrRgFocado falhou:", e?.message || e);
    return "";
  }
}

export async function ocrNomeFocado(
  imagemUrl: string | null, geminiApiKey: string, base64?: string, mediaMessage?: any,
): Promise<string> {
  try {
    if (!geminiApiKey) return "";
    const img = await baixarImagem(imagemUrl, base64, mediaMessage);
    if (!img) return "";
    const prompt = `Sua ÚNICA tarefa é encontrar o *NOME COMPLETO do TITULAR* nesta imagem de documento brasileiro (RG ou CNH).

REGRAS:
- Retorne o nome do TITULAR (campo "NOME" / "NOME COMPLETO" / "NOME E SOBRENOME").
- NÃO retorne nome do pai, nome da mãe, naturalidade, ou nome da autoridade.
- Nome completo brasileiro: 2 a 8 palavras, sem números, sem símbolos.
- Mantenha maiúsculas/minúsculas como no documento.
- Se não tiver certeza, retorne "" (string vazia). NUNCA chute.

Retorne APENAS este JSON, sem markdown:
{"nome":""}`;
    const obj = await gemFocado(prompt, img, geminiApiKey);
    const nome = validarNomeOCR(String(obj?.nome || ""));
    if (nome) {
      console.log(`✅ [ocrNomeFocado] nome recuperado: ${nome}`);
      return nome;
    }
    return "";
  } catch (e: any) {
    console.warn("⚠️ ocrNomeFocado falhou:", e?.message || e);
    return "";
  }
}

export async function ocrNascimentoFocado(
  imagemUrl: string | null, geminiApiKey: string, base64?: string, mediaMessage?: any,
): Promise<string> {
  try {
    if (!geminiApiKey) return "";
    const img = await baixarImagem(imagemUrl, base64, mediaMessage);
    if (!img) return "";
    const prompt = `Sua ÚNICA tarefa é encontrar a *DATA DE NASCIMENTO* nesta imagem de documento brasileiro (RG ou CNH).

REGRAS:
- Retorne SOMENTE a data rotulada como "DATA DE NASCIMENTO" / "NASCIMENTO" / "DATA NASC." / "DT. NASC.".
- ❌ NÃO retorne: data de emissão, data de validade, data de expedição, primeira habilitação, qualquer outra data.
- Formato de saída: DD/MM/AAAA.
- O ano deve ser plausível (entre 1920 e ${new Date().getFullYear() - 17}).
- Se não tiver certeza, retorne "" (string vazia). NUNCA chute.

Retorne APENAS este JSON, sem markdown:
{"dataNascimento":""}`;
    const obj = await gemFocado(prompt, img, geminiApiKey);
    const dt = validarDataNascimento(String(obj?.dataNascimento || ""));
    if (dt) {
      const m = dt.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (m) {
        const ano = parseInt(m[3], 10);
        const max = new Date().getFullYear() - 17;
        if (ano >= 1920 && ano <= max) {
          console.log(`✅ [ocrNascimentoFocado] data recuperada: ${dt}`);
          return dt;
        }
      }
    }
    return "";
  } catch (e: any) {
    console.warn("⚠️ ocrNascimentoFocado falhou:", e?.message || e);
    return "";
  }
}

/**
 * OCR frente e verso do documento.
 * Parâmetros renomeados para clareza:
 *   frenteBase64 = base64 da frente (obtido via Evolution downloadMedia)
 *   frenteMediaMsg = mediaMessage da frente (para mime type)
 *   versoBase64 = base64 do verso
 */
export async function ocrDocumentoFrenteVerso(
  frenteUrl: string | null, versoUrl: string | null, tipo: string,
  geminiApiKey: string, frenteBase64?: string, frenteMediaMsg?: any, versoBase64?: string
): Promise<{ sucesso: boolean; dados?: any; erro?: string }> {
  // 🧪 Cenário bot-e2e-runner: força fail (gated em testMode).
  if (isTestMode() && shouldForceOcrFail()) {
    console.log("🧪 [ocrDocumentoFrenteVerso] forceOcrFail=true → simulando falha");
    return { sucesso: false, erro: "test_force_ocr_fail" };
  }
  // 🧪 Sandbox tradicional (mock mode): PNG 1x1 fake → payload determinístico.
  if (isMockMode()) {
    console.log("🧪 [ocrDocumentoFrenteVerso] mockMode → retornando OCR mock do documento");
    return mockDocOcr();
  }
  // OCR sempre real (Gemini) em produção e no Modo Real do simulador.
  console.log(`🔍 ocrDocumentoFrenteVerso: frenteB64=${!!frenteBase64}, versoB64=${!!versoBase64}, frenteUrl=${frenteUrl?.substring(0,60)}, versoUrl=${versoUrl?.substring(0,60)}`);

  // OCR da frente — passa frenteBase64 e frenteMediaMsg
  const ocrFrente = await ocrDocumento(frenteUrl, geminiApiKey, tipo, frenteBase64, frenteMediaMsg);
  if (!ocrFrente.sucesso || !ocrFrente.dados) return ocrFrente;

  const d = ocrFrente.dados;
  const temVerso = !!(versoUrl || versoBase64);

  if (!temVerso) {
    // Sem verso: roda retries focados em todos os campos críticos na própria frente.
    const rec: string[] = [];
    if (!d.cpf || d.cpf.length !== 11) {
      const cpf2 = await ocrCpfFocado(frenteUrl, geminiApiKey, frenteBase64, frenteMediaMsg);
      if (cpf2) { d.cpf = cpf2; rec.push("cpf"); }
    }
    const rgDig = (d.rg || "").replace(/[^\dXx]/g, "");
    if (!rgDig || rgDig.length < 7) {
      const rg2 = await ocrRgFocado(frenteUrl, geminiApiKey, frenteBase64, frenteMediaMsg, "frente");
      if (rg2) { d.rg = rg2; rec.push("rg"); }
    }
    if (!validarNomeOCR(d.nome)) {
      const n2 = await ocrNomeFocado(frenteUrl, geminiApiKey, frenteBase64, frenteMediaMsg);
      if (n2) { d.nome = n2; rec.push("nome"); }
    }
    if (!validarDataNascimento(d.dataNascimento)) {
      const dt2 = await ocrNascimentoFocado(frenteUrl, geminiApiKey, frenteBase64, frenteMediaMsg);
      if (dt2) { d.dataNascimento = dt2; rec.push("nascimento"); }
    }
    const criticos = [d.nome, d.cpf, d.rg, d.dataNascimento];
    const preenchidos = criticos.filter((v: any) => v && String(v).trim().length > 0).length;
    d.confianca = Math.round((preenchidos / criticos.length) * 100);
    if (rec.length > 0) console.log(`🔁 OCR Doc (só frente) recuperou: ${rec.join(", ")} (conf ${d.confianca}%)`);
    console.log("✅ OCR Doc (só frente) OK:", JSON.stringify(d).substring(0, 400));
    return { sucesso: true, dados: d };
  }

  // OCR do verso — usa versoBase64 (NÃO frenteBase64!)
  console.log("🔍 OCR Doc - frente OK, extraindo VERSO com base64 do verso...");
  const ocrVerso = await ocrDocumento(versoUrl, geminiApiKey, tipo, versoBase64, undefined, true);
  if (!ocrVerso.sucesso || !ocrVerso.dados) {
    console.log("⚠️ OCR verso falhou ou sem dados, usando só frente");
    // Mesmo sem verso, tenta resgatar CPF na frente
    if (!d.cpf || d.cpf.length !== 11) {
      const cpf2 = await ocrCpfFocado(frenteUrl, geminiApiKey, frenteBase64, frenteMediaMsg);
      if (cpf2) d.cpf = cpf2;
    }
    return { sucesso: true, dados: d };
  }

  const v = ocrVerso.dados;
  if (!validarNomeOCR(d.nome) && validarNomeOCR(v.nome)) d.nome = v.nome;
  if ((!d.cpf || d.cpf.length !== 11) && v.cpf && v.cpf.length === 11) d.cpf = v.cpf;
  // RG do verso (REGISTRO GERAL) tem prioridade sobre número de série da frente do RG antigo
  if (v.rg) {
    const rgVerso = normalizarRG(v.rg) || (v.rg.replace(/[^\dXx]/g, "").length >= 7 && v.rg.replace(/[^\dXx]/g, "").length <= 12 ? v.rg.replace(/[^\dXx]/g, "").toUpperCase() : "");
    const rgFrente = normalizarRG(d.rg);
    if (rgVerso && (!rgFrente || rgFrente !== rgVerso)) {
      console.log(`🔁 RG: usando verso (REGISTRO GERAL=${rgVerso}) ao invés da frente (${rgFrente || "vazio"})`);
      d.rg = rgVerso;
    }
  }
  if (!validarDataNascimento(d.dataNascimento) && validarDataNascimento(v.dataNascimento)) d.dataNascimento = validarDataNascimento(v.dataNascimento);
  if (!d.nomePai && v.nomePai) d.nomePai = v.nomePai;
  if (!d.nomeMae && v.nomeMae) d.nomeMae = v.nomeMae;

  d.nome = validarNomeOCR(d.nome) || d.nome;
  if (d.rg) d.rg = normalizarRG(d.rg) || (d.rg.replace(/\D/g, "").length >= 7 && d.rg.replace(/\D/g, "").length <= 12 ? d.rg.replace(/\D/g, "") : "");
  if (d.dataNascimento) d.dataNascimento = validarDataNascimento(d.dataNascimento);

  // 🎯 RETRIES FOCADOS: garante que nome, CPF, RG e nascimento sejam encontrados
  // mesmo em RG antigo, RG novo/CIN, CNH antiga ou CNH nova. Alterna frente/verso.
  const recuperados: string[] = [];

  // CPF
  if (!d.cpf || d.cpf.length !== 11) {
    let cpf2 = await ocrCpfFocado(frenteUrl, geminiApiKey, frenteBase64, frenteMediaMsg);
    if (!cpf2) cpf2 = await ocrCpfFocado(versoUrl, geminiApiKey, versoBase64, undefined);
    if (cpf2) { d.cpf = cpf2; recuperados.push("cpf"); }
  }

  // RG
  const rgDigits = (d.rg || "").replace(/[^\dXx]/g, "");
  if (!rgDigits || rgDigits.length < 7) {
    let rg2 = await ocrRgFocado(versoUrl, geminiApiKey, versoBase64, undefined, "verso");
    if (!rg2) rg2 = await ocrRgFocado(frenteUrl, geminiApiKey, frenteBase64, frenteMediaMsg, "frente");
    if (rg2) { d.rg = rg2; recuperados.push("rg"); }
  }

  // NOME
  if (!validarNomeOCR(d.nome)) {
    let n2 = await ocrNomeFocado(frenteUrl, geminiApiKey, frenteBase64, frenteMediaMsg);
    if (!n2) n2 = await ocrNomeFocado(versoUrl, geminiApiKey, versoBase64, undefined);
    if (n2) { d.nome = n2; recuperados.push("nome"); }
  }

  // NASCIMENTO
  if (!validarDataNascimento(d.dataNascimento)) {
    let dt2 = await ocrNascimentoFocado(frenteUrl, geminiApiKey, frenteBase64, frenteMediaMsg);
    if (!dt2) dt2 = await ocrNascimentoFocado(versoUrl, geminiApiKey, versoBase64, undefined);
    if (dt2) { d.dataNascimento = dt2; recuperados.push("nascimento"); }
  }

  // Recalcular confiança após retries
  const criticos = [d.nome, d.cpf, d.rg, d.dataNascimento];
  const preenchidos = criticos.filter((v: any) => v && String(v).trim().length > 0).length;
  d.confianca = Math.round((preenchidos / criticos.length) * 100);

  if (recuperados.length > 0) {
    console.log(`🔁 OCR Doc recuperou via passada focada: ${recuperados.join(", ")} (confiança final ${d.confianca}%)`);
  }

  console.log("✅ OCR Doc (frente+verso) OK:", JSON.stringify(d).substring(0, 400));
  return { sucesso: true, dados: d };
}

import { fetchWithTimeout, withRetry, TIMEOUT_FETCH_IMAGE, TIMEOUT_GEMINI } from "./utils.ts";
import { normalizarRG, validarDataNascimento, validarNomeOCR, validarCPFDigitos } from "./conversation-helpers.ts";
import { captureError } from "./sentry.ts";
import { isMockMode, mockBillOcr, mockDocOcr, shouldForceOcrFail, isTestMode } from "./test-mode.ts";
import { normalizeDistribuidora, isHoldingName } from "./distribuidoras.ts";

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
    // OCR roda SEMPRE de verdade (Gemini), inclusive no simulador — usuário pediu
    // paridade total com o fluxo original. Mock OCR removido em 2026-05-25.
    if (!geminiApiKey) return { sucesso: false, erro: "GEMINI_API_KEY não configurada" };

    const img = await baixarImagem(imagemUrl, base64FromEvolution, mediaMessage);
    if (!img) return { sucesso: false, erro: "Não conseguiu baixar imagem da conta" };
    console.log(`🔍 OCR Conta - Imagem OK: ${img.mime}, b64 len: ${img.b64.length}`);

    const prompt = `Você é um especialista em extrair dados de contas de energia elétrica brasileiras.
ANALISE ESTA IMAGEM DE CONTA DE ENERGIA e extraia os dados do CLIENTE (não da distribuidora).
IMPORTANTE: NÃO extraia CPF - o CPF será obtido do documento de identidade separadamente.

Extraia:
1. NOME do TITULAR da conta
2. ENDEREÇO DE INSTALAÇÃO (rua/avenida, sem número)
3. NÚMERO do endereço
4. BAIRRO
5. CEP (8 dígitos)
6. CIDADE
7. ESTADO (sigla UF, ex: SP, MG, RJ)
8. DISTRIBUIDORA (nome da empresa de energia)
9. NÚMERO DA INSTALAÇÃO (campo "Seu Código" na CPFL, "Nº do Cliente" na Enel, geralmente 7-12 dígitos)
10. VALOR TOTAL A PAGAR (em reais)

Retorne APENAS JSON válido:
{"nome":"","endereco":"","numero":"","bairro":"","cep":"","cidade":"","estado":"","distribuidora":"","numeroInstalacao":"","valorConta":""}

Se não encontrar um campo, use "". NÃO invente dados.`;

    console.log("🔍 OCR Conta - Chamando Gemini 2.5 Flash...");
    const gemRes = await withRetry(
      () =>
        fetchWithTimeout(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ role: "user", parts: [{ text: prompt }, { inline_data: { mime_type: img.mime, data: img.b64 } }] }],
              generationConfig: { temperature: 0, maxOutputTokens: 2048, responseMimeType: "application/json" },
            }),
            timeout: TIMEOUT_GEMINI,
          }
        ),
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
    console.log("🔍 OCR Conta - resposta:", text.substring(0, 300));
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return { sucesso: false, erro: "Não extraiu JSON" };

    const dados = JSON.parse(match[0]);
    if (dados.cep) { const c = dados.cep.replace(/\D/g, ""); dados.cep = c.length === 8 ? c : ""; }
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
    if (!geminiApiKey) return { sucesso: false, erro: "GEMINI_API_KEY não configurada" };

    const img = await baixarImagem(imagemUrl, whapiToken, mediaId);
    if (!img) return { sucesso: false, erro: "Não conseguiu baixar imagem do documento" };
    console.log(`🔍 OCR Doc - Imagem OK: ${img.mime}, tipo: ${tipo}, lado: ${isVerso ? "verso" : "frente"}`);

    const prompt = buildPromptDocumento(tipo, isVerso);

    console.log("🔍 OCR Doc - Chamando Gemini 2.5 Flash...");
    const gemRes = await withRetry(
      () =>
        fetchWithTimeout(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ role: "user", parts: [{ text: prompt }, { inline_data: { mime_type: img.mime, data: img.b64 } }] }],
              generationConfig: { temperature: 0, maxOutputTokens: 2048, responseMimeType: "application/json" },
            }),
            timeout: TIMEOUT_GEMINI,
          }
        ),
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
    console.log("🔍 OCR Doc - resposta:", text.substring(0, 350));
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return { sucesso: false, erro: "Não extraiu JSON" };

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

    const gemRes = await fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }, { inline_data: { mime_type: img.mime, data: img.b64 } }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 256, responseMimeType: "application/json" },
        }),
        timeout: TIMEOUT_GEMINI,
      },
    );
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
    const res = await fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }, { inline_data: { mime_type: img.mime, data: img.b64 } }] }],
          generationConfig: { temperature: 0, maxOutputTokens: maxTokens, responseMimeType: "application/json" },
        }),
        timeout: TIMEOUT_GEMINI,
      },
    );
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
  // OCR sempre real (Gemini) — simulador agora roda igual fluxo original.
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

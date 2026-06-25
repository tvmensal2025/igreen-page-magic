// ─── Auditoria IA dos primeiros cadastros ──────────────────────────────────
//
// Pra os primeiros N leads (configurável via PORTAL2_AI_AUDIT_LIMIT, default
// 10), captura o trace completo de chamadas API + dados de entrada e manda
// pra edge function `portal2-ai-audit` (que chama Gemini com a chave da
// Supabase). Resultado salvo em portal2_audit_traces pro time revisar.
//
// Filosofia: "shadow review" — não muda decisão de cadastro, só observa e
// relata. Custo controlado por limite e modelo flash (~$0.0002/lead).

const GEMINI_MODEL = 'gemini-2.5-flash';

/**
 * Chama a edge function `portal2-ai-audit` no Supabase. Mantém GEMINI_API_KEY
 * isolada nas edge functions (não precisa expor no container do worker).
 */
export async function analyzeWithGemini({ supabaseUrl, workerSecret, payload }) {
  if (!supabaseUrl) throw new Error('SUPABASE_URL não configurada');
  if (!workerSecret) throw new Error('WORKER_SECRET não configurado');
  const url = `${supabaseUrl.replace(/\/$/, '')}/functions/v1/portal2-ai-audit`;
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 35_000);
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${workerSecret}`,
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
  } finally { clearTimeout(to); }

  if (!res.ok) {
    const txt = await res.text();
    // Mensagens acionáveis em vez de "Invalid JWT" genérico
    let hint = '';
    if (res.status === 401) {
      if (txt.includes('UNAUTHORIZED_INVALID_JWT_FORMAT') || txt.includes('Invalid JWT')) {
        hint = ' (verify_jwt do gateway ativo — confira [functions.portal2-ai-audit] verify_jwt=false em supabase/config.toml)';
      } else if (txt.includes('audit_secret_mismatch')) {
        hint = ' (WORKER_SECRET do container ≠ PORTAL2_WORKER_SECRET do Supabase)';
      } else if (txt.includes('audit_secret_not_configured')) {
        hint = ' (defina PORTAL2_WORKER_SECRET nos Functions Secrets do Supabase)';
      }
    } else if (res.status === 503 && txt.includes('gemini_not_configured')) {
      hint = ' (defina GEMINI_API_KEY nos Functions Secrets do Supabase)';
    }
    throw new Error(`audit edge ${res.status}${hint}: ${txt.slice(0, 300)}`);
  }
  const data = await res.json();
  return {
    summary: data.summary || null,
    findings: data.findings || [],
    next_actions: data.next_actions || [],
    model: data.model || GEMINI_MODEL,
    tokens_in: data.tokens_in ?? null,
    tokens_out: data.tokens_out ?? null,
  };
}

/**
 * Health-check do pipeline IA. Chama GET /portal2-ai-audit e devolve estado
 * pronto pra logar no boot e expor em GET /health do worker.
 */
export async function checkAuditHealth({ supabaseUrl, workerSecret }) {
  if (!supabaseUrl) return { healthy: false, error: 'SUPABASE_URL ausente' };
  if (!workerSecret) return { healthy: false, error: 'WORKER_SECRET ausente' };
  const url = `${supabaseUrl.replace(/\/$/, '')}/functions/v1/portal2-ai-audit`;
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${workerSecret}` },
      signal: ctrl.signal,
    });
    const txt = await res.text();
    if (!res.ok) {
      if (res.status === 401 && (txt.includes('Invalid JWT') || txt.includes('UNAUTHORIZED_INVALID_JWT_FORMAT'))) {
        return { healthy: false, error: 'gateway exige JWT — falta [functions.portal2-ai-audit] verify_jwt=false em supabase/config.toml' };
      }
      return { healthy: false, error: `status ${res.status}: ${txt.slice(0, 200)}` };
    }
    let data = {};
    try { data = JSON.parse(txt); } catch {}
    if (data.gemini_configured === false) {
      return { healthy: false, error: 'GEMINI_API_KEY não configurada no Supabase Functions Secrets' };
    }
    if (data.worker_secret_configured === false) {
      return { healthy: false, error: 'PORTAL2_WORKER_SECRET não configurado no Supabase Functions Secrets' };
    }
    return { healthy: true, info: data };
  } catch (e) {
    return { healthy: false, error: e.message };
  } finally { clearTimeout(to); }
}


/**
 * Sanitiza o trace e o input antes de mandar pra IA / persistir.
 * Remove campos enormes (base64, buffers) e PII sensível.
 */
export function sanitize(obj, depth = 0) {
  if (obj == null || depth > 12) return obj;
  if (typeof obj === 'string') {
    // Trunca strings muito longas (provavelmente base64)
    if (obj.length > 1500 && /^[A-Za-z0-9+/=]+$/.test(obj.slice(0, 200))) {
      return `[base64 omitted: ${obj.length} chars]`;
    }
    if (obj.length > 4000) return obj.slice(0, 4000) + `... [truncated ${obj.length - 4000}]`;
    return obj;
  }
  if (Buffer.isBuffer?.(obj)) return `[buffer ${obj.length}B]`;
  if (Array.isArray(obj)) return obj.map(v => sanitize(v, depth + 1));
  if (typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      // Drop fields known-heavy ou sensíveis
      if (['bill_base64', 'document_front_base64', 'fileB64', 'buffer'].includes(k)) {
        out[k] = `[${typeof v === 'string' ? v.length + 'B' : 'omitted'}]`;
        continue;
      }
      // CPF/RG: mascara mantendo só os 4 últimos
      if (['cpf', 'cpf_cnpj', 'document', 'documento'].includes(k) && typeof v === 'string') {
        const digits = v.replace(/\D/g, '');
        out[k] = digits.length > 4 ? `***${digits.slice(-4)}` : '***';
        continue;
      }
      out[k] = sanitize(v, depth + 1);
    }
    return out;
  }
  return obj;
}

/**
 * Roda o pipeline completo: chama Gemini (via edge function) + persiste no Supabase.
 * Best-effort — falhas não devem afetar o cadastro principal.
 */
export async function runAuditPipeline({
  supabase, supabaseUrl, workerSecret,
  customer_id, job_id, idconsultor,
  status, trace, input, result, error, extraction, duration_ms,
}) {
  // `extraction` (Req 4.4) — Modo_Extração + resultado por extractor; entra no
  // payload da IA e é dobrado no `result` persistido, sempre sanitizado (Req
  // 12: CPF/documento → 4 últimos dígitos, buffers/base64 omitidos).
  const sanitizedExtraction = extraction
    ? sanitize({ mode: extraction.mode, doc: extraction.doc, bill: extraction.bill })
    : null;

  const sanitized = {
    input: sanitize(input),
    result: sanitize(result),
    trace: sanitize(trace),
    extraction: sanitizedExtraction,
  };

  // Resultado persistido em `portal2_audit_traces.result` — inclui o resumo da
  // extração (modo + motivo do manual) quando disponível, mantendo a coluna
  // existente como portadora (não há coluna dedicada).
  const persistedResult = sanitizedExtraction
    ? {
        ...(sanitized.result && typeof sanitized.result === 'object' && !Array.isArray(sanitized.result)
          ? sanitized.result
          : { value: sanitized.result ?? null }),
        extraction: sanitizedExtraction,
      }
    : sanitized.result;

  let ai = null;
  let aiError = null;
  try {
    ai = await analyzeWithGemini({ supabaseUrl, workerSecret, payload: sanitized });
  } catch (e) {
    aiError = e.message;
    console.warn(`  ⚠ AI audit falhou: ${e.message}`);
  }

  // Cost estimation: gemini-2.5-flash ~$0.075/1M in, $0.30/1M out
  const cost_usd = ai && ai.tokens_in != null
    ? Number(((ai.tokens_in * 0.075 + ai.tokens_out * 0.30) / 1_000_000).toFixed(6))
    : null;

  if (supabase) {
    try {
      await supabase.from('portal2_audit_traces').insert({
        customer_id: customer_id || null,
        job_id: job_id ? String(job_id) : null,
        idconsultor: idconsultor || null,
        status,
        trace: sanitized.trace,
        input_summary: sanitized.input,
        result: persistedResult,
        error: error || null,
        ai_summary: ai?.summary || (aiError ? `[ai_error] ${aiError}` : null),
        ai_findings: ai?.findings || null,
        ai_model: ai?.model || null,
        ai_tokens_in: ai?.tokens_in ?? null,
        ai_tokens_out: ai?.tokens_out ?? null,
        ai_cost_usd: cost_usd,
        duration_ms,
      });
    } catch (e) {
      console.warn(`  ⚠ persistência audit falhou: ${e.message}`);
    }
  }

  return ai;
}

/**
 * Conta quantas auditorias já foram feitas. Worker para de auditar quando
 * passa do limite (pra controlar custo Gemini).
 */
export async function getAuditCount(supabase) {
  if (!supabase) return Infinity;
  try {
    const { count, error } = await supabase
      .from('portal2_audit_traces')
      .select('*', { count: 'exact', head: true });
    if (error) throw error;
    return count || 0;
  } catch (e) {
    console.warn(`  ⚠ contagem audit falhou: ${e.message}`);
    return Infinity; // fail-safe: para de auditar
  }
}

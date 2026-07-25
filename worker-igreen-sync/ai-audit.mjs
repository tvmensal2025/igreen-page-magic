/**
 * Auditoria IA do sync de carteira (shadow review via edge sync-ai-audit / Gemini).
 * Best-effort — nunca derruba o sync.
 *
 * Env:
 *   SUPABASE_URL              — obrigatório pra chamar a edge
 *   SYNC_AI_AUDIT_SECRET      — Bearer (default: WORKER_TOKEN)
 *   SYNC_AI_AUDIT_DISABLED=true — desliga
 *   SYNC_AI_AUDIT_LIMIT       — informativo no health (limite real é na edge, default 20)
 */

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const AUDIT_SECRET =
  process.env.SYNC_AI_AUDIT_SECRET ||
  process.env.WORKER_TOKEN ||
  process.env.WORKER_SECRET ||
  '';
const AUDIT_DISABLED =
  String(process.env.SYNC_AI_AUDIT_DISABLED || '').toLowerCase() === 'true';
const _rawLimit = Number(process.env.SYNC_AI_AUDIT_LIMIT);
const AUDIT_LIMIT = Number.isFinite(_rawLimit) && _rawLimit >= 0 ? _rawLimit : 20;

let auditHealth = {
  healthy: false,
  error: 'not_checked_yet',
  checked_at: null,
};

export function getSyncAuditHealth() {
  return {
    enabled: !AUDIT_DISABLED,
    limit: AUDIT_LIMIT,
    healthy: auditHealth.healthy,
    last_error: auditHealth.error,
    checked_at: auditHealth.checked_at,
    supabase_url_configured: Boolean(SUPABASE_URL),
    secret_configured: Boolean(AUDIT_SECRET),
  };
}

export async function checkSyncAuditHealth() {
  if (AUDIT_DISABLED) {
    auditHealth = {
      healthy: false,
      error: 'disabled_by_flag SYNC_AI_AUDIT_DISABLED=true',
      checked_at: new Date().toISOString(),
    };
    return auditHealth;
  }
  if (!SUPABASE_URL) {
    auditHealth = {
      healthy: false,
      error: 'SUPABASE_URL ausente',
      checked_at: new Date().toISOString(),
    };
    return auditHealth;
  }
  if (!AUDIT_SECRET) {
    auditHealth = {
      healthy: false,
      error: 'WORKER_TOKEN/SYNC_AI_AUDIT_SECRET ausente',
      checked_at: new Date().toISOString(),
    };
    return auditHealth;
  }
  const url = `${SUPABASE_URL}/functions/v1/sync-ai-audit`;
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${AUDIT_SECRET}` },
      signal: ctrl.signal,
    });
    const txt = await res.text();
    if (!res.ok) {
      auditHealth = {
        healthy: false,
        error: `status ${res.status}: ${txt.slice(0, 200)}`,
        checked_at: new Date().toISOString(),
      };
      return auditHealth;
    }
    let data = {};
    try {
      data = JSON.parse(txt);
    } catch {
      /* ignore */
    }
    if (data.gemini_configured === false) {
      auditHealth = {
        healthy: false,
        error: 'GEMINI_API_KEY não configurada na edge',
        checked_at: new Date().toISOString(),
      };
      return auditHealth;
    }
    auditHealth = {
      healthy: true,
      error: null,
      checked_at: new Date().toISOString(),
      info: data,
    };
    return auditHealth;
  } catch (e) {
    auditHealth = {
      healthy: false,
      error: e.message,
      checked_at: new Date().toISOString(),
    };
    return auditHealth;
  } finally {
    clearTimeout(to);
  }
}

/**
 * Dispara auditoria (não bloqueia se falhar). Falhas sempre tentam Gemini;
 * sucessos respeitam limite na edge.
 */
export async function maybeAuditSync(payload) {
  if (AUDIT_DISABLED) return { skipped: true, reason: 'disabled' };
  if (!SUPABASE_URL || !AUDIT_SECRET) {
    return { skipped: true, reason: 'not_configured' };
  }
  const url = `${SUPABASE_URL}/functions/v1/sync-ai-audit`;
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 35_000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${AUDIT_SECRET}`,
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    const txt = await res.text();
    let data = {};
    try {
      data = JSON.parse(txt);
    } catch {
      data = { raw: txt.slice(0, 300) };
    }
    if (!res.ok) {
      console.warn(`[ai-audit] edge ${res.status}: ${txt.slice(0, 300)}`);
      return { ok: false, status: res.status, data };
    }
    if (data.skipped) {
      console.log(`[ai-audit] skipped: ${data.reason || 'limit'}`);
    } else {
      console.log(
        `[ai-audit] ok model=${data.model || '?'} cost_usd=${data.cost_usd ?? '?'} findings=${(data.findings || []).length}`,
      );
    }
    return data;
  } catch (e) {
    console.warn(`[ai-audit] falhou: ${e.message}`);
    return { ok: false, error: e.message };
  } finally {
    clearTimeout(to);
  }
}

/** Resumo leve do resultado de /sync-all pra não mandar payload gigante à IA. */
export function summarizeSyncAllResult(out) {
  if (!out || typeof out !== 'object') return out;
  const len = (x) => (Array.isArray(x) ? x.length : x == null ? 0 : 1);
  return {
    ok: out.ok,
    consultor_id: out.consultor_id ?? null,
    counts: {
      customers: len(out.customers),
      members: len(out.members),
      boletos: len(out.boletos),
      telecom: len(out.telecom),
      seguros: len(out.seguros),
      devolutivas: len(out.devolutivas),
      details: len(out.details),
    },
    diagnostics: out.diagnostics || null,
    portal_extras_ok: !!out.portal_extras,
    full_extras_error: out.full_extras?.error || null,
    full_extras_blocks: out.full_extras?.blocks
      ? Object.keys(out.full_extras.blocks).length
      : 0,
  };
}

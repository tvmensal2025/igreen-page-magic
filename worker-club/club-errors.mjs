/**
 * Classificação de erros do iGreen Club.
 * Espelha mensagens típicas da API (error.response.data.error.message).
 */

export const ERROR_KINDS = Object.freeze({
  PAYLOAD_INVALID: 'payload_invalid',
  AUTH: 'auth',
  INADIMPLENTE: 'inadimplente',
  DUPLICATE: 'duplicate',
  VALIDATION: 'validation',
  TRANSPORT: 'transport',
  CF_BLOCK: 'cloudflare',
  UNKNOWN: 'unknown',
});

/**
 * @returns {{ kind: string, recoverable: boolean, message: string, retry: boolean }}
 */
export function classifyClubError(err) {
  const status = Number(err?.status || err?.response?.status || 0);
  const message = String(
    err?.body?.error?.message
    || err?.body?.message
    || err?.message
    || err
    || 'erro desconhecido',
  ).slice(0, 2000);

  const lower = message.toLowerCase();

  if (err?.code === 'PAYLOAD_INVALID' || lower.startsWith('payload_invalido')) {
    return { kind: ERROR_KINDS.PAYLOAD_INVALID, recoverable: true, retry: false, message };
  }

  if (status === 401 || status === 403 || /unauthorized|token|jwt|expir/i.test(lower)) {
    return { kind: ERROR_KINDS.AUTH, recoverable: true, retry: true, message };
  }

  if (/inadimplente/i.test(lower)) {
    return { kind: ERROR_KINDS.INADIMPLENTE, recoverable: false, retry: false, message };
  }

  if (/já cadastrad|ja cadastrad|already|duplicad|existe/i.test(lower)) {
    return { kind: ERROR_KINDS.DUPLICATE, recoverable: false, retry: false, message };
  }

  if (status >= 400 && status < 500) {
    return { kind: ERROR_KINDS.VALIDATION, recoverable: true, retry: false, message };
  }

  if (/cloudflare|cf_|attention required|403 forbidden/i.test(lower) || status === 403) {
    return { kind: ERROR_KINDS.CF_BLOCK, recoverable: true, retry: true, message };
  }

  if (/timeout|econn|fetch in-page|network|tunnel/i.test(lower) || status === 0) {
    return { kind: ERROR_KINDS.TRANSPORT, recoverable: true, retry: true, message };
  }

  if (status >= 500) {
    return { kind: ERROR_KINDS.TRANSPORT, recoverable: true, retry: true, message };
  }

  return { kind: ERROR_KINDS.UNKNOWN, recoverable: false, retry: false, message };
}

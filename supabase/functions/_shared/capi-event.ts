/**
 * Evento CAPI: chave estável, montagem do payload e leitura do erro da Meta.
 *
 * O `event_id` é o mecanismo de deduplicação da Meta. Se ele for estável, um
 * retry do mesmo fato NÃO infla conversão — é isso que torna o outbox seguro.
 * Se for aleatório (o que acontecia quando não havia `customer_id`), cada
 * tentativa conta como um evento novo e o relatório mente.
 *
 * Tudo aqui é puro, exceto o hash (usa WebCrypto).
 */

import { sha256Hex } from "./fb-graph.ts";

export type CapiEventName =
  | "Lead"
  | "Contact"
  | "SubmitApplication"
  | "Purchase"
  | "PageView"
  | "ViewContent"
  | "InitiateCheckout"
  | "CompleteRegistration";

/**
 * Chave estável do evento, no MESMO formato usado pelo `fb_emit_capi` do banco,
 * para que trigger e chamada HTTP do mesmo fato colidam na fila em vez de
 * gerarem dois eventos.
 */
export function buildCapiEventKey(input: {
  eventName: string;
  consultantId: string;
  customerId?: string | null;
  /** Data BRT (YYYY-MM-DD) usada só quando não há cliente. */
  dayBrt?: string;
}): string {
  if (input.customerId) return `${input.eventName}:${input.customerId}`;
  const day = input.dayBrt ??
    new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  return `${input.eventName}:${input.consultantId}:${day}`;
}

function norm(value: string): string {
  return value.trim().toLowerCase();
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

export interface CapiContactInput {
  email?: string | null;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  country?: string | null;
  externalId?: string | null;
  fbp?: string | null;
  fbc?: string | null;
  clientUserAgent?: string | null;
  clientIp?: string | null;
}

/**
 * Monta `user_data` no formato da Meta com PII em SHA-256.
 * `fbp`/`fbc`/user-agent/IP NÃO são hasheados (a Meta espera valor cru).
 */
export async function buildHashedUserData(
  contact: CapiContactInput,
): Promise<Record<string, unknown>> {
  const userData: Record<string, unknown> = {};
  if (contact.email) userData.em = [await sha256Hex(norm(contact.email))];
  if (contact.phone) userData.ph = [await sha256Hex(digitsOnly(contact.phone))];
  if (contact.firstName) {
    userData.fn = [await sha256Hex(norm(contact.firstName))];
  }
  if (contact.lastName) userData.ln = [await sha256Hex(norm(contact.lastName))];
  if (contact.city) {
    userData.ct = [await sha256Hex(norm(contact.city).replace(/\s+/g, ""))];
  }
  if (contact.state) userData.st = [await sha256Hex(norm(contact.state))];
  if (contact.zip) userData.zp = [await sha256Hex(digitsOnly(contact.zip))];
  if (contact.country) {
    userData.country = [await sha256Hex(norm(contact.country))];
  }
  if (contact.externalId) {
    userData.external_id = [await sha256Hex(String(contact.externalId))];
  }
  if (contact.fbp) userData.fbp = contact.fbp;
  if (contact.fbc) userData.fbc = contact.fbc;
  if (contact.clientUserAgent) {
    userData.client_user_agent = contact.clientUserAgent;
  }
  if (contact.clientIp) userData.client_ip_address = contact.clientIp;
  return userData;
}

export interface CapiEventPayloadInput {
  eventName: string;
  eventId: string;
  userData: Record<string, unknown>;
  offline?: boolean;
  sourceUrl?: string | null;
  value?: number | null;
  currency?: string | null;
  eventTimeSeconds?: number;
}

export const DEFAULT_CAPI_SOURCE_URL =
  "https://igreen.institutodossonhos.com.br";

/** Evento único no formato `data: [event]` da Meta. */
export function buildCapiEventPayload(
  input: CapiEventPayloadInput,
): Record<string, unknown> {
  const hasValue = typeof input.value === "number" && input.value > 0;
  return {
    event_name: input.eventName,
    event_time: input.eventTimeSeconds ?? Math.floor(Date.now() / 1000),
    event_id: input.eventId,
    action_source: input.offline ? "physical_store" : "website",
    event_source_url: input.sourceUrl || DEFAULT_CAPI_SOURCE_URL,
    user_data: input.userData,
    ...(hasValue
      ? {
        custom_data: {
          value: input.value,
          currency: input.currency || "BRL",
        },
      }
      : {}),
  };
}

/**
 * A Meta pode devolver HTTP 200 com `error` no corpo. Tratar isso como sucesso
 * fazia a função responder `ok:true` para evento recusado — o bug que esconde
 * perda de conversão. Aqui qualquer sinal de erro é erro.
 */
export function extractCapiError(response: unknown): string | null {
  if (!response || typeof response !== "object") return "resposta_invalida";
  const row = response as Record<string, unknown>;
  if (typeof row.error === "string") return row.error;
  if (row.error && typeof row.error === "object") {
    const err = row.error as Record<string, unknown>;
    const message = typeof err.message === "string" ? err.message : "erro_meta";
    const code = err.code ?? err.error_subcode;
    return code ? `${message} (code=${String(code)})` : message;
  }
  // Sucesso real traz `events_received`. Ausência total é suspeita.
  if (row.events_received === undefined && row.messages === undefined) {
    return "resposta_sem_confirmacao";
  }
  return null;
}

/** Deve tentar de novo? Erro de permissão/payload não melhora com repetição. */
export function isRetryableCapiError(message: string | null): boolean {
  if (!message) return false;
  const normalized = message.toLowerCase();
  const permanent = [
    "invalid parameter",
    "unsupported post request",
    "does not exist",
    "permission",
    "unsupported get request",
    "invalid access token",
    "code=190",
    "code=100",
  ];
  return !permanent.some((needle) => normalized.includes(needle));
}

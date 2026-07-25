/**
 * Trava: CLIENTE não recebe cadência A/B/C (prospecção como lead).
 *
 * Cliente → só pós-venda (`pos-venda-auto-progress`) e agendamento manual
 * (`send-scheduled-messages`). Nunca COLD/SMS/CALL/RECALL/A_NUDGE etc.
 *
 * Espelho UI: `src/lib/clienteCadenceGuard.ts` (manter em sync).
 */

import { isWalletCustomer } from "./origin-guard.ts";

/** Status CRM/funil que já saíram do ciclo lead A/B/C. */
export const CLIENTE_CADENCE_BLOCK_STATUSES = [
  "approved",
  "active",
  "registered_igreen",
  "cadastro_concluido",
  "complete",
] as const;

/** Andamento iGreen = cliente ativo na carteira (texto livre do sync). */
export const CLIENTE_ANDAMENTO_VALUES = [
  "ativo",
  "aprovado",
  "validado",
  "licenciada",
  "licenciado",
] as const;

export type ClienteCadenceSignals = {
  customer_origin?: string | null;
  status?: string | null;
  is_converted?: boolean | null;
  pos_venda_stage?: string | null;
  andamento_igreen?: string | null;
  /** Se true, retentativa reabriu Grupo A — NÃO bloquear. */
  pos_venda_recadastro_at?: string | null;
};

const STATUS_SET = new Set<string>(CLIENTE_CADENCE_BLOCK_STATUSES);
const ANDAMENTO_SET = new Set<string>(CLIENTE_ANDAMENTO_VALUES);

/**
 * True = proibido enviar variante A/B/C como lead.
 * Pós-venda e agenda humana NÃO usam este guard (caminhos separados).
 */
export function isClienteProibidoCadenciaABC(c: ClienteCadenceSignals): boolean {
  // Recadastro explícito: voltou a ser lead (Grupo A).
  if (c.pos_venda_recadastro_at && !c.pos_venda_stage) {
    return false;
  }

  if (isWalletCustomer(c.customer_origin)) return true;
  if (c.is_converted === true) return true;

  const st = String(c.status || "").trim().toLowerCase();
  if (STATUS_SET.has(st)) return true;

  const pv = String(c.pos_venda_stage || "").trim();
  if (pv) return true;

  const andamento = String(c.andamento_igreen || "").trim().toLowerCase();
  if (ANDAMENTO_SET.has(andamento)) return true;

  return false;
}

/** Motivo curto p/ paused_reason / log / mark_journey_won source. */
export function clienteCadenceBlockReason(c: ClienteCadenceSignals): string {
  if (isWalletCustomer(c.customer_origin)) return "cliente_carteira";
  if (c.is_converted === true) return "cliente_convertido";
  const st = String(c.status || "").trim().toLowerCase();
  if (STATUS_SET.has(st)) return `cliente_status_${st}`;
  if (String(c.pos_venda_stage || "").trim()) return "cliente_pos_venda";
  const andamento = String(c.andamento_igreen || "").trim().toLowerCase();
  if (ANDAMENTO_SET.has(andamento)) return "cliente_andamento";
  return "cliente";
}

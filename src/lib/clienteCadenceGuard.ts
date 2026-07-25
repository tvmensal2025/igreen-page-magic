/**
 * Espelho de `supabase/functions/_shared/cliente-cadence-guard.ts`.
 * CLIENTE não entra no ciclo A/B/C (só pós-venda + agendamento).
 */
import { isIgreenWalletOrigin } from "@/lib/customerOrigin";

export const CLIENTE_CADENCE_BLOCK_STATUSES = [
  "approved",
  "active",
  "registered_igreen",
  "cadastro_concluido",
  "complete",
] as const;

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
  pos_venda_recadastro_at?: string | null;
};

const STATUS_SET = new Set<string>(CLIENTE_CADENCE_BLOCK_STATUSES);
const ANDAMENTO_SET = new Set<string>(CLIENTE_ANDAMENTO_VALUES);

export function isClienteProibidoCadenciaABC(c: ClienteCadenceSignals): boolean {
  if (c.pos_venda_recadastro_at && !c.pos_venda_stage) {
    return false;
  }
  if (isIgreenWalletOrigin(c.customer_origin)) return true;
  if (c.is_converted === true) return true;
  const st = String(c.status || "").trim().toLowerCase();
  if (STATUS_SET.has(st)) return true;
  if (String(c.pos_venda_stage || "").trim()) return true;
  const andamento = String(c.andamento_igreen || "").trim().toLowerCase();
  if (ANDAMENTO_SET.has(andamento)) return true;
  return false;
}

export function clienteCadenceBlockReason(c: ClienteCadenceSignals): string {
  if (isIgreenWalletOrigin(c.customer_origin)) return "cliente_carteira";
  if (c.is_converted === true) return "cliente_convertido";
  const st = String(c.status || "").trim().toLowerCase();
  if (STATUS_SET.has(st)) return `cliente_status_${st}`;
  if (String(c.pos_venda_stage || "").trim()) return "cliente_pos_venda";
  const andamento = String(c.andamento_igreen || "").trim().toLowerCase();
  if (ANDAMENTO_SET.has(andamento)) return "cliente_andamento";
  return "cliente";
}

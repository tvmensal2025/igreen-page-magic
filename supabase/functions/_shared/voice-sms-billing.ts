/**
 * Cobrança comercial iGreen Fone (SMS + ligação).
 * Preços: SMS R$ 0,10 / envio ok · voz R$ 0,10 a cada 30s atendida (ceil).
 * Débito só via RPC `debit_platform_usage_observation` (idempotente).
 */
import { notifyConsultant } from "./notify-consultant.ts";

export const PLATFORM_SMS_CENTS = 10;
export const PLATFORM_VOICE_BLOCK_SEC = 30;
export const PLATFORM_VOICE_BLOCK_CENTS = 10;
export const WALLET_WELCOME_CENTS = 100;

/** Blocos de 30s arredondados para cima. Atendida com duração ≤0 → 1 bloco. */
export function voiceBillableBlocks(durationSec: number | null | undefined): number {
  const d = Number(durationSec);
  if (!Number.isFinite(d) || d <= 0) return 1;
  return Math.max(1, Math.ceil(d / PLATFORM_VOICE_BLOCK_SEC));
}

export function voiceBillableCents(durationSec: number | null | undefined): number {
  return voiceBillableBlocks(durationSec) * PLATFORM_VOICE_BLOCK_CENTS;
}

export type PlatformUsageKind = "sms" | "voice";

export interface PlatformChargeResult {
  charged: boolean;
  reason: string;
  charged_cents?: number;
  balance_after_cents?: number;
  debt_cents?: number;
  low_balance?: boolean;
  observation_id?: string;
}

type AdminLike = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

export function parsePlatformChargeResult(raw: unknown): PlatformChargeResult {
  if (!raw || typeof raw !== "object") {
    return { charged: false, reason: "invalid_rpc_response" };
  }
  const row = raw as Record<string, unknown>;
  return {
    charged: row.charged === true,
    reason: typeof row.reason === "string" ? row.reason : "unknown",
    charged_cents: Number(row.charged_cents ?? 0) || undefined,
    balance_after_cents: row.balance_after_cents == null
      ? undefined
      : Number(row.balance_after_cents),
    debt_cents: row.debt_cents == null ? undefined : Number(row.debt_cents),
    low_balance: row.low_balance === true,
    observation_id: typeof row.observation_id === "string"
      ? row.observation_id
      : undefined,
  };
}

export async function ensureConsultantWalletWelcome(
  admin: AdminLike,
  consultantId: string,
): Promise<void> {
  if (!consultantId) return;
  try {
    await admin.rpc("ensure_consultant_wallet", { _consultant_id: consultantId });
  } catch (e) {
    console.warn("[platform-billing] ensure wallet", (e as Error).message);
  }
}

/**
 * Debita uso SMS/voz. `providerRef` deve ser estável (velip_call_id / velip_sms_id / log id).
 * Fail-open: erro de cobrança não quebra o fluxo de envio (só loga).
 */
export async function debitPlatformUsage(
  admin: AdminLike,
  opts: {
    consultantId: string;
    kind: PlatformUsageKind;
    providerRef: string;
    amountCents: number;
    description?: string;
    durationSec?: number | null;
    blocks?: number | null;
    metadata?: Record<string, unknown>;
  },
): Promise<PlatformChargeResult> {
  const ref = String(opts.providerRef || "").trim();
  if (!opts.consultantId || !ref || opts.amountCents <= 0) {
    return { charged: false, reason: "invalid_arguments" };
  }

  try {
    const { data, error } = await admin.rpc("debit_platform_usage_observation", {
      _consultant_id: opts.consultantId,
      _kind: opts.kind,
      _provider_ref: ref,
      _amount_cents: Math.trunc(opts.amountCents),
      _description: opts.description ?? null,
      _metadata: opts.metadata ?? {},
      _duration_sec: opts.durationSec == null || !Number.isFinite(Number(opts.durationSec))
        ? null
        : Math.trunc(Number(opts.durationSec)),
      _blocks: opts.blocks == null || !Number.isFinite(Number(opts.blocks))
        ? null
        : Math.trunc(Number(opts.blocks)),
    });
    if (error) {
      console.warn("[platform-billing] rpc error", error.message);
      return { charged: false, reason: `rpc_error:${error.message}` };
    }
    const result = parsePlatformChargeResult(data);
    if (result.low_balance || (result.charged && (result.balance_after_cents ?? 1) <= 0)) {
      void maybeNotifyLowBalance(admin, opts.consultantId, result);
    }
    return result;
  } catch (e) {
    console.warn("[platform-billing] exception", (e as Error).message);
    return { charged: false, reason: `exception:${(e as Error).message}` };
  }
}

export async function debitSmsSent(
  admin: AdminLike,
  opts: {
    consultantId: string;
    providerRef: string;
    metadata?: Record<string, unknown>;
  },
): Promise<PlatformChargeResult> {
  return debitPlatformUsage(admin, {
    consultantId: opts.consultantId,
    kind: "sms",
    providerRef: opts.providerRef,
    amountCents: PLATFORM_SMS_CENTS,
    description: "SMS iGreen Fone · R$ 0,10",
    metadata: { ...(opts.metadata || {}), channel: "sms" },
  });
}

export async function debitVoiceAnswered(
  admin: AdminLike,
  opts: {
    consultantId: string;
    providerRef: string;
    durationSec: number | null | undefined;
    metadata?: Record<string, unknown>;
  },
): Promise<PlatformChargeResult> {
  const blocks = voiceBillableBlocks(opts.durationSec);
  const cents = blocks * PLATFORM_VOICE_BLOCK_CENTS;
  const dur = Number(opts.durationSec);
  const durLabel = Number.isFinite(dur) && dur > 0 ? `${Math.round(dur)}s` : "atendida";
  return debitPlatformUsage(admin, {
    consultantId: opts.consultantId,
    kind: "voice",
    providerRef: opts.providerRef,
    amountCents: cents,
    durationSec: Number.isFinite(dur) ? dur : null,
    blocks,
    description: `Ligação iGreen Fone · ${durLabel} · ${blocks}×R$ 0,10`,
    metadata: { ...(opts.metadata || {}), channel: "voice" },
  });
}

async function maybeNotifyLowBalance(
  admin: AdminLike,
  consultantId: string,
  result: PlatformChargeResult,
): Promise<void> {
  try {
    const { data, error } = await admin.rpc("claim_platform_low_balance_alert", {
      _consultant_id: consultantId,
      _balance_cents: result.balance_after_cents ?? 0,
      _debt_cents: result.debt_cents ?? 0,
      _cooldown_hours: 24,
    });
    if (error) {
      console.warn("[platform-billing] claim alert", error.message);
      return;
    }
    if (data !== true) return;

    await notifyConsultant(
      consultantId,
      "warning",
      "Crédito de SMS e ligação acabou",
      [
        "Seu saldo para SMS e ligações (iGreen Fone) zerou.",
        "WhatsApp e chatbot continuam sem custo por mensagem.",
        "Para adicionar crédito, fale com o administrador da plataforma.",
      ].join("\n"),
    );
  } catch (e) {
    console.warn("[platform-billing] notify low balance", (e as Error).message);
  }
}

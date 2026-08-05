/**
 * Classificação do estado de OTP/contrato do Portal 2 — o PORTAL é a fonte da verdade.
 *
 * Por que existe (incidente 2026-08-04, JOSE LUIZ DE MELO):
 *   `customers.portal2_otp_validated_at` só era escrito em UM lugar do sistema:
 *   `worker-portal-2/server.mjs` dentro do `/confirm-otp`. Quem validava pelo
 *   link do portal (ou o consultor validando na mão) nunca gravava a coluna.
 *   Como o `bucketB` do `portal-otp-watchdog` só solta o lead quando a coluna
 *   está preenchida, esses clientes ficavam elegíveis PARA SEMPRE: horas depois
 *   o watchdog tentava validar um código morto, concluía "expirado" e pedia um
 *   código NOVO à iGreen — mandando OTP por WhatsApp para quem já tinha assinado
 *   o contrato. Pior: o `/resend-otp` ainda rebobinava `status` e
 *   `conversation_step` de volta para "aguardando OTP".
 *
 * Evidência de produção no momento da correção: 4 clientes com contrato
 * `completed` e OTP `used` no portal estavam sem `portal2_otp_validated_at`
 * no nosso banco (LUCINEIA, Julia, ELIENE, RAFAEL).
 *
 * Espelho Node (worker não importa Deno): `worker-portal-2/server.mjs`
 * → `classifyPortalOtpStatus` / `isPortalContractDone`. Ao mudar aqui, mude lá.
 */

/** Estado do OTP no portal, normalizado. */
export type PortalOtpState =
  /** Já cumpriu o papel: usado/concluído. Nunca gerar outro. */
  | "validated"
  /** Existe código válido aguardando digitação. Gerar outro INVALIDA esse. */
  | "pending"
  /** Expirado, falho ou desconhecido — pode gerar novo com segurança. */
  | "open";

const VALIDATED = new Set(["used", "completed", "complete", "validated", "success"]);
const PENDING = new Set(["to-validate", "to_validate", "tovalidate", "pending", "waiting"]);

/**
 * Normaliza o `status` de `GET /verification-codes/status/:idcliente`.
 * Valores reais observados em produção: `used`, `to-validate`.
 * Documentados: `pending|completed|failure|expired|used`.
 */
export function classifyPortalOtpStatus(raw: string | null | undefined): PortalOtpState {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return "open";
  if (VALIDATED.has(s)) return "validated";
  if (PENDING.has(s)) return "pending";
  return "open";
}

/**
 * Contrato assinado significa que o OTP já cumpriu o papel — mesmo que o
 * endpoint de OTP diga outra coisa (foi o caso do José: contrato `completed`
 * com OTP `to-validate`, porque um reenvio indevido reabriu o código).
 */
export function isPortalContractDone(raw: string | null | undefined): boolean {
  const s = String(raw ?? "").trim().toLowerCase();
  return s === "completed" || s === "complete" || s === "signed";
}

/**
 * Estados NOSSOS (`customers.portal2_status`) que indicam cadastro concluído.
 * Nunca rebobinar esses para "aguardando OTP" nem pedir código novo.
 */
const CONCLUDED_LOCAL = new Set([
  "contract_completed",
  "otp_validated",
  "already_registered",
  "complete",
]);

export function isLocalPortalConcluded(portal2Status: string | null | undefined): boolean {
  return CONCLUDED_LOCAL.has(String(portal2Status ?? "").trim().toLowerCase());
}

/**
 * Decisão única para "posso gerar/pedir um OTP agora?".
 * Retorna o motivo do bloqueio para virar log/telemetria, nunca string solta.
 */
export function shouldGenerateOtp(args: {
  portalOtpStatus?: string | null;
  portalContractStatus?: string | null;
  localPortalStatus?: string | null;
}): { allowed: true } | { allowed: false; reason: string } {
  if (isLocalPortalConcluded(args.localPortalStatus)) {
    return { allowed: false, reason: "local_concluded" };
  }
  if (isPortalContractDone(args.portalContractStatus)) {
    return { allowed: false, reason: "contract_done" };
  }
  const state = classifyPortalOtpStatus(args.portalOtpStatus);
  if (state === "validated") return { allowed: false, reason: "otp_already_validated" };
  if (state === "pending") return { allowed: false, reason: "otp_pending" };
  return { allowed: true };
}

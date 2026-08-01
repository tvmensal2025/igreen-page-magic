// Mapa fixHint → CTA. Usado por useCustomerAttendance, runFastStartAttendance
// e runAttendanceBatch para transformar falhas do envio automático em toasts
// acionáveis (sem mais "envie manualmente" genérico).
import { toast as sonnerToast } from "@/components/ui/sonner";

export type AttendanceFixHint =
  | "toggle"
  | "whapi_token"
  | "evolution_instance"
  | "instance_offline"
  | "phone"
  | "rate_limit"
  | "retry"
  | "start_first"
  | null;

export interface AttendanceOutcome {
  ok?: boolean;
  fallback?: boolean;
  fixHint?: AttendanceFixHint | string | null;
  message?: string;
  detail?: string;
  error?: string;
  protocol?: string;
  skipped?: string;
  instance?: string;
}

interface ShortcutSpec {
  label: string;
  href: string;
}

function shortcutFor(
  hint: AttendanceFixHint | string | null | undefined,
  instance?: string,
): ShortcutSpec | null {
  switch (hint) {
    case "toggle":
      return { label: "Ativar automação", href: "/admin?tab=agendamentos&section=automacoes&flag=start_customer_attendance" };
    case "whapi_token":
      return { label: "Configurar WhatsApp", href: "/admin?tab=whatsapp&section=config" };
    case "evolution_instance":
      return { label: "Conectar WhatsApp", href: "/admin?tab=whatsapp&section=config" };
    case "instance_offline":
      return {
        label: "Reconectar",
        href: instance
          ? `/admin?tab=whatsapp&section=config&instance=${encodeURIComponent(instance)}`
          : "/admin?tab=whatsapp&section=config",
      };
    case "rate_limit":
      return { label: "Ver anti-ban", href: "/admin?tab=whatsapp&section=antiban" };
    case "start_first":
      return { label: "Iniciar atendimento", href: "" };
    default:
      return null;
  }
}

/**
 * Mostra um toast coerente com o resultado do start/end atendimento.
 * - Sucesso → success com protocolo.
 * - Falha com fixHint → warning + botão "Abrir configuração".
 * - Falha bruta → error com mensagem real (nunca mais "envie manualmente" seco).
 */
export function notifyAttendanceOutcome(
  result: AttendanceOutcome,
  opts: {
    kind: "start" | "end";
    toastId?: string | number;
    navigate?: (path: string) => void;
    onRetry?: () => void;
  },
) {
  const { kind, toastId, navigate, onRetry } = opts;
  const successTitle = kind === "start" ? "Atendimento iniciado" : "Atendimento finalizado";
  const skippedTitle = kind === "start"
    ? (result.skipped === "already_sent" ? "Atendimento já iniciado" : successTitle)
    : (result.skipped === "already_rated"
        ? "Avaliação já registrada"
        : result.skipped === "rating_pending"
        ? "Pesquisa já enviada"
        : successTitle);

  if (result.ok !== false) {
    sonnerToast.success(skippedTitle, {
      id: toastId,
      description: result.protocol ? `Protocolo ${result.protocol}` : undefined,
    });
    return;
  }

  const description = result.message || result.detail || result.error || "Tente de novo.";
  const shortcut = shortcutFor(result.fixHint as AttendanceFixHint, result.instance);
  const title = kind === "start" ? "Não iniciou automaticamente" : "Não finalizou automaticamente";

  const action = shortcut && navigate && shortcut.href
    ? { label: shortcut.label, onClick: () => navigate(shortcut.href) }
    : onRetry
    ? { label: "Tentar de novo", onClick: onRetry }
    : undefined;

  const toastFn = result.fallback ? sonnerToast.warning : sonnerToast.error;
  toastFn(title, { id: toastId, description, action });
}
